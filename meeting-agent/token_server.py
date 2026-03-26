"""
Meeting Agent Proxy API

Serves as the backend for the Claude Code plugin:
1. Proxies API calls (Google Calendar, Recall.ai, Supabase) so the plugin has no secrets
2. Generates LiveKit tokens for the bridge webpage
3. Dispatches the cloud-hosted LiveKit agent to rooms
4. Serves the bridge webpage for Recall.ai Output Media
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env.local", override=True)
except ImportError:
    pass

import httpx
from fastapi import FastAPI, Header, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from livekit.api import AccessToken, LiveKitAPI, VideoGrants, CreateAgentDispatchRequest
from supabase import create_client

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

RECALL_API_KEY = os.getenv("RECALL_API_KEY", "")
RECALL_REGION = os.getenv("RECALL_REGION", "us-west-2")
RECALL_BASE_URL = f"https://{RECALL_REGION}.recall.ai/api/v1"

AGENT_WEBHOOK_URL = os.getenv("AGENT_WEBHOOK_URL", "")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

app = FastAPI(title="Meeting Agent API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get_user_identity(token_data: dict) -> dict | None:
    """Look up user from token data."""
    if not supabase:
        return None
    google_id = token_data.get("googleId")
    email = token_data.get("email")
    if google_id:
        result = supabase.table("users").select("*").eq("google_id", google_id).execute()
    elif email:
        result = supabase.table("users").select("*").eq("email", email).execute()
    else:
        return None
    return result.data[0] if result.data else None


# ---------------------------------------------------------------------------
# Proxy: Google Calendar
# ---------------------------------------------------------------------------

async def _refresh_google_token(refresh_token: str) -> dict:
    """Refresh a Google OAuth access token."""
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
        resp.raise_for_status()
        return resp.json()


@app.post("/api/meetings")
async def list_meetings(request: Request):
    """Proxy: list Google Calendar meetings using the user's refresh token."""
    body = await request.json()
    refresh_token = body.get("refreshToken")
    days = body.get("days", 7)

    if not refresh_token:
        return JSONResponse({"error": "No refresh token provided"}, status_code=400)

    # Refresh access token
    token_data = await _refresh_google_token(refresh_token)
    access_token = token_data["access_token"]

    # Fetch calendar events
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    end = now + timedelta(days=days)

    async with httpx.AsyncClient() as client:
        resp = await client.get(
            "https://www.googleapis.com/calendar/v3/calendars/primary/events",
            params={
                "timeMin": now.isoformat(),
                "timeMax": end.isoformat(),
                "singleEvents": "true",
                "orderBy": "startTime",
                "maxResults": "50",
            },
            headers={"Authorization": f"Bearer {access_token}"},
        )
        resp.raise_for_status()
        data = resp.json()

    # Return new access token + events
    return JSONResponse({
        "accessToken": access_token,
        "expiresIn": token_data.get("expires_in", 3600),
        "events": data.get("items", []),
    })


# ---------------------------------------------------------------------------
# Proxy: Dispatch agent to meeting
# ---------------------------------------------------------------------------

@app.post("/api/dispatch")
async def dispatch_agent(request: Request):
    """Proxy: create Recall.ai bot and agent session."""
    body = await request.json()
    meeting_url = body.get("meetingUrl")
    meeting_title = body.get("meetingTitle", "Meeting")
    meeting_id = body.get("meetingId", "")
    bot_name = body.get("botName", "Delegate")
    user_id = body.get("userId", "")

    if not meeting_url:
        return JSONResponse({"error": "No meeting URL"}, status_code=400)

    # Create Recall.ai bot with Output Media
    room_name = f"meeting-{meeting_id[:12]}-{int(__import__('time').time() * 1000)}"

    recall_body: dict = {
        "meeting_url": meeting_url,
        "bot_name": bot_name,
    }

    if AGENT_WEBHOOK_URL:
        recall_body["output_media"] = {
            "camera": {
                "kind": "webpage",
                "config": {
                    "url": f"{AGENT_WEBHOOK_URL}?room={room_name}",
                },
            },
        }
        recall_body["recording_config"] = {
            "include_bot_in_recording": {"audio": True},
        }
        recall_body["variant"] = {
            "google_meet": "web_4_core",
            "zoom": "web_4_core",
        }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{RECALL_BASE_URL}/bot/",
            headers={
                "Authorization": f"Token {RECALL_API_KEY}",
                "Content-Type": "application/json",
            },
            json=recall_body,
            timeout=30.0,
        )

    if not resp.is_success:
        return JSONResponse(
            {"error": f"Recall.ai error ({resp.status_code}): {resp.text}"},
            status_code=resp.status_code,
        )

    bot_data = resp.json()
    bot_id = bot_data["id"]
    status = bot_data.get("status_changes", [{}])[0].get("code", "joining")

    # Create agent session in Supabase
    session_id = ""
    if supabase and user_id:
        result = supabase.table("agent_sessions").insert({
            "user_id": user_id,
            "meeting_id": meeting_id,
            "meeting_title": meeting_title,
            "recall_bot_id": bot_id,
            "status": "joining",
        }).execute()
        if result.data:
            session_id = result.data[0]["id"]

    return JSONResponse({
        "botId": bot_id,
        "status": status,
        "sessionId": session_id,
        "roomName": room_name,
    })


# ---------------------------------------------------------------------------
# Proxy: Onboarding status
# ---------------------------------------------------------------------------

@app.post("/api/onboarding/status")
async def onboarding_status(request: Request):
    """Proxy: get onboarding status from Supabase."""
    body = await request.json()
    user = _get_user_identity(body)

    if not user:
        return JSONResponse({
            "completed": False,
            "steps": {
                "signIn": False, "profile": False, "voiceClone": False,
                "avatar": False, "connectors": False, "paraSetup": False,
            },
        })

    connectors = user.get("connectors") or {}
    return JSONResponse({
        "completed": user.get("onboarding_completed", False),
        "user": {
            "id": user["id"],
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "onboardingCompleted": user.get("onboarding_completed", False),
        },
        "steps": {
            "signIn": True,
            "profile": bool(user.get("name")),
            "voiceClone": bool(user.get("voice_clone_id")),
            "avatar": bool(user.get("avatar_url")),
            "connectors": connectors.get("calendar", False) or connectors.get("github", False) or connectors.get("slack", False),
            "paraSetup": True,
        },
    })


# ---------------------------------------------------------------------------
# LiveKit token + agent dispatch (existing)
# ---------------------------------------------------------------------------

@app.get("/api/token")
async def get_token(
    room: str = Query(...),
    identity: str = Query(default="meeting-bridge"),
):
    """Generate LiveKit token and dispatch agent."""
    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_grants(VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True))
    )

    try:
        lk_api = LiveKitAPI(url=LIVEKIT_URL, api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(agent_name="claude-delegate", room=room)
        )
        await lk_api.aclose()
        print(f"[api] Dispatched agent to room: {room}")
    except Exception as e:
        print(f"[api] Agent dispatch failed: {e}")

    return JSONResponse({"token": token.to_jwt(), "url": LIVEKIT_URL})


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve static files last
static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

"""
Meeting Agent Proxy API

Serves as the backend for the Claude Code plugin:
1. Proxies API calls (Recall.ai, Supabase) so the plugin has no secrets
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
try:
    from supabase import create_client
except ImportError:
    create_client = None

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")

SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")

RECALL_API_KEY = os.getenv("RECALL_API_KEY", "")
RECALL_REGION = os.getenv("RECALL_REGION", "us-west-2")
RECALL_BASE_URL = f"https://{RECALL_REGION}.recall.ai/api/v1"

AGENT_WEBHOOK_URL = os.getenv("AGENT_WEBHOOK_URL", "")
ANAM_API_KEY = os.getenv("ANAM_API_KEY", "")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if create_client and SUPABASE_URL and SUPABASE_KEY else None

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
    """Look up user from token data by email."""
    if not supabase:
        return None
    email = token_data.get("email")
    if not email:
        # Legacy fallback: try google_id
        google_id = token_data.get("googleId")
        if google_id:
            result = supabase.table("users").select("*").eq("google_id", google_id).execute()
            return result.data[0] if result.data else None
        return None
    result = supabase.table("users").select("*").eq("email", email).execute()
    return result.data[0] if result.data else None


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
    user_context = body.get("context", "")

    if not meeting_url:
        return JSONResponse({"error": "No meeting URL"}, status_code=400)

    # Look up user's voice_clone_id and avatar from Supabase
    user_voice_id = ""
    user_name = ""
    user_avatar_id = ""
    if supabase and user_id:
        result = supabase.table("users").select("voice_clone_id, name, anam_avatar_id").eq("id", user_id).execute()
        if result.data:
            user_voice_id = result.data[0].get("voice_clone_id") or ""
            user_name = result.data[0].get("name") or ""
            user_avatar_id = result.data[0].get("anam_avatar_id") or ""

    # Create Recall.ai bot with Output Media
    room_name = f"meeting-{meeting_id[:12]}-{int(__import__('time').time() * 1000)}"

    recall_body: dict = {
        "meeting_url": meeting_url,
        "bot_name": bot_name,
    }

    if AGENT_WEBHOOK_URL:
        from urllib.parse import urlencode
        output_params = urlencode({
            "room": room_name,
            "voice_id": user_voice_id,
            "user_name": user_name,
            "user_context": user_context,
            "avatar_id": user_avatar_id,
        })
        recall_body["output_media"] = {
            "camera": {
                "kind": "webpage",
                "config": {
                    "url": f"{AGENT_WEBHOOK_URL}?{output_params}",
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
    status_changes = bot_data.get("status_changes") or []
    status = status_changes[0].get("code", "joining") if status_changes else "joining"

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
                "profile": False, "voiceClone": False,
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
            "profile": bool(user.get("name")),
            "voiceClone": bool(user.get("voice_clone_id")),
            "avatar": bool(user.get("avatar_url")),
            "connectors": connectors.get("github", False) or connectors.get("slack", False),
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
    voice_id: str = Query(default=""),
    user_name: str = Query(default=""),
    avatar_id: str = Query(default=""),
):
    """Generate LiveKit token and dispatch agent with user metadata."""
    import json

    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_grants(VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True))
    )

    # Pass user info as metadata so the agent can use their cloned voice and avatar
    metadata = json.dumps({"voice_id": voice_id, "user_name": user_name, "avatar_id": avatar_id})

    try:
        lk_api = LiveKitAPI(url=LIVEKIT_URL, api_key=LIVEKIT_API_KEY, api_secret=LIVEKIT_API_SECRET)
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(agent_name="claude-delegate", room=room, metadata=metadata)
        )
        await lk_api.aclose()
        print(f"[api] Dispatched agent to room: {room}")
    except Exception as e:
        print(f"[api] Agent dispatch failed: {e}")

    return JSONResponse({"token": token.to_jwt(), "url": LIVEKIT_URL})


# ---------------------------------------------------------------------------
# Onboarding sessions — link browser sign-in to MCP client
# ---------------------------------------------------------------------------

# In-memory store: sessionId -> {email, name, completed}
_onboarding_sessions: dict[str, dict] = {}


@app.post("/api/onboarding/session")
async def create_onboarding_session(request: Request):
    """Register a new onboarding session (called by MCP before opening browser)."""
    body = await request.json()
    session_id = body.get("sessionId", "")
    if session_id:
        _onboarding_sessions[session_id] = {"completed": False}
    return JSONResponse({"ok": True})


@app.get("/api/onboarding/session/{session_id}")
async def get_onboarding_session(session_id: str):
    """Check if an onboarding session completed (polled by MCP)."""
    session = _onboarding_sessions.get(session_id)
    if not session:
        return JSONResponse({"completed": False})
    return JSONResponse(session)


@app.post("/api/onboarding/session/{session_id}/complete")
async def complete_onboarding_session(session_id: str, request: Request):
    """Mark an onboarding session as complete (called by web app after setup)."""
    body = await request.json()
    _onboarding_sessions[session_id] = {
        "completed": True,
        "user": {
            "email": body.get("email", ""),
            "name": body.get("name", ""),
        },
    }
    return JSONResponse({"ok": True})


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve static files last
static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

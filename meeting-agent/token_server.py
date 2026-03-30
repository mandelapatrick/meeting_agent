"""
Meeting Agent Proxy API

Serves as the backend for the Claude Code plugin:
1. Proxies API calls (Recall.ai, Supabase) so the plugin has no secrets
2. Generates LiveKit tokens for the bridge webpage
3. Dispatches the cloud-hosted LiveKit agent to rooms
4. Serves the bridge webpage for Recall.ai Output Media
"""

import asyncio
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
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")

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
    bot_name = body.get("botName", "Agent")
    user_id = body.get("userId", "")
    user_context = body.get("context", "")
    mode = body.get("mode", "audio")

    if not meeting_url:
        return JSONResponse({"error": "No meeting URL"}, status_code=400)

    # Look up user's voice_clone_id and avatar from Supabase
    user_voice_id = ""
    user_name = ""
    user_avatar_id = ""
    user_avatar_url = ""
    if supabase and user_id:
        result = supabase.table("users").select("voice_clone_id, name, anam_avatar_id, avatar_url").eq("id", user_id).execute()
        if result.data:
            user_voice_id = result.data[0].get("voice_clone_id") or ""
            user_name = result.data[0].get("name") or ""
            user_avatar_id = result.data[0].get("anam_avatar_id") or ""
            user_avatar_url = result.data[0].get("avatar_url") or ""

    # Create Recall.ai bot with Output Media
    room_name = f"meeting-{meeting_id[:12]}-{int(__import__('time').time() * 1000)}"

    # Create agent session first so we can pass session_id to the agent
    session_id = ""
    if supabase and user_id:
        result = supabase.table("agent_sessions").insert({
            "user_id": user_id,
            "meeting_id": meeting_id,
            "meeting_title": meeting_title,
            "meeting_url": meeting_url,
            "status": "joining",
        }).execute()
        if result.data:
            session_id = result.data[0]["id"]

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
            "avatar_id": user_avatar_id if mode == "video" else "",
            "avatar_url": user_avatar_url,
            "meeting_title": meeting_title,
            "session_id": session_id,
            "user_id": user_id,
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
        for attempt in range(5):
            resp = await client.post(
                f"{RECALL_BASE_URL}/bot/",
                headers={
                    "Authorization": f"Token {RECALL_API_KEY}",
                    "Content-Type": "application/json",
                },
                json=recall_body,
                timeout=30.0,
            )
            if resp.status_code == 429 and attempt < 4:
                retry_after = int(resp.headers.get("Retry-After", 5 * (attempt + 1)))
                print(f"[dispatch] Recall.ai 429, retrying in {retry_after}s (attempt {attempt + 1}/5)")
                await asyncio.sleep(retry_after)
                continue
            break

    if not resp.is_success:
        print(f"[dispatch] Recall.ai error {resp.status_code}: {resp.text}")
        return JSONResponse(
            {"error": f"Recall.ai error ({resp.status_code}): {resp.text}"},
            status_code=resp.status_code,
        )

    bot_data = resp.json()
    bot_id = bot_data["id"]
    status_changes = bot_data.get("status_changes") or []
    status = status_changes[0].get("code", "joining") if status_changes else "joining"

    # Update session with Recall.ai bot ID
    if supabase and session_id:
        supabase.table("agent_sessions").update({
            "recall_bot_id": bot_id,
        }).eq("id", session_id).execute()

    return JSONResponse({
        "botId": bot_id,
        "status": status,
        "sessionId": session_id,
        "roomName": room_name,
    })


# ---------------------------------------------------------------------------
# Post-meeting brief: send summary to user via Telegram
# ---------------------------------------------------------------------------

@app.post("/api/brief/send")
async def send_brief(request: Request):
    """Send a post-meeting brief to the user via Telegram."""
    body = await request.json()
    session_id = body.get("session_id")
    user_id = body.get("user_id")

    if not session_id or not user_id or not supabase:
        return JSONResponse({"error": "Missing session_id, user_id, or no database"}, status_code=400)

    # Look up user's Telegram chat ID
    user_result = supabase.table("users").select("telegram_chat_id, name").eq("id", user_id).execute()
    if not user_result.data or not user_result.data[0].get("telegram_chat_id"):
        print(f"[brief] No telegram_chat_id for user {user_id}, skipping send")
        return JSONResponse({"ok": False, "reason": "no_telegram"})

    chat_id = user_result.data[0]["telegram_chat_id"]

    # Read the brief from agent_sessions
    session_result = supabase.table("agent_sessions").select(
        "meeting_title, summary, action_items"
    ).eq("id", session_id).execute()

    if not session_result.data:
        return JSONResponse({"ok": False, "reason": "session_not_found"})

    session = session_result.data[0]
    title = session.get("meeting_title") or "Meeting"
    summary = session.get("summary") or "No summary available."
    action_items = session.get("action_items") or []

    # Format the Telegram message
    lines = [f'*Meeting Brief: "{title}"*', ""]
    lines.append(f"*SUMMARY*\n{summary}")

    if action_items:
        lines.append("\n*ACTION ITEMS*")
        for item in action_items:
            if isinstance(item, dict):
                task = item.get("task", "")
                owner = item.get("owner", "")
                deadline = item.get("deadline", "")
                parts = [task]
                if owner:
                    parts.append(owner)
                if deadline:
                    parts.append(f"by {deadline}")
                lines.append(f"• {' — '.join(parts)}")
            else:
                lines.append(f"• {item}")

    message = "\n".join(lines)

    # Send via Telegram Bot API
    if not TELEGRAM_BOT_TOKEN:
        print("[brief] No TELEGRAM_BOT_TOKEN configured")
        return JSONResponse({"ok": False, "reason": "no_bot_token"})

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage",
            json={
                "chat_id": chat_id,
                "text": message,
                "parse_mode": "Markdown",
            },
            timeout=10.0,
        )

    if resp.is_success:
        print(f"[brief] Sent brief for session {session_id} to chat {chat_id}")
    else:
        print(f"[brief] Telegram send failed: {resp.status_code} {resp.text}")

    return JSONResponse({"ok": resp.is_success})


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
    has_profile = bool(user.get("name"))
    has_voice = bool(user.get("voice_clone_id"))
    # Consider onboarding complete when profile + voice are done
    # (minimum viable for agent operation — Telegram is optional for plugin users)
    is_completed = has_profile and has_voice
    return JSONResponse({
        "completed": is_completed,
        "user": {
            "id": user["id"],
            "name": user.get("name", ""),
            "email": user.get("email", ""),
            "onboardingCompleted": is_completed,
        },
        "steps": {
            "profile": has_profile,
            "voiceClone": has_voice,
            "telegram": bool(user.get("telegram_chat_id")),
        },
    })



# ---------------------------------------------------------------------------
# Calendar: list upcoming meetings
# ---------------------------------------------------------------------------

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")


@app.post("/api/calendar/list")
async def list_calendar_events(request: Request):
    """List upcoming calendar events for a user (identified by email)."""
    body = await request.json()
    email = body.get("email")
    days = body.get("days", 1)

    if not email or not supabase:
        return JSONResponse({"error": "Missing email or no database"}, status_code=400)

    # Look up user
    user_result = supabase.table("users").select("id").eq("email", email).execute()
    if not user_result.data:
        return JSONResponse({"error": "User not found"}, status_code=404)

    user_id = user_result.data[0]["id"]

    # Get Google tokens
    token_result = (
        supabase.table("connector_tokens")
        .select("access_token, refresh_token, expires_at")
        .eq("user_id", user_id)
        .eq("provider", "google")
        .single()
        .execute()
    )
    token_row = token_result.data
    if not token_row or not token_row.get("refresh_token"):
        return JSONResponse({"error": "No Google Calendar connected"}, status_code=400)

    from google.oauth2.credentials import Credentials
    from googleapiclient.discovery import build as build_service
    from datetime import datetime, timedelta, timezone
    import re

    creds = Credentials(
        token=token_row["access_token"],
        refresh_token=token_row["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GOOGLE_CLIENT_ID,
        client_secret=GOOGLE_CLIENT_SECRET,
    )

    if creds.expired or not creds.valid:
        from google.auth.transport.requests import Request as GoogleRequest
        creds.refresh(GoogleRequest())
        supabase.table("connector_tokens").update({
            "access_token": creds.token,
            "expires_at": creds.expiry.isoformat() if creds.expiry else None,
        }).eq("user_id", user_id).eq("provider", "google").execute()

    service = build_service("calendar", "v3", credentials=creds)
    now_dt = datetime.now(timezone.utc)
    end_dt = now_dt + timedelta(days=days)

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=now_dt.isoformat(),
            timeMax=end_dt.isoformat(),
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    def extract_meeting_url(event):
        if event.get("hangoutLink"):
            return event["hangoutLink"]
        for ep in event.get("conferenceData", {}).get("entryPoints", []):
            if ep.get("entryPointType") == "video":
                return ep.get("uri")
        for field in ("location", "description"):
            text = event.get(field, "") or ""
            match = re.search(
                r"https?://(?:[\w-]+\.)?zoom\.us/j/\S+|https?://meet\.google\.com/\S+",
                text,
            )
            if match:
                return match.group(0)
        return None

    meetings = []
    for event in events_result.get("items", []):
        start = event["start"].get("dateTime", event["start"].get("date"))
        end = event["end"].get("dateTime", event["end"].get("date"))
        attendees = [
            a.get("displayName") or a.get("email", "")
            for a in event.get("attendees", [])
            if not a.get("self")
        ]
        meetings.append({
            "title": event.get("summary", "Untitled Meeting"),
            "start": start,
            "end": end,
            "meetingUrl": extract_meeting_url(event),
            "attendees": attendees,
            "eventId": event["id"],
        })

    return JSONResponse({"meetings": meetings})


# ---------------------------------------------------------------------------
# Sessions: active status and meeting briefs
# ---------------------------------------------------------------------------

@app.post("/api/sessions/active")
async def get_active_sessions(request: Request):
    """Get active agent sessions for a user."""
    body = await request.json()
    email = body.get("email")

    if not email or not supabase:
        return JSONResponse({"error": "Missing email or no database"}, status_code=400)

    user_result = supabase.table("users").select("id").eq("email", email).execute()
    if not user_result.data:
        return JSONResponse({"error": "User not found"}, status_code=404)

    user_id = user_result.data[0]["id"]
    result = (
        supabase.table("agent_sessions")
        .select("id, meeting_title, status, created_at")
        .eq("user_id", user_id)
        .in_("status", ["pending", "joining", "active"])
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )

    return JSONResponse({"sessions": result.data or []})


@app.post("/api/brief/get")
async def get_brief(request: Request):
    """Get post-meeting brief for a session or the latest completed session."""
    body = await request.json()
    session_id = body.get("sessionId")
    email = body.get("email")

    if not supabase:
        return JSONResponse({"error": "No database"}, status_code=400)

    if session_id:
        result = (
            supabase.table("agent_sessions")
            .select("id, meeting_title, summary, action_items, status, created_at")
            .eq("id", session_id)
            .single()
            .execute()
        )
        return JSONResponse({"brief": result.data})

    if email:
        user_result = supabase.table("users").select("id").eq("email", email).execute()
        if not user_result.data:
            return JSONResponse({"error": "User not found"}, status_code=404)

        user_id = user_result.data[0]["id"]
        result = (
            supabase.table("agent_sessions")
            .select("id, meeting_title, summary, action_items, status, created_at")
            .eq("user_id", user_id)
            .eq("status", "completed")
            .order("created_at", desc=True)
            .limit(5)
            .execute()
        )
        return JSONResponse({"briefs": result.data or []})

    return JSONResponse({"error": "Provide sessionId or email"}, status_code=400)


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
    avatar_url: str = Query(default=""),
    user_context: str = Query(default=""),
    meeting_title: str = Query(default="Meeting"),
    session_id: str = Query(default=""),
    user_id: str = Query(default=""),
):
    """Generate LiveKit token and dispatch agent with user metadata."""
    import json

    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_grants(VideoGrants(room_join=True, room=room, can_publish=True, can_subscribe=True))
    )

    # Pass user info as metadata so the agent can use their cloned voice and avatar
    metadata = json.dumps({
        "voice_id": voice_id,
        "user_name": user_name,
        "avatar_id": avatar_id,
        "user_context": user_context,
        "meeting_title": meeting_title,
        "session_id": session_id,
        "user_id": user_id,
    })

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

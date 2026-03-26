"""
Token server for LiveKit room access.

Generates access tokens for the bridge webpage, dispatches the
cloud-hosted agent to the room, and serves static files.
"""

import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent.parent / ".env")
    load_dotenv(Path(__file__).resolve().parent / ".env.local", override=True)
except ImportError:
    pass  # dotenv not needed when env vars are injected (e.g., Render)

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from livekit.api import AccessToken, LiveKitAPI, VideoGrants, CreateAgentDispatchRequest

LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY", "")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET", "")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "")

app = FastAPI(title="Claude Delegate Token Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/token")
async def get_token(
    room: str = Query(..., description="LiveKit room name"),
    identity: str = Query(default="meeting-bridge", description="Participant identity"),
):
    """Generate a LiveKit access token and dispatch the agent to the room."""
    token = (
        AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET)
        .with_identity(identity)
        .with_grants(
            VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
            )
        )
    )

    # Dispatch the cloud-hosted agent to this room
    try:
        lk_api = LiveKitAPI(
            url=LIVEKIT_URL,
            api_key=LIVEKIT_API_KEY,
            api_secret=LIVEKIT_API_SECRET,
        )
        await lk_api.agent_dispatch.create_dispatch(
            CreateAgentDispatchRequest(
                agent_name="claude-delegate",
                room=room,
            )
        )
        await lk_api.aclose()
        print(f"[token_server] Dispatched agent to room: {room}")
    except Exception as e:
        print(f"[token_server] Agent dispatch failed: {e}")

    return JSONResponse({
        "token": token.to_jwt(),
        "url": LIVEKIT_URL,
    })


@app.get("/health")
async def health():
    return {"status": "ok"}


# Serve static files (bridge webpage) — mount last so API routes take priority
static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

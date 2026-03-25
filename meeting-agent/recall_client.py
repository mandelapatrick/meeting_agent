"""
Recall.ai API client for the meeting agent.

Handles sending audio output back to the bot and checking bot status.
"""

import base64
import os
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

RECALL_REGION = os.getenv("RECALL_REGION", "us-west-2")
RECALL_BASE_URL = f"https://{RECALL_REGION}.recall.ai/api/v1"
RECALL_API_KEY = os.getenv("RECALL_API_KEY", "")


def _auth_headers() -> dict[str, str]:
    return {
        "Authorization": f"Token {RECALL_API_KEY}",
        "Content-Type": "application/json",
    }


async def send_output_audio(bot_id: str, mp3_bytes: bytes) -> bool:
    """Send MP3 audio to the Recall.ai bot to play in the meeting."""
    b64_data = base64.b64encode(mp3_bytes).decode("utf-8")

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"{RECALL_BASE_URL}/bot/{bot_id}/output_audio/",
            headers=_auth_headers(),
            json={
                "kind": "mp3",
                "b64_data": b64_data,
            },
            timeout=30.0,
        )

    if not response.is_success:
        print(f"[recall] output_audio failed ({response.status_code}): {response.text}")
        return False

    return True


async def get_bot_status(bot_id: str) -> dict | None:
    """Get the current status of a Recall.ai bot."""
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"{RECALL_BASE_URL}/bot/{bot_id}/",
            headers=_auth_headers(),
            timeout=10.0,
        )

    if not response.is_success:
        return None

    return response.json()

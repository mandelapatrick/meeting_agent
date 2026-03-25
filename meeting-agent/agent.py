"""
Claude Delegate - Meeting Agent (Output Media approach)

FastAPI server that:
1. Serves a webpage loaded by the Recall.ai bot (Output Media)
2. The webpage receives real-time transcripts via Recall.ai WebSocket
3. Webpage POSTs transcripts to /api/respond
4. Backend generates response (Claude) + TTS (ElevenLabs)
5. Returns MP3 audio → webpage plays it → bot streams to meeting
"""

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import anthropic
import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from context_loader import load_meeting_context

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------


@dataclass
class AgentConfig:
    user_name: str
    voice_clone_id: str
    anthropic_api_key: str
    elevenlabs_api_key: str


config = AgentConfig(
    user_name=os.getenv("DELEGATE_USER_NAME", "User"),
    voice_clone_id=os.getenv("DELEGATE_VOICE_ID", ""),
    anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", ""),
    elevenlabs_api_key=os.getenv("ELEVEN_API_KEY", ""),
)

# Preload context once
meeting_context = load_meeting_context("Meeting")

# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------


class TranscriptEntry(BaseModel):
    speaker: str
    text: str


class RespondRequest(BaseModel):
    speaker: str
    text: str
    transcript: list[TranscriptEntry] = []


# ---------------------------------------------------------------------------
# Response logic
# ---------------------------------------------------------------------------


def should_respond(text: str, transcript: list[TranscriptEntry]) -> bool:
    """Determine if the agent should respond to this transcript entry."""
    text_lower = text.lower()
    name_lower = config.user_name.lower()

    # Direct name mention
    if name_lower in text_lower:
        return True

    # Delegate invocation
    if "delegate" in text_lower:
        return True

    # Question after recent name mention
    recent_text = " ".join(e.text.lower() for e in transcript[-5:])
    if name_lower in recent_text and text_lower.rstrip().endswith("?"):
        return True

    return False


async def generate_response(question: str, transcript: list[TranscriptEntry]) -> str:
    """Generate a response using Claude with the user's context."""
    transcript_context = "\n".join(
        f"{e.speaker}: {e.text}" for e in transcript[-20:]
    )

    system_prompt = f"""You are acting as {config.user_name}'s delegate in a meeting.
Respond as if you are {config.user_name}. Be concise, professional, and natural.
Use first person ("I think...", "In my experience...").
Keep responses under 3 sentences — this will be spoken aloud.

{config.user_name}'s context and knowledge:
{meeting_context}

Recent meeting transcript:
{transcript_context}"""

    client = anthropic.AsyncAnthropic(api_key=config.anthropic_api_key)
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=200,
        system=system_prompt,
        messages=[{"role": "user", "content": question}],
    )

    return response.content[0].text


async def synthesize_speech(text: str) -> bytes:
    """Convert text to speech using ElevenLabs with the cloned voice."""
    if not config.voice_clone_id or not config.elevenlabs_api_key:
        print("[agent] No voice clone configured, skipping TTS")
        return b""

    async with httpx.AsyncClient() as client:
        response = await client.post(
            f"https://api.elevenlabs.io/v1/text-to-speech/{config.voice_clone_id}/stream",
            headers={"xi-api-key": config.elevenlabs_api_key},
            json={
                "text": text,
                "model_id": "eleven_turbo_v2_5",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.8},
            },
            timeout=30.0,
        )

        if not response.is_success:
            print(f"[agent] ElevenLabs error ({response.status_code}): {response.text}")
            return b""

        return response.content


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(title="Claude Delegate Meeting Agent")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "user": config.user_name}


@app.post("/api/respond")
async def respond(req: RespondRequest):
    """Process transcript and return audio response if triggered."""
    print(f"[transcript] {req.speaker}: {req.text}")

    if not should_respond(req.text, req.transcript):
        return JSONResponse({"action": "skip"}, status_code=200)

    print(f"[agent] Generating response to: {req.text}")
    response_text = await generate_response(req.text, req.transcript)
    print(f"[agent] Response: {response_text}")

    audio = await synthesize_speech(response_text)

    if not audio:
        print("[agent] No audio generated")
        return JSONResponse({"action": "no_audio", "text": response_text})

    print(f"[agent] Returning {len(audio)} bytes of audio")
    return Response(content=audio, media_type="audio/mpeg")


# Serve the bot webpage
static_dir = Path(__file__).parent / "static"
app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

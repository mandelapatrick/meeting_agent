"""
Claude Delegate - LiveKit Meeting Agent

LiveKit Agent that processes real-time audio from meetings via the
STT → Claude → ElevenLabs TTS pipeline.

The agent joins a LiveKit room where a bridge webpage (loaded by
Recall.ai's Output Media) publishes the meeting audio. The agent
listens, responds when addressed, and publishes audio back.
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from livekit import agents
from livekit.agents import AgentSession, Agent, room_io
from livekit.plugins import elevenlabs, silero, anthropic, anam

from context_loader import load_meeting_context


# Load context once
meeting_context = load_meeting_context("Meeting")
user_name = os.getenv("DELEGATE_USER_NAME", "User")
voice_id = os.getenv("DELEGATE_VOICE_ID", "")


class MeetingDelegate(Agent):
    def __init__(self, delegate_name: str = "", user_context: str = "") -> None:
        name = delegate_name or user_name
        context_block = f"\n{name}'s context:\n{meeting_context}"
        if user_context:
            context_block += f"\n\n{name}'s instructions for this meeting:\n{user_context}"

        super().__init__(
            instructions=f"""You are {name}'s delegate in a meeting.
Respond to everything you hear. Be concise and natural.
Use first person. Keep responses under 2 sentences.
{context_block}""",
        )


server = agents.AgentServer()


@server.rtc_session(agent_name="claude-delegate")
async def delegate_agent(ctx: agents.JobContext):
    import json

    # Read user info from dispatch metadata
    dispatch_voice_id = voice_id  # default from env
    dispatch_user_name = user_name  # default from env

    dispatch_user_context = ""
    dispatch_avatar_id = ""

    try:
        metadata = json.loads(ctx.job.metadata or "{}")
        if metadata.get("voice_id"):
            dispatch_voice_id = metadata["voice_id"]
        if metadata.get("user_name"):
            dispatch_user_name = metadata["user_name"]
        if metadata.get("user_context"):
            dispatch_user_context = metadata["user_context"]
        if metadata.get("avatar_id"):
            dispatch_avatar_id = metadata["avatar_id"]
    except (json.JSONDecodeError, AttributeError):
        pass

    print(f"[delegate] Voice ID: {dispatch_voice_id or '(default)'}")
    print(f"[delegate] User: {dispatch_user_name}")
    print(f"[delegate] Avatar ID: {dispatch_avatar_id or '(none)'}")
    if dispatch_user_context:
        print(f"[delegate] User context: {dispatch_user_context}")

    session = AgentSession(
        stt=elevenlabs.STT(),
        llm=anthropic.LLM(
            model="claude-sonnet-4-20250514",
            temperature=0.7,
        ),
        tts=elevenlabs.TTS(
            voice_id=dispatch_voice_id,
            model="eleven_turbo_v2_5",
        ),
        vad=silero.VAD.load(),
    )

    # Start Anam avatar BEFORE session.start() — matches Interview project pattern
    if dispatch_avatar_id:
        try:
            avatar = anam.AvatarSession(
                persona_config=anam.PersonaConfig(
                    name=dispatch_user_name or "Delegate",
                    avatarId=dispatch_avatar_id,
                ),
                api_key=os.getenv("ANAM_API_KEY"),
            )
            await avatar.start(session, room=ctx.room)
            print(f"[delegate] Avatar started: {dispatch_avatar_id}")
        except Exception as e:
            print(f"[delegate] Avatar failed, continuing audio-only: {e}")

    await session.start(
        room=ctx.room,
        agent=MeetingDelegate(
            delegate_name=dispatch_user_name,
            user_context=dispatch_user_context,
        ),
    )

    print(f"[delegate] Agent joined room: {ctx.room.name}")
    print(f"[delegate] Listening as {dispatch_user_name}'s delegate...")

    await session.generate_reply(
        instructions=f"Greet the meeting briefly. Say hi, you're {dispatch_user_name}'s delegate, and you're here to help."
    )


if __name__ == "__main__":
    agents.cli.run_app(server)

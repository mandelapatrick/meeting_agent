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
from livekit.agents.llm import StopResponse
from livekit.plugins import elevenlabs, silero, anthropic, anam


user_name = os.getenv("DELEGATE_USER_NAME", "User")
voice_id = os.getenv("DELEGATE_VOICE_ID", "")


class MeetingDelegate(Agent):
    def __init__(
        self,
        delegate_name: str = "",
        user_context: str = "",
        meeting_title: str = "Meeting",
    ) -> None:
        name = delegate_name or user_name
        self._delegate_name = name

        title_line = f' titled "{meeting_title}"' if meeting_title != "Meeting" else ""

        # Build context block with clearly labeled sections
        context_parts = [f"MEETING: {meeting_title}"]
        if user_context:
            context_parts.append(
                f"BRIEFING FROM {name} (treat this as your primary source of knowledge — {name} wrote this for you):\n{user_context}"
            )

        context_block = "\n\n".join(context_parts)

        super().__init__(
            instructions=f"""You are {name}'s AI delegate in a meeting{title_line}.

ROLE: You represent {name} when they cannot attend. You speak on their behalf using the briefing and context provided below. You are NOT {name} — you are their delegate.

WHEN YOU RECEIVE A TRANSCRIPT, ALWAYS RESPOND. The system has already filtered out irrelevant speech — if you receive it, someone is talking to you or asking a question relevant to your context. Answer helpfully and concisely.

WHAT YOU CAN DO:
- Share status updates, timelines, and progress from your briefing
- Explain data, metrics, and technical details covered in your context
- Summarize prior work, decisions, or documented positions
- Clarify {name}'s priorities based on the briefing provided

WHAT YOU CANNOT DO:
- Commit to deadlines or deliverables
- Make decisions requiring {name}'s judgment
- Express opinions beyond what is in your briefing
- Agree to action items or new responsibilities
- If the briefing does not cover a topic, say "I don't have that information from {name}" instead of guessing

DEFER: When asked something requiring {name}'s direct input:
"That's something {name} would need to decide directly. I'll flag it for them."

STYLE:
- 3 sentences max — this is spoken communication
- Professional, concise, collaborative
- Natural speech — no bullet points, no markdown, no lists
- First person when representing {name}'s work ("We shipped that last week")

{context_block}""",
        )

    async def on_user_turn_completed(self, turn_ctx, new_message) -> None:
        """Gate: skip LLM call for speech not directed at the delegate."""
        text = (new_message.text_content or "").lower().strip()
        print(f"[gate] Heard: '{text}'")

        # Skip empty or very short transcripts
        if not text or len(text) < 3:
            print(f"[gate] SKIP — too short")
            raise StopResponse()

        # Build name variants: each word in the name + common STT misspellings
        name_lower = self._delegate_name.lower()
        name_parts = name_lower.split()  # "mandela patrick" -> ["mandela", "patrick"]
        name_variants = set(name_parts + [name_lower, "delegate"])
        # Add common STT misspellings for each name part
        for part in name_parts:
            # Fuzzy: match if STT transcript contains something close
            # Check first 4+ chars as prefix to catch "mandala", "mandara", "mandera"
            if len(part) >= 4:
                name_variants.add(part[:4])  # e.g. "mand" catches mandala/mandara/mandera

        is_addressed = any(v in text for v in name_variants)

        # Check for direct questions
        is_question = text.rstrip().endswith("?")

        print(f"[gate] variants={name_variants} addressed={is_addressed} question={is_question}")

        # Block obvious cross-talk: not addressed and not a question
        if not is_addressed and not is_question:
            print(f"[gate] SKIP — not addressed, not a question")
            raise StopResponse()

        print(f"[gate] PASS — sending to LLM")



server = agents.AgentServer()


@server.rtc_session(agent_name="claude-delegate")
async def delegate_agent(ctx: agents.JobContext):
    import json

    # Read user info from dispatch metadata
    dispatch_voice_id = voice_id  # default from env
    dispatch_user_name = user_name  # default from env

    dispatch_user_context = ""
    dispatch_avatar_id = ""
    dispatch_meeting_title = "Meeting"

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
        if metadata.get("meeting_title"):
            dispatch_meeting_title = metadata["meeting_title"]
    except (json.JSONDecodeError, AttributeError):
        pass

    print(f"[delegate] Voice ID: {dispatch_voice_id or '(default)'}")
    print(f"[delegate] User: {dispatch_user_name}")
    print(f"[delegate] Meeting: {dispatch_meeting_title}")
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
            meeting_title=dispatch_meeting_title,
        ),
    )

    print(f"[delegate] Agent joined room: {ctx.room.name}")
    print(f"[delegate] Listening as {dispatch_user_name}'s delegate...")


if __name__ == "__main__":
    agents.cli.run_app(server)

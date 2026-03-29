"""
Claude Delegate - LiveKit Meeting Agent

LiveKit Agent that processes real-time audio from meetings via the
STT → Claude → ElevenLabs TTS pipeline.

The agent joins a LiveKit room where a bridge webpage (loaded by
Recall.ai's Output Media) publishes the meeting audio. The agent
listens, responds when addressed, and publishes audio back.

After the meeting ends, generates a structured brief and sends it
to the user via Telegram.
"""

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from dotenv import load_dotenv

# Load .env from project root
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

from livekit import agents
from livekit.agents import AgentSession, Agent, room_io
from livekit.agents.llm import StopResponse
from livekit.plugins import elevenlabs, silero, anthropic, anam

try:
    from supabase import create_client
    SUPABASE_URL = os.getenv("NEXT_PUBLIC_SUPABASE_URL", "")
    SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
    supabase = create_client(SUPABASE_URL, SUPABASE_KEY) if SUPABASE_URL and SUPABASE_KEY else None
except ImportError:
    supabase = None

PROXY_URL = os.getenv("PROXY_URL", os.getenv("AGENT_WEBHOOK_URL", ""))

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
        self._transcript: list[dict] = []

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
        text = (new_message.text_content or "").strip()

        # Always record to transcript (before gating)
        if text and len(text) >= 3:
            self._transcript.append({
                "speaker": "participant",
                "text": text,
                "ts": time.time(),
            })

        text_lower = text.lower()
        print(f"[gate] Heard: '{text_lower}'")

        # Skip empty or very short transcripts
        if not text_lower or len(text_lower) < 3:
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

        is_addressed = any(v in text_lower for v in name_variants)

        # Check for direct questions
        is_question = text_lower.rstrip().endswith("?")

        print(f"[gate] variants={name_variants} addressed={is_addressed} question={is_question}")

        # Block obvious cross-talk: not addressed and not a question
        if not is_addressed and not is_question:
            print(f"[gate] SKIP — not addressed, not a question")
            raise StopResponse()

        print(f"[gate] PASS — sending to LLM")



server = agents.AgentServer()


async def _generate_brief(transcript: list[dict], meeting_title: str) -> dict:
    """Call Anthropic API to generate a structured meeting brief."""
    import anthropic as anthropic_sdk

    transcript_text = "\n".join(
        f"[{entry['speaker']}] {entry['text']}" for entry in transcript
    )

    client = anthropic_sdk.AsyncAnthropic()
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": f"""Here is a meeting transcript from "{meeting_title}". Generate a structured brief as JSON.

TRANSCRIPT:
{transcript_text}

Respond with ONLY a JSON object (no markdown fences) with these fields:
- "summary": 2-3 sentence overview of what was discussed
- "decisions": list of strings — decisions made during the meeting (empty list if none)
- "action_items": list of objects with "task", "owner" (if mentioned), "deadline" (if mentioned) — things people committed to doing
- "follow_ups": list of strings — items that need the user's direct attention or input""",
        }],
    )

    text = response.content[0].text.strip()
    # Handle possible markdown fences
    if text.startswith("```"):
        text = text.split("\n", 1)[1].rsplit("```", 1)[0].strip()
    return json.loads(text)


async def _send_brief(session_id: str, user_id: str) -> None:
    """Notify the token server to send the brief via Telegram."""
    if not PROXY_URL:
        print("[brief] No PROXY_URL configured, skipping Telegram send")
        return

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{PROXY_URL}/api/brief/send",
            json={"session_id": session_id, "user_id": user_id},
            timeout=15.0,
        )
    if resp.is_success:
        print(f"[brief] Telegram brief sent for session {session_id}")
    else:
        print(f"[brief] Send failed: {resp.status_code} {resp.text}")


@server.rtc_session(agent_name="claude-delegate")
async def delegate_agent(ctx: agents.JobContext):
    # Read user info from dispatch metadata
    dispatch_voice_id = voice_id  # default from env
    dispatch_user_name = user_name  # default from env

    dispatch_user_context = ""
    dispatch_avatar_id = ""
    dispatch_meeting_title = "Meeting"
    dispatch_session_id = ""
    dispatch_user_id = ""

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
        if metadata.get("session_id"):
            dispatch_session_id = metadata["session_id"]
        if metadata.get("user_id"):
            dispatch_user_id = metadata["user_id"]
    except (json.JSONDecodeError, AttributeError):
        pass

    print(f"[delegate] Voice ID: {dispatch_voice_id or '(default)'}")
    print(f"[delegate] User: {dispatch_user_name}")
    print(f"[delegate] Meeting: {dispatch_meeting_title}")
    print(f"[delegate] Session: {dispatch_session_id or '(none)'}")
    print(f"[delegate] Avatar ID: {dispatch_avatar_id or '(none)'}")
    if dispatch_user_context:
        print(f"[delegate] User context: {dispatch_user_context}")

    delegate = MeetingDelegate(
        delegate_name=dispatch_user_name,
        user_context=dispatch_user_context,
        meeting_title=dispatch_meeting_title,
    )

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

    await session.start(room=ctx.room, agent=delegate)

    # Capture agent responses in the transcript
    def on_conversation_item(event):
        msg = event.item
        if hasattr(msg, "role") and msg.role == "assistant":
            text = (msg.text_content or "").strip() if hasattr(msg, "text_content") else ""
            if text:
                delegate._transcript.append({
                    "speaker": "agent",
                    "text": text,
                    "ts": time.time(),
                })

    session.on("conversation_item_added", on_conversation_item)

    print(f"[delegate] Agent joined room: {ctx.room.name}")
    print(f"[delegate] Listening as {dispatch_user_name}'s delegate...")

    # Register shutdown callback for post-meeting brief
    async def on_meeting_end():
        print(f"[brief] Meeting ended, processing transcript ({len(delegate._transcript)} entries)...")

        transcript = delegate._transcript

        # Handle empty meetings
        if not transcript:
            print("[brief] No transcript entries, updating status only")
            if supabase and dispatch_session_id:
                supabase.table("agent_sessions").update({
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                    "summary": "Your agent attended the meeting but no discussion occurred.",
                }).eq("id", dispatch_session_id).execute()
                await _send_brief(dispatch_session_id, dispatch_user_id)
            return

        # Generate structured brief via Anthropic
        try:
            brief = await _generate_brief(transcript, dispatch_meeting_title)
            print(f"[brief] Generated brief: {len(brief.get('action_items', []))} action items")
        except Exception as e:
            print(f"[brief] Brief generation failed: {e}")
            brief = {
                "summary": "Meeting ended, but brief generation failed. Raw transcript has been saved.",
                "decisions": [],
                "action_items": [],
                "follow_ups": [],
            }

        # Write to Supabase
        if supabase and dispatch_session_id:
            try:
                supabase.table("agent_sessions").update({
                    "transcript": transcript,
                    "summary": brief.get("summary", ""),
                    "action_items": brief.get("action_items", []),
                    "status": "completed",
                    "completed_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", dispatch_session_id).execute()
                print(f"[brief] Saved brief to session {dispatch_session_id}")
            except Exception as e:
                print(f"[brief] Supabase write failed: {e}")

        # Send via Telegram
        if dispatch_session_id and dispatch_user_id:
            try:
                await _send_brief(dispatch_session_id, dispatch_user_id)
            except Exception as e:
                print(f"[brief] Telegram send failed: {e}")

    ctx.add_shutdown_callback(on_meeting_end)


if __name__ == "__main__":
    agents.cli.run_app(server)

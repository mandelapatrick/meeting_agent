"""Claude Delegate Telegram Bot — meeting notifications and delegate dispatch."""

import logging
import os
from datetime import datetime, timezone

import httpx
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from dotenv import load_dotenv
from supabase import create_client
from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import (
    Application,
    CallbackQueryHandler,
    CommandHandler,
    ContextTypes,
    ConversationHandler,
    MessageHandler,
    filters,
)

from calendar_poller import poll_all_users, get_cached_meeting, list_meetings_for_user, _cache_meeting

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Config
TELEGRAM_BOT_TOKEN = os.environ["TELEGRAM_BOT_TOKEN"]
GOOGLE_CLIENT_ID = os.environ["GOOGLE_CLIENT_ID"]
GOOGLE_CLIENT_SECRET = os.environ["GOOGLE_CLIENT_SECRET"]
SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_SERVICE_KEY"]
PROXY_URL = os.environ.get("PROXY_URL", "https://meeting-agent-h4ny.onrender.com")

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Conversation states for "Send with Context"
AWAITING_CONTEXT = 0
AWAITING_CONTEXT_MODE = 1


# ── Helpers ──────────────────────────────────────────────────────────────────


def _get_user_by_chat_id(chat_id: int) -> dict | None:
    result = (
        supabase.table("users")
        .select("id, name, email")
        .eq("telegram_chat_id", chat_id)
        .single()
        .execute()
    )
    return result.data


async def _dispatch_agent(
    user: dict, meeting_url: str, meeting_title: str = "Meeting", context: str = "", mode: str = "audio"
) -> dict:
    """Call the proxy dispatch endpoint to send the delegate to a meeting."""
    payload = {
        "userId": user["id"],
        "meetingUrl": meeting_url,
        "meetingTitle": meeting_title,
        "meetingId": meeting_url,
        "botName": f"{user['name']}'s Delegate",
        "context": context,
        "mode": mode,
    }
    # Render free tier cold starts can take 60+ seconds
    for attempt in range(2):
        try:
            async with httpx.AsyncClient(timeout=90) as client:
                resp = await client.post(f"{PROXY_URL}/api/dispatch", json=payload)
                resp.raise_for_status()
                return resp.json()
        except httpx.ReadTimeout:
            if attempt == 0:
                logger.warning("Dispatch timeout (proxy cold start?), retrying...")
                continue
            raise


# ── Command Handlers ─────────────────────────────────────────────────────────


async def start_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle /start with a deep-link token to connect Telegram to user account."""
    args = context.args
    if not args:
        await update.message.reply_text(
            "Welcome to Claude Delegate!\n\n"
            "To connect your account, use the link from your onboarding page.\n"
            "It looks like: t.me/ClaudeDelegateBot?start=<your-token>"
        )
        return

    link_token = args[0]

    # Look up user by link token
    result = (
        supabase.table("users")
        .select("id, name")
        .eq("telegram_link_token", link_token)
        .single()
        .execute()
    )
    user = result.data

    if not user:
        await update.message.reply_text(
            "Invalid or expired link token. Please try again from your onboarding page."
        )
        return

    # Link Telegram chat to user and clear the token
    supabase.table("users").update({
        "telegram_chat_id": update.effective_chat.id,
        "telegram_link_token": None,
        "onboarding_completed": True,
    }).eq("id", user["id"]).execute()

    await update.message.reply_text(
        f"Connected! Hi {user['name']}.\n\n"
        "I'll notify you before upcoming meetings so you can send your delegate.\n\n"
        "Commands:\n"
        "/meetings — Check upcoming meetings\n"
        "/status — Check delegate status"
    )


async def meetings_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """List upcoming meetings on demand."""
    user = _get_user_by_chat_id(update.effective_chat.id)
    if not user:
        await update.message.reply_text("Please connect your account first via the onboarding link.")
        return

    await update.message.reply_text("Checking your calendar...")

    try:
        meetings = await list_meetings_for_user(
            supabase, user, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET,
        )
    except Exception:
        logger.exception("Failed to fetch meetings for user %s", user["id"])
        await update.message.reply_text("Failed to fetch your calendar. Please try again later.")
        return

    if not meetings:
        await update.message.reply_text("No upcoming meetings found for today.")
        return

    for m in meetings:
        now_dt = datetime.now(timezone.utc)
        delta = m["start_dt"] - now_dt
        minutes = max(1, int(delta.total_seconds() / 60))
        if minutes >= 60:
            time_str = f"in {minutes // 60}h {minutes % 60}m"
        else:
            time_str = f"in {minutes} min"

        attendee_str = ""
        if m["attendees"]:
            names = m["attendees"][:3]
            attendee_str = ", ".join(names)
            if len(m["attendees"]) > 3:
                attendee_str += f" +{len(m['attendees']) - 3} more"

        lines = [f"Meeting {time_str}", f'"{m["summary"]}"']
        if attendee_str:
            lines.append(f"With: {attendee_str}")
        if not m["meeting_url"]:
            lines.append("\nNo meeting link found on this event.")

        text = "\n".join(lines)

        buttons = []
        if m["meeting_url"]:
            cache_key = _cache_meeting(m["event_id"], m["meeting_url"], m["summary"])
            buttons.append([
                InlineKeyboardButton("Audio Delegate", callback_data=f"audio:{cache_key}"),
                InlineKeyboardButton("Send with Context", callback_data=f"context:{cache_key}"),
            ])
            buttons.append([
                InlineKeyboardButton("Skip", callback_data=f"skip:{cache_key}"),
            ])
        else:
            buttons.append([
                InlineKeyboardButton("Skip", callback_data=f"skip:{m['event_id']}"),
            ])

        keyboard = InlineKeyboardMarkup(buttons)
        await context.bot.send_message(
            chat_id=update.effective_chat.id,
            text=text,
            reply_markup=keyboard,
        )


async def status_command(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Check the status of active delegate sessions."""
    user = _get_user_by_chat_id(update.effective_chat.id)
    if not user:
        await update.message.reply_text("Please connect your account first via the onboarding link.")
        return

    result = (
        supabase.table("agent_sessions")
        .select("meeting_title, status, created_at")
        .eq("user_id", user["id"])
        .in_("status", ["pending", "joining", "active"])
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )

    sessions = result.data or []
    if not sessions:
        await update.message.reply_text("No active delegate sessions.")
        return

    lines = ["Active delegate sessions:\n"]
    for s in sessions:
        lines.append(f"  {s['meeting_title']} — {s['status']}")

    await update.message.reply_text("\n".join(lines))


# ── Callback Query Handlers (inline button presses) ─────────────────────────


async def _handle_dispatch(update: Update, mode: str) -> None:
    """Shared dispatch logic for audio/video modes."""
    query = update.callback_query
    await query.answer()

    _, cache_key = query.data.split(":", 1)
    meeting = get_cached_meeting(cache_key)
    if not meeting:
        await query.edit_message_text("Meeting data expired. Please try /meetings again.")
        return

    user = _get_user_by_chat_id(update.effective_chat.id)
    if not user:
        await query.edit_message_text("Account not connected. Use the onboarding link to set up.")
        return

    mode_label = "video" if mode == "video" else "audio"
    try:
        await query.edit_message_text(f"Dispatching {mode_label} delegate... (this may take a moment)")
        result = await _dispatch_agent(user, meeting["meeting_url"], meeting.get("summary", "Meeting"), mode=mode)
        await query.edit_message_text(
            f"Delegate dispatched ({mode_label})!\nSession: {result.get('sessionId', 'started')}"
        )
    except Exception as e:
        logger.exception("Dispatch failed")
        await query.edit_message_text(f"Failed to dispatch delegate: {e}")


async def audio_dispatch_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Audio Delegate' button press."""
    await _handle_dispatch(update, mode="audio")


async def video_dispatch_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Video Delegate' button press."""
    await _handle_dispatch(update, mode="video")


async def skip_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Skip' button press."""
    query = update.callback_query
    await query.answer()
    await query.edit_message_text("Skipped. Won't send a delegate to this meeting.")


async def context_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle 'Send with Context' — ask user for instructions."""
    query = update.callback_query
    await query.answer()

    _, cache_key = query.data.split(":", 1)
    meeting = get_cached_meeting(cache_key)
    if not meeting:
        await query.edit_message_text("Meeting data expired. Please try /meetings again.")
        return ConversationHandler.END

    # Store meeting data in user_data for the next message
    context.user_data["pending_meeting_url"] = meeting["meeting_url"]
    context.user_data["pending_meeting_title"] = meeting.get("summary", "Meeting")

    await query.edit_message_text(
        "How should your delegate show up in this meeting?\n\n"
        "Type your instructions (e.g., \"Focus on the budget discussion, "
        "I'm bearish on Q3 projections\"):"
    )
    return AWAITING_CONTEXT


async def receive_context(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Receive user's meeting context and dispatch audio delegate."""
    user_context = update.message.text
    meeting_url = context.user_data.get("pending_meeting_url")

    if not meeting_url:
        await update.message.reply_text("No pending meeting. Use the buttons from a notification.")
        return ConversationHandler.END

    user = _get_user_by_chat_id(update.effective_chat.id)
    if not user:
        await update.message.reply_text("Account not connected.")
        return ConversationHandler.END

    meeting_title = context.user_data.get("pending_meeting_title", "Meeting")

    try:
        msg = await update.message.reply_text("Dispatching audio delegate with context...")
        result = await _dispatch_agent(user, meeting_url, meeting_title, context=user_context, mode="audio")
        await msg.edit_text(
            f"Delegate dispatched (audio)!\n"
            f"Session: {result.get('sessionId', 'started')}\n\n"
            f"Context: \"{user_context}\""
        )
    except Exception as e:
        logger.exception("Dispatch with context failed")
        await update.message.reply_text(f"Failed to dispatch delegate: {e}")

    # Clean up
    context.user_data.pop("pending_meeting_url", None)
    context.user_data.pop("pending_meeting_title", None)
    return ConversationHandler.END


async def context_mode_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Handle audio/video choice after context is provided."""
    query = update.callback_query
    await query.answer()

    mode = "video" if query.data == "ctx_video" else "audio"
    user_context = context.user_data.get("pending_context", "")
    meeting_url = context.user_data.get("pending_meeting_url")

    if not meeting_url:
        await query.edit_message_text("No pending meeting. Use the buttons from a notification.")
        return ConversationHandler.END

    user = _get_user_by_chat_id(update.effective_chat.id)
    if not user:
        await query.edit_message_text("Account not connected.")
        return ConversationHandler.END

    meeting_title = context.user_data.get("pending_meeting_title", "Meeting")

    try:
        await query.edit_message_text(f"Dispatching {mode} delegate with context...")
        result = await _dispatch_agent(user, meeting_url, meeting_title, context=user_context, mode=mode)
        await query.edit_message_text(
            f"Delegate dispatched ({mode})!\n"
            f"Session: {result.get('sessionId', 'started')}\n\n"
            f"Context: \"{user_context}\""
        )
    except Exception as e:
        logger.exception("Dispatch with context failed")
        await query.edit_message_text(f"Failed to dispatch delegate: {e}")

    # Clean up
    context.user_data.pop("pending_meeting_url", None)
    context.user_data.pop("pending_meeting_title", None)
    context.user_data.pop("pending_context", None)
    return ConversationHandler.END


async def cancel_context(update: Update, context: ContextTypes.DEFAULT_TYPE) -> int:
    """Cancel the context input."""
    context.user_data.pop("pending_meeting_url", None)
    context.user_data.pop("pending_meeting_title", None)
    await update.message.reply_text("Cancelled. Your delegate won't join this meeting.")
    return ConversationHandler.END


# ── Main ─────────────────────────────────────────────────────────────────────


async def post_init(application: Application) -> None:
    """Start the calendar poller after the event loop is running."""
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        poll_all_users,
        "interval",
        minutes=5,
        args=[application, supabase, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, PROXY_URL],
    )
    scheduler.start()
    logger.info("Calendar poller started (every 5 min)")


def main() -> None:
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).post_init(post_init).build()

    # Command handlers
    app.add_handler(CommandHandler("start", start_command))
    app.add_handler(CommandHandler("meetings", meetings_command))
    app.add_handler(CommandHandler("status", status_command))

    # Conversation handler for "Send with Context" flow
    context_conv = ConversationHandler(
        entry_points=[CallbackQueryHandler(context_callback, pattern=r"^context:")],
        states={
            AWAITING_CONTEXT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, receive_context),
                CommandHandler("cancel", cancel_context),
            ],
        },
        fallbacks=[CommandHandler("cancel", cancel_context)],
        per_message=False,
    )
    app.add_handler(context_conv)

    # Button callbacks for audio/video dispatch and skip
    app.add_handler(CallbackQueryHandler(audio_dispatch_callback, pattern=r"^audio:"))
    app.add_handler(CallbackQueryHandler(skip_callback, pattern=r"^skip:"))

    logger.info("Claude Delegate Telegram bot started")
    app.run_polling()


if __name__ == "__main__":
    main()

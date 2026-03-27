"""Claude Delegate Telegram Bot — meeting notifications and delegate dispatch."""

import logging
import os

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

from calendar_poller import poll_all_users, get_cached_meeting

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

# Conversation state for "Send with Context"
AWAITING_CONTEXT = 0


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
    user: dict, meeting_url: str, meeting_title: str = "Meeting", context: str = ""
) -> dict:
    """Call the proxy dispatch endpoint to send the delegate to a meeting."""
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{PROXY_URL}/api/dispatch",
            json={
                "userId": user["id"],
                "meetingUrl": meeting_url,
                "meetingTitle": meeting_title,
                "meetingId": meeting_url,
                "botName": f"{user['name']}'s Delegate",
                "context": context,
            },
        )
        resp.raise_for_status()
        return resp.json()


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

    await update.message.reply_text("Checking your calendar... I'll send notifications for upcoming meetings.")
    # Trigger an immediate poll for this user
    await poll_all_users(
        context.application,
        supabase,
        GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET,
        PROXY_URL,
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


async def dispatch_callback(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Handle 'Send Delegate' button press."""
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

    try:
        result = await _dispatch_agent(user, meeting["meeting_url"], meeting.get("summary", "Meeting"))
        await query.edit_message_text(
            f"Delegate dispatched to your meeting!\nSession: {result.get('sessionId', 'started')}"
        )
    except Exception as e:
        logger.exception("Dispatch failed")
        await query.edit_message_text(f"Failed to dispatch delegate: {e}")


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
    """Receive user's meeting context and dispatch with it."""
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
        result = await _dispatch_agent(user, meeting_url, meeting_title, context=user_context)
        await update.message.reply_text(
            f"Delegate dispatched with your instructions!\n"
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

    # Button callbacks for dispatch and skip
    app.add_handler(CallbackQueryHandler(dispatch_callback, pattern=r"^dispatch:"))
    app.add_handler(CallbackQueryHandler(skip_callback, pattern=r"^skip:"))

    logger.info("Claude Delegate Telegram bot started")
    app.run_polling()


if __name__ == "__main__":
    main()

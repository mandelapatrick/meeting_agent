"""Polls Google Calendar for upcoming meetings and sends Telegram notifications."""

import logging
import re
from datetime import datetime, timedelta, timezone

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from supabase import Client
from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application

logger = logging.getLogger(__name__)

# Track notified events to avoid duplicates (event_id -> expiry time)
_notified: dict[str, datetime] = {}


def _extract_meeting_url(event: dict) -> str | None:
    """Extract a video meeting URL from a calendar event."""
    # Google Meet via hangoutLink
    if event.get("hangoutLink"):
        return event["hangoutLink"]

    # conferenceData entry points
    for ep in event.get("conferenceData", {}).get("entryPoints", []):
        if ep.get("entryPointType") == "video":
            return ep.get("uri")

    # Search location and description for Zoom/Meet URLs
    for field in ("location", "description"):
        text = event.get(field, "") or ""
        match = re.search(
            r"https?://(?:[\w-]+\.)?zoom\.us/j/\S+|https?://meet\.google\.com/\S+",
            text,
        )
        if match:
            return match.group(0)

    return None


def _format_time_until(start_dt: datetime) -> str:
    """Format a human-readable 'in X min' string."""
    delta = start_dt - datetime.now(timezone.utc)
    minutes = max(1, int(delta.total_seconds() / 60))
    if minutes >= 60:
        return f"in {minutes // 60}h {minutes % 60}m"
    return f"in {minutes} min"


async def poll_all_users(
    app: Application,
    supabase: Client,
    google_client_id: str,
    google_client_secret: str,
    proxy_url: str,
) -> None:
    """Poll calendar for all Telegram-connected users and send notifications."""
    # Clean up expired notification tracking
    now = datetime.now(timezone.utc)
    expired = [eid for eid, exp in _notified.items() if exp < now]
    for eid in expired:
        del _notified[eid]

    # Get all users with a Telegram chat ID and Google tokens
    result = supabase.table("users").select("id, name, telegram_chat_id").not_.is_("telegram_chat_id", "null").execute()
    users = result.data or []

    for user in users:
        try:
            await _poll_user(app, supabase, user, google_client_id, google_client_secret, proxy_url)
        except Exception:
            logger.exception("Failed to poll calendar for user %s", user["id"])


async def _poll_user(
    app: Application,
    supabase: Client,
    user: dict,
    google_client_id: str,
    google_client_secret: str,
    proxy_url: str,
) -> None:
    """Poll calendar for a single user."""
    # Get Google tokens
    token_result = (
        supabase.table("connector_tokens")
        .select("access_token, refresh_token, expires_at")
        .eq("user_id", user["id"])
        .eq("provider", "google")
        .single()
        .execute()
    )
    token_row = token_result.data
    if not token_row or not token_row.get("refresh_token"):
        return

    # Build Google credentials
    creds = Credentials(
        token=token_row["access_token"],
        refresh_token=token_row["refresh_token"],
        token_uri="https://oauth2.googleapis.com/token",
        client_id=google_client_id,
        client_secret=google_client_secret,
    )

    # Refresh if expired
    if creds.expired or not creds.valid:
        from google.auth.transport.requests import Request
        creds.refresh(Request())
        # Update stored tokens
        supabase.table("connector_tokens").update({
            "access_token": creds.token,
            "expires_at": creds.expiry.isoformat() if creds.expiry else None,
        }).eq("user_id", user["id"]).eq("provider", "google").execute()

    # Query upcoming events (next 20 minutes)
    service = build("calendar", "v3", credentials=creds)
    now_dt = datetime.now(timezone.utc)
    time_min = now_dt.isoformat()
    time_max = (now_dt + timedelta(minutes=20)).isoformat()

    events_result = (
        service.events()
        .list(
            calendarId="primary",
            timeMin=time_min,
            timeMax=time_max,
            singleEvents=True,
            orderBy="startTime",
        )
        .execute()
    )

    for event in events_result.get("items", []):
        event_id = event["id"]
        if event_id in _notified:
            continue

        summary = event.get("summary", "Untitled Meeting")
        start = event["start"].get("dateTime", event["start"].get("date"))
        start_dt = datetime.fromisoformat(start)
        meeting_url = _extract_meeting_url(event)

        # Build attendee list
        attendees = [
            a.get("displayName") or a.get("email", "")
            for a in event.get("attendees", [])
            if not a.get("self")
        ]
        attendee_str = ", ".join(attendees[:3])
        if len(attendees) > 3:
            attendee_str += f" +{len(attendees) - 3} more"

        time_str = _format_time_until(start_dt)

        # Build message
        lines = [f"Meeting {time_str}", f'"{summary}"']
        if attendee_str:
            lines.append(f"With: {attendee_str}")
        if not meeting_url:
            lines.append("\nNo meeting link found on this event.")

        text = "\n".join(lines)

        # Build inline keyboard
        buttons = []
        if meeting_url:
            buttons.append([
                InlineKeyboardButton("Send Delegate", callback_data=f"dispatch:{event_id}:{meeting_url}"),
                InlineKeyboardButton("Skip", callback_data=f"skip:{event_id}"),
            ])
            buttons.append([
                InlineKeyboardButton("Send with Context", callback_data=f"context:{event_id}:{meeting_url}"),
            ])
        else:
            buttons.append([
                InlineKeyboardButton("Skip", callback_data=f"skip:{event_id}"),
            ])

        keyboard = InlineKeyboardMarkup(buttons)

        # Send notification
        await app.bot.send_message(
            chat_id=user["telegram_chat_id"],
            text=text,
            reply_markup=keyboard,
        )

        # Mark as notified (expire after event end time + buffer)
        end = event["end"].get("dateTime", event["end"].get("date"))
        end_dt = datetime.fromisoformat(end)
        _notified[event_id] = end_dt + timedelta(minutes=5)

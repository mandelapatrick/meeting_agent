---
name: list-meetings
description: List upcoming meetings for the current week from Google Calendar. Use when the user asks to see their meetings, schedule, or calendar.
disable-model-invocation: false
allowed-tools:
  - mcp__meeting-agent__list_meetings
  - mcp__claude_ai_Google_Calendar__gcal_list_events
---

# List Meetings

Fetch and display the user's upcoming meetings from Google Calendar.

## Workflow

1. Call `list_meetings` to fetch upcoming meetings (default: next 1 day, use `days` param for more).
2. Display results in a clean format showing:
   - Meeting title
   - Date and time
   - Duration
   - Attendees
   - Meeting link (Zoom/Google Meet)

## Output Format

Present meetings grouped by day, in chronological order. For each meeting with a video link, note that the user can say "send my agent to [meeting name]" to dispatch their delegate.

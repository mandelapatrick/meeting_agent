---
name: list-meetings
description: List upcoming meetings for the current week from Google Calendar. Use when the user asks to see their meetings, schedule, or calendar.
disable-model-invocation: false
allowed-tools:
  - mcp__claude_ai_Google_Calendar__gcal_list_events
---

# List Meetings

Fetch and display the user's upcoming meetings from Google Calendar using Claude.ai's Google Calendar integration.

## Workflow

1. Call `gcal_list_events` to fetch upcoming meetings for the next 7 days.
2. Display results in a clean table format showing:
   - Meeting title
   - Date and time
   - Duration
   - Attendees
   - Meeting link (Zoom/Google Meet) — extract from hangoutLink, conferenceData, description, or location fields

## Output Format

Present meetings grouped by day, in chronological order. For each meeting, extract the video meeting URL if available (look in hangoutLink, conferenceData.entryPoints, description, and location fields for Zoom or Google Meet links).

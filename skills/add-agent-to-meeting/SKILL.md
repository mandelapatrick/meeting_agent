---
name: add-agent-to-meeting
description: Add your AI delegate agent to a specific meeting so it can attend on your behalf. Use when the user wants their agent to join, attend, or represent them in a meeting.
argument-hint: <meeting name or ID>
disable-model-invocation: false
allowed-tools:
  - mcp__meeting-agent__list_meetings
  - mcp__meeting-agent__add_agent_to_meeting
  - mcp__meeting-agent__get_onboarding_status
---

# Add Agent to Meeting

Dispatch your embodied AI delegate to attend a meeting on your behalf. The agent will join using your cloned voice and profile photo, listen to the conversation, and respond when addressed.

## Workflow

1. Check onboarding status. If not complete, tell user to run `/onboard` first.
2. If no meeting specified, call `list_meetings` to list upcoming meetings and ask the user to pick one.
3. If a meeting name is provided, call `list_meetings` and fuzzy-match the name.
4. The meeting URL is returned by `list_meetings` in the `meetingUrl` field.
5. Confirm with the user before dispatching: show meeting title, time, and attendees.
6. Call `add_agent_to_meeting` with the `meeting_url` and `meeting_title`.
7. Report the agent status (joining, waiting room, active).

## Agent Behavior

The delegate agent will:
- Join the meeting with the user's name + " (AI Delegate)"
- Listen to all conversation and maintain a transcript
- Respond ONLY when directly addressed by name or asked a direct question
- Use the user's cloned voice for responses
- Draw on the user's second brain for context
- Generate a post-meeting summary with action items

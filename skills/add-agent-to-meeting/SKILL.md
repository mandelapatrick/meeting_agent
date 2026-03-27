---
name: add-agent-to-meeting
description: Add your AI delegate agent to a specific meeting so it can attend on your behalf. Use when the user wants their agent to join, attend, or represent them in a meeting.
argument-hint: <meeting name or ID>
disable-model-invocation: false
allowed-tools:
  - mcp__claude_ai_Google_Calendar__gcal_list_events
  - mcp__claude-delegate__add_agent_to_meeting
  - mcp__claude-delegate__get_onboarding_status
---

# Add Agent to Meeting

Dispatch your embodied AI delegate to attend a meeting on your behalf. The agent will join using your cloned voice and profile photo, listen to the conversation, and respond when addressed.

## Workflow

1. Check onboarding status. If not complete, tell user to run `/onboard` first.
2. If no meeting specified, call `gcal_list_events` to list upcoming meetings and ask the user to pick one.
3. If a meeting name is provided, call `gcal_list_events` and fuzzy-match the name.
4. Extract the meeting URL from the calendar event:
   - Check `hangoutLink` for Google Meet
   - Check `conferenceData.entryPoints` for video entry points
   - Search `description` and `location` for Zoom or Google Meet URLs
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

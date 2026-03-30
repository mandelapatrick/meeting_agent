---
name: onboard
description: Set up your AI delegate by creating your voice clone, avatar, and connecting your accounts. Use when the user wants to set up, configure, or create their delegate.
disable-model-invocation: false
allowed-tools:
  - mcp__meeting-agent__get_onboarding_status
  - mcp__meeting-agent__open_onboarding
---

# Onboard — Create Your AI Delegate

Guide the user through setting up their embodied AI delegate agent.

## Workflow

1. Call `get_onboarding_status` to check current progress.
2. If already complete, tell the user and offer to re-do specific steps.
3. If not started or incomplete, call `open_onboarding` to launch the onboarding wizard in their browser.
4. Explain the steps they'll complete:
   - **Sign in** with Google
   - **Confirm** name and email
   - **Record voice** (30 seconds) to clone their voice
   - **Capture photo** for their meeting avatar
   - **Connect accounts** — Google Calendar, GitHub, Slack
   - **Set up PARA** structure for their second brain
   - **Optional:** Populate second brain with existing knowledge
5. After they complete onboarding in the browser, verify status with `get_onboarding_status`.

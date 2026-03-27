import { getOnboardingStatus, dispatchAgent } from "../services/proxy.js";

export async function addAgentHandler(args: {
  meeting_url: string;
  meeting_title?: string;
}): Promise<string> {
  const status = await getOnboardingStatus();
  if (!status.completed || !status.user) {
    return "Error: You need to complete onboarding first. Run `/onboard` to set up your delegate.";
  }

  const meetingUrl = args.meeting_url;
  const meetingTitle = args.meeting_title || "Meeting";

  if (!meetingUrl) {
    return "Error: No meeting URL provided. Please provide a Zoom or Google Meet link.";
  }

  const botName = `${status.user.name}'s Delegate`;
  const platform = meetingUrl.includes("zoom") ? "Zoom" : "Google Meet";

  const result = await dispatchAgent({
    meetingUrl,
    meetingTitle,
    meetingId: meetingUrl,
    botName,
    userId: status.user.id,
  });

  return [
    `## Delegate Dispatched`,
    ``,
    `Your AI delegate is joining **${meetingTitle}**.`,
    ``,
    `- **Meeting:** ${meetingTitle}`,
    `- **Platform:** ${platform}`,
    `- **Bot Name:** ${botName}`,
    `- **Status:** ${result.status}`,
    `- **Session ID:** \`${result.sessionId}\``,
    ``,
    `The delegate will:`,
    `- Listen to the conversation`,
    `- Respond when addressed by name`,
    `- Use your voice and context from your second brain`,
    `- Generate a summary after the meeting ends`,
  ].join("\n");
}

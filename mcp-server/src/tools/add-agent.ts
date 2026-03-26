import { getMeetingById, getOnboardingStatus, dispatchAgent } from "../services/proxy.js";

export const addAgentToolDef = {
  name: "add_agent_to_meeting",
  description:
    "Dispatch your AI delegate agent to join a specific meeting. The agent will attend using your cloned voice and respond when addressed.",
  inputSchema: {
    type: "object" as const,
    properties: {
      meeting_id: {
        type: "string",
        description: "The meeting ID from list_meetings (e.g., evt_001)",
      },
    },
    required: ["meeting_id"],
  },
};

export async function addAgentHandler(args: {
  meeting_id: string;
}): Promise<string> {
  const status = await getOnboardingStatus();
  if (!status.completed || !status.user) {
    return "Error: You need to complete onboarding first. Run `/onboard` to set up your delegate.";
  }

  const meeting = await getMeetingById(args.meeting_id);
  if (!meeting) {
    return `Error: Meeting with ID "${args.meeting_id}" not found. Run \`/list-meetings\` to see available meetings.`;
  }

  if (!meeting.meetingUrl) {
    return `Error: Meeting "${meeting.title}" has no meeting link. Cannot dispatch agent without a Zoom or Google Meet URL.`;
  }

  if (meeting.hasAgent) {
    return `Your delegate is already assigned to "${meeting.title}".`;
  }

  const botName = `${status.user.name}'s Delegate`;
  const result = await dispatchAgent({
    meetingUrl: meeting.meetingUrl,
    meetingTitle: meeting.title,
    meetingId: meeting.id,
    botName,
    userId: status.user.id,
  });

  return [
    `## Delegate Dispatched`,
    ``,
    `Your AI delegate is joining **${meeting.title}**.`,
    ``,
    `- **Meeting:** ${meeting.title}`,
    `- **Time:** ${new Date(meeting.start).toLocaleString()}`,
    `- **Platform:** ${meeting.platform === "zoom" ? "Zoom" : "Google Meet"}`,
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

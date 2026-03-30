import { getOnboardingStatus } from "../services/proxy.js";

const PROXY_URL =
  process.env.PROXY_URL || "https://meeting-agent-h4ny.onrender.com";

export async function listMeetingsHandler(args: {
  days?: number;
}): Promise<string> {
  const status = await getOnboardingStatus();
  if (!status.completed || !status.user) {
    return "Error: You need to complete onboarding first. Run `/onboard` to set up your delegate.";
  }

  const days = args.days || 1;

  const response = await fetch(`${PROXY_URL}/api/calendar/list`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: status.user.email, days }),
  });

  if (!response.ok) {
    const error = await response.text();
    return `Error fetching meetings: ${error}`;
  }

  const data = (await response.json()) as {
    meetings: Array<{
      title: string;
      start: string;
      end: string;
      meetingUrl: string | null;
      attendees: string[];
      eventId: string;
    }>;
  };

  if (!data.meetings || data.meetings.length === 0) {
    return `No upcoming meetings found for the next ${days} day(s).`;
  }

  let output = `## Upcoming Meetings (next ${days} day${days > 1 ? "s" : ""})\n\n`;

  for (const meeting of data.meetings) {
    const start = new Date(meeting.start);
    const end = new Date(meeting.end);
    const duration = Math.round(
      (end.getTime() - start.getTime()) / (1000 * 60)
    );
    const timeStr = start.toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });

    output += `### ${meeting.title}\n`;
    output += `- **Time:** ${timeStr} (${duration} min)\n`;
    if (meeting.attendees.length > 0) {
      const shown = meeting.attendees.slice(0, 5).join(", ");
      const extra =
        meeting.attendees.length > 5
          ? ` +${meeting.attendees.length - 5} more`
          : "";
      output += `- **Attendees:** ${shown}${extra}\n`;
    }
    if (meeting.meetingUrl) {
      output += `- **Link:** ${meeting.meetingUrl}\n`;
    } else {
      output += `- **Link:** No meeting link found\n`;
    }
    output += "\n";
  }

  return output;
}

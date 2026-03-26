import { listMeetings, type Meeting } from "../services/proxy.js";

export const listMeetingsToolDef = {
  name: "list_meetings",
  description:
    "List upcoming meetings for the current week from the user's Google Calendar. Returns meeting titles, times, attendees, and meeting links.",
  inputSchema: {
    type: "object" as const,
    properties: {
      days: {
        type: "number",
        description:
          "Number of days ahead to look (default: 7, max: 30)",
        default: 7,
      },
    },
  },
};

export async function listMeetingsHandler(args: {
  days?: number;
}): Promise<string> {
  const days = args.days ?? 7;
  const meetings = await listMeetings(days);

  if (meetings.length === 0) {
    return "No upcoming meetings found for this week.";
  }

  const grouped = groupByDay(meetings);
  let output = "## Upcoming Meetings\n\n";

  for (const [day, dayMeetings] of Object.entries(grouped)) {
    output += `### ${day}\n\n`;
    for (const m of dayMeetings) {
      const time = formatTime(m.start, m.end);
      const agentBadge = m.hasAgent ? " [DELEGATE ASSIGNED]" : "";
      const platform =
        m.platform === "zoom"
          ? "Zoom"
          : m.platform === "google_meet"
            ? "Google Meet"
            : "Unknown";

      output += `- **${m.title}**${agentBadge}\n`;
      output += `  - Time: ${time} (${m.duration})\n`;
      output += `  - Platform: ${platform}\n`;
      output += `  - Attendees: ${m.attendees.join(", ")}\n`;
      output += `  - Link: ${m.meetingUrl ?? "No link"}\n`;
      output += `  - ID: \`${m.id}\`\n\n`;
    }
  }

  return output;
}

function groupByDay(meetings: Meeting[]): Record<string, Meeting[]> {
  const groups: Record<string, Meeting[]> = {};
  for (const m of meetings) {
    const day = new Date(m.start).toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    if (!groups[day]) groups[day] = [];
    groups[day].push(m);
  }
  return groups;
}

function formatTime(start: string, end: string): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  return `${fmt(start)} – ${fmt(end)}`;
}

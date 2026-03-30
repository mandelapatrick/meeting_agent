import { getOnboardingStatus } from "../services/proxy.js";

const PROXY_URL =
  process.env.PROXY_URL || "https://meeting-agent-h4ny.onrender.com";

export async function getAgentStatusHandler(): Promise<string> {
  const status = await getOnboardingStatus();
  if (!status.completed || !status.user) {
    return "Error: You need to complete onboarding first. Run `/onboard` to set up your delegate.";
  }

  const response = await fetch(`${PROXY_URL}/api/sessions/active`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: status.user.email }),
  });

  if (!response.ok) {
    return `Error fetching agent status: ${await response.text()}`;
  }

  const data = (await response.json()) as {
    sessions: Array<{
      id: string;
      meeting_title: string;
      status: string;
      created_at: string;
    }>;
  };

  if (!data.sessions || data.sessions.length === 0) {
    return "No active agent sessions.";
  }

  let output = "## Active Agent Sessions\n\n";
  for (const session of data.sessions) {
    output += `- **${session.meeting_title}** — ${session.status} (session: \`${session.id}\`)\n`;
  }

  return output;
}

export async function getMeetingBriefHandler(args: {
  session_id?: string;
}): Promise<string> {
  const status = await getOnboardingStatus();
  if (!status.completed || !status.user) {
    return "Error: You need to complete onboarding first. Run `/onboard` to set up your delegate.";
  }

  const body: Record<string, string> = { email: status.user.email };
  if (args.session_id) {
    body.sessionId = args.session_id;
  }

  const response = await fetch(`${PROXY_URL}/api/brief/get`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    return `Error fetching brief: ${await response.text()}`;
  }

  const data = (await response.json()) as {
    brief?: {
      meeting_title: string;
      summary: string;
      action_items: Array<{ task: string; owner?: string; deadline?: string } | string>;
    };
    briefs?: Array<{
      id: string;
      meeting_title: string;
      summary: string;
      action_items: Array<{ task: string; owner?: string; deadline?: string } | string>;
      created_at: string;
    }>;
  };

  if (args.session_id && data.brief) {
    return formatBrief(data.brief);
  }

  if (data.briefs && data.briefs.length > 0) {
    let output = "## Recent Meeting Briefs\n\n";
    for (const brief of data.briefs) {
      output += formatBrief(brief) + "\n---\n\n";
    }
    return output;
  }

  return "No meeting briefs found.";
}

function formatBrief(brief: {
  meeting_title: string;
  summary: string;
  action_items: Array<{ task: string; owner?: string; deadline?: string } | string>;
}): string {
  let output = `### ${brief.meeting_title}\n\n`;
  output += `**Summary:** ${brief.summary || "No summary available."}\n\n`;

  if (brief.action_items && brief.action_items.length > 0) {
    output += "**Action Items:**\n";
    for (const item of brief.action_items) {
      if (typeof item === "string") {
        output += `- ${item}\n`;
      } else {
        const parts = [item.task];
        if (item.owner) parts.push(item.owner);
        if (item.deadline) parts.push(`by ${item.deadline}`);
        output += `- ${parts.join(" — ")}\n`;
      }
    }
  }

  return output;
}

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { addAgentHandler } from "./tools/add-agent.js";
import {
  getOnboardingStatusHandler,
  openOnboardingHandler,
} from "./tools/onboarding.js";
import {
  searchBrainHandler,
  addBrainEntryHandler,
} from "./tools/manage-brain.js";
import { listMeetingsHandler } from "./tools/list-meetings.js";
import {
  getAgentStatusHandler,
  getMeetingBriefHandler,
} from "./tools/sessions.js";

const server = new McpServer({
  name: "meeting-agent",
  version: "0.1.0",
});

// Register tools with Zod schemas
server.tool(
  "add_agent_to_meeting",
  "Dispatch your AI delegate agent to join a specific meeting",
  {
    meeting_url: z.string().describe("The meeting URL (Zoom or Google Meet link)"),
    meeting_title: z.string().optional().default("Meeting").describe("The meeting title"),
  },
  async (args) => ({
    content: [{ type: "text", text: await addAgentHandler(args) }],
  })
);

server.tool(
  "get_onboarding_status",
  "Check the current onboarding status of the user's AI delegate setup",
  {},
  async () => ({
    content: [{ type: "text", text: await getOnboardingStatusHandler() }],
  })
);

server.tool(
  "open_onboarding",
  "Open the onboarding wizard in the user's browser to set up their AI delegate",
  {},
  async () => ({
    content: [{ type: "text", text: await openOnboardingHandler() }],
  })
);

server.tool(
  "search_brain",
  "Search the user's second brain (PARA knowledge base) for relevant context",
  {
    query: z.string().describe("Search query to find relevant knowledge entries"),
    category: z
      .enum(["projects", "areas", "resources", "archive"])
      .optional()
      .describe("Optional: filter by PARA category"),
  },
  async (args) => ({
    content: [{ type: "text", text: await searchBrainHandler(args) }],
  })
);

server.tool(
  "add_brain_entry",
  "Add a new entry to the user's second brain PARA structure",
  {
    title: z.string().describe("Title of the knowledge entry"),
    content: z.string().describe("Content of the knowledge entry (markdown)"),
    category: z
      .enum(["projects", "areas", "resources", "archive"])
      .describe("PARA category for the entry"),
    tags: z.array(z.string()).optional().describe("Optional tags for the entry"),
  },
  async (args) => ({
    content: [{ type: "text", text: await addBrainEntryHandler(args) }],
  })
);

server.tool(
  "list_meetings",
  "List upcoming meetings from the user's Google Calendar",
  {
    days: z
      .number()
      .optional()
      .default(1)
      .describe("Number of days to look ahead (default: 1)"),
  },
  async (args) => ({
    content: [{ type: "text", text: await listMeetingsHandler(args) }],
  })
);

server.tool(
  "get_agent_status",
  "Check the status of active AI delegate sessions in meetings",
  {},
  async () => ({
    content: [{ type: "text", text: await getAgentStatusHandler() }],
  })
);

server.tool(
  "get_meeting_brief",
  "Get post-meeting briefs with summaries and action items",
  {
    session_id: z
      .string()
      .optional()
      .describe(
        "Specific session ID to get brief for. If omitted, returns recent briefs."
      ),
  },
  async (args) => ({
    content: [{ type: "text", text: await getMeetingBriefHandler(args) }],
  })
);

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("MCP server error:", error);
  process.exit(1);
});

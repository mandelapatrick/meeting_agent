/**
 * Proxy client — all API calls go through the hosted proxy API.
 * No secrets needed in the plugin.
 */

const PROXY_URL =
  process.env.PROXY_URL || "https://meeting-agent-h4ny.onrender.com";

/**
 * Read identity from env vars (set in .mcp.json by onboarding).
 * Falls back to legacy file locations for backward compat.
 */
async function readIdentity(): Promise<Record<string, unknown> | null> {
  // Primary: env vars injected into .mcp.json (always works in sandbox)
  if (process.env.DELEGATE_EMAIL) {
    return {
      email: process.env.DELEGATE_EMAIL,
      name: process.env.DELEGATE_NAME,
    };
  }

  // Legacy fallback: read from file
  const fs = await import("fs/promises");
  const os = await import("os");
  const path = await import("path");
  const locations = [
    path.join(os.homedir(), ".claude-delegate", "identity.json"),
    path.resolve(process.cwd(), ".claude-delegate", "identity.json"),
    path.resolve(process.cwd(), ".claude-delegate-token"),
  ];
  for (const loc of locations) {
    try {
      const data = await fs.readFile(loc, "utf-8");
      return JSON.parse(data);
    } catch {}
  }
  return null;
}

/**
 * Save identity to .mcp.json env vars so the MCP server can read them
 * without file I/O (avoids sandbox issues).
 */
export async function saveIdentity(identity: {
  email: string;
  name: string;
}): Promise<void> {
  const fs = await import("fs/promises");
  const path = await import("path");

  // Find .mcp.json — check cwd, then look for CLAUDE.md-adjacent
  const mcpPath = path.resolve(process.cwd(), ".mcp.json");
  let config: any;
  try {
    config = JSON.parse(await fs.readFile(mcpPath, "utf-8"));
  } catch {
    config = { mcpServers: {} };
  }

  // Inject identity as env vars into the claude-delegate server config
  const server = config.mcpServers?.["claude-delegate"];
  if (server) {
    server.env = {
      ...server.env,
      DELEGATE_EMAIL: identity.email,
      DELEGATE_NAME: identity.name,
    };
    // Remove legacy google ID if present
    delete server.env.DELEGATE_GOOGLE_ID;
    await fs.writeFile(mcpPath, JSON.stringify(config, null, 2) + "\n");
  }
}

// ---- Dispatch ----

export interface DispatchResult {
  botId: string;
  status: string;
  sessionId: string;
  roomName: string;
}

export async function dispatchAgent(args: {
  meetingUrl: string;
  meetingTitle: string;
  meetingId: string;
  botName: string;
  userId: string;
}): Promise<DispatchResult> {
  const response = await fetch(`${PROXY_URL}/api/dispatch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to dispatch agent: ${error}`);
  }

  return response.json();
}

// ---- Onboarding ----

export interface OnboardingStatus {
  completed: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    onboardingCompleted: boolean;
  };
  steps: Record<string, boolean>;
}

export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const tokenData = await readIdentity();
  if (!tokenData) {
    return {
      completed: false,
      steps: {
        profile: false,
        voiceClone: false,
        avatar: false,
        connectors: false,
        paraSetup: false,
      },
    };
  }

  const response = await fetch(`${PROXY_URL}/api/onboarding/status`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tokenData),
  });

  if (!response.ok) {
    throw new Error("Failed to get onboarding status");
  }

  return response.json();
}

export function getAppUrl(): string {
  return process.env.APP_URL || "https://meeetingagent.vercel.app";
}

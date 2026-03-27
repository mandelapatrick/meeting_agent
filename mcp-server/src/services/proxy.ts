/**
 * Proxy client — all API calls go through the hosted proxy API.
 * No secrets needed in the plugin.
 */

const PROXY_URL =
  process.env.PROXY_URL || "https://meeting-agent-h4ny.onrender.com";

function getTokenDir(): string {
  const os = require("os");
  const path = require("path");
  return path.join(os.homedir(), ".claude-delegate");
}

function getTokenPath(): string {
  const path = require("path");
  return path.join(getTokenDir(), "identity.json");
}

function getCwdTokenDir(): string {
  const path = require("path");
  return path.join(process.cwd(), ".claude-delegate");
}

function getCwdTokenPath(): string {
  const path = require("path");
  return path.join(getCwdTokenDir(), "identity.json");
}

async function readTokenFile(): Promise<Record<string, unknown> | null> {
  const fs = await import("fs/promises");
  const path = await import("path");
  // Try home directory first
  try {
    const data = await fs.readFile(getTokenPath(), "utf-8");
    return JSON.parse(data);
  } catch {}
  // Try cwd-based location (works inside sandbox)
  try {
    const data = await fs.readFile(getCwdTokenPath(), "utf-8");
    return JSON.parse(data);
  } catch {}
  // Legacy fallback
  try {
    const oldPath = path.resolve(process.cwd(), ".claude-delegate-token");
    const data = await fs.readFile(oldPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export async function writeTokenFile(data: Record<string, unknown>): Promise<void> {
  const fs = await import("fs/promises");
  // Primary: home directory
  await fs.mkdir(getTokenDir(), { recursive: true });
  await fs.writeFile(getTokenPath(), JSON.stringify(data, null, 2));
  // Secondary: cwd (accessible inside sandbox)
  try {
    await fs.mkdir(getCwdTokenDir(), { recursive: true });
    await fs.writeFile(getCwdTokenPath(), JSON.stringify(data, null, 2));
  } catch {
    // Best-effort; cwd may not be writable
  }
}

// ---- Meetings ----

export interface Meeting {
  id: string;
  title: string;
  start: string;
  end: string;
  duration: string;
  attendees: string[];
  meetingUrl: string | null;
  platform: "zoom" | "google_meet" | "unknown";
  hasAgent: boolean;
}

export async function listMeetings(days: number = 7): Promise<Meeting[]> {
  const tokenData = await readTokenFile();
  if (!tokenData?.googleId && !tokenData?.email) {
    throw new Error(
      "No identity found. Run `/onboard` to connect your Google Calendar."
    );
  }

  const response = await fetch(`${PROXY_URL}/api/meetings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      googleId: tokenData.googleId,
      email: tokenData.email,
      refreshToken: tokenData.refreshToken, // backward compat
      days,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to list meetings: ${error}`);
  }

  const data = await response.json();

  // Transform Google Calendar events into Meeting objects
  return (data.events || [])
    .filter((event: any) => event.start?.dateTime)
    .map((event: any) => {
      const meetingUrl = extractMeetingUrl(event);
      const start = new Date(event.start.dateTime);
      const endTime = new Date(event.end.dateTime);
      const durationMin = Math.round(
        (endTime.getTime() - start.getTime()) / 60000
      );
      const duration =
        durationMin >= 60
          ? `${Math.floor(durationMin / 60)} hr${durationMin % 60 ? ` ${durationMin % 60} min` : ""}`
          : `${durationMin} min`;

      return {
        id: event.id,
        title: event.summary || "Untitled",
        start: event.start.dateTime,
        end: event.end.dateTime,
        duration,
        attendees: (event.attendees || []).map((a: any) => a.email),
        meetingUrl,
        platform: meetingUrl
          ? meetingUrl.includes("zoom")
            ? "zoom"
            : "google_meet"
          : ("unknown" as const),
        hasAgent: false,
      };
    });
}

function extractMeetingUrl(event: any): string | null {
  if (event.hangoutLink) return event.hangoutLink;
  if (event.conferenceData?.entryPoints) {
    const videoEntry = event.conferenceData.entryPoints.find(
      (e: any) => e.entryPointType === "video"
    );
    if (videoEntry) return videoEntry.uri;
  }
  const text = `${event.description || ""} ${event.location || ""}`;
  const zoomMatch = text.match(/https:\/\/[\w.-]*zoom\.us\/j\/\d+[^\s)"]*/);
  if (zoomMatch) return zoomMatch[0];
  const meetMatch = text.match(/https:\/\/meet\.google\.com\/[a-z-]+/);
  if (meetMatch) return meetMatch[0];
  return null;
}

export async function getMeetingById(
  meetingId: string
): Promise<Meeting | null> {
  const meetings = await listMeetings();
  return meetings.find((m) => m.id === meetingId) ?? null;
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
  const tokenData = await readTokenFile();
  if (!tokenData) {
    return {
      completed: false,
      steps: {
        signIn: false,
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

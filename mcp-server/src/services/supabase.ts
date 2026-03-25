import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.warn(
    "[supabase] NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_KEY not set — database operations will fail"
  );
}

const supabase = createClient(supabaseUrl || "", supabaseKey || "");

export interface User {
  id: string;
  googleId: string;
  email: string;
  name: string;
  voiceCloneId: string | null;
  avatarId: string | null;
  onboardingCompleted: boolean;
  connectors: {
    calendar: boolean;
    github: boolean;
    slack: boolean;
  };
}

export interface AgentSession {
  id: string;
  userId: string;
  meetingId: string;
  meetingTitle: string;
  recallBotId: string;
  status: "pending" | "joining" | "active" | "completed" | "failed";
}

interface TokenData {
  googleId?: string;
  email?: string;
  name?: string;
}

async function readTokenIdentity(): Promise<TokenData | null> {
  const fs = await import("fs/promises");
  const path = await import("path");
  const tokenPath = path.resolve(process.cwd(), ".claude-delegate-token");
  try {
    const data = await fs.readFile(tokenPath, "utf-8");
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function mapRowToUser(row: any): User {
  return {
    id: row.id,
    googleId: row.google_id,
    email: row.email,
    name: row.name,
    voiceCloneId: row.voice_clone_id || null,
    avatarId: row.avatar_url || null,
    onboardingCompleted: row.onboarding_completed || false,
    connectors: row.connectors || {
      calendar: false,
      github: false,
      slack: false,
    },
  };
}

export async function getUser(): Promise<User | null> {
  const identity = await readTokenIdentity();
  if (!identity?.googleId && !identity?.email) {
    return null;
  }

  let query = supabase.from("users").select("*");

  if (identity.googleId) {
    query = query.eq("google_id", identity.googleId);
  } else if (identity.email) {
    query = query.eq("email", identity.email);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    return null;
  }

  return mapRowToUser(data);
}

export async function getOnboardingStatus(): Promise<{
  completed: boolean;
  steps: Record<string, boolean>;
}> {
  const user = await getUser();

  if (!user) {
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

  return {
    completed: user.onboardingCompleted,
    steps: {
      signIn: true,
      profile: !!user.name,
      voiceClone: !!user.voiceCloneId,
      avatar: !!user.avatarId,
      connectors:
        user.connectors.calendar ||
        user.connectors.github ||
        user.connectors.slack,
      paraSetup: true,
    },
  };
}

export async function createAgentSession(
  session: Omit<AgentSession, "id">
): Promise<AgentSession> {
  const { data, error } = await supabase
    .from("agent_sessions")
    .insert({
      user_id: session.userId,
      meeting_id: session.meetingId,
      meeting_title: session.meetingTitle,
      recall_bot_id: session.recallBotId,
      status: session.status,
    })
    .select()
    .single();

  if (error || !data) {
    throw new Error(`Failed to create agent session: ${error?.message}`);
  }

  return {
    id: data.id,
    userId: data.user_id,
    meetingId: data.meeting_id,
    meetingTitle: data.meeting_title,
    recallBotId: data.recall_bot_id,
    status: data.status,
  };
}

export async function getAgentSessions(): Promise<AgentSession[]> {
  const user = await getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("user_id", user.id);

  if (error || !data) return [];

  return data.map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    meetingId: row.meeting_id,
    meetingTitle: row.meeting_title,
    recallBotId: row.recall_bot_id,
    status: row.status,
  }));
}

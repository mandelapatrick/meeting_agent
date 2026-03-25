export interface RecallBot {
  id: string;
  meetingUrl: string;
  botName: string;
  status: "joining" | "in_waiting_room" | "active" | "completed" | "failed";
}

const RECALL_REGION = process.env.RECALL_REGION || "us-west-2";
const RECALL_BASE_URL = `https://${RECALL_REGION}.recall.ai/api/v1`;

function hasRealApiKey(): boolean {
  const key = process.env.RECALL_API_KEY;
  return !!key && !key.startsWith("your-");
}

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${process.env.RECALL_API_KEY}`,
    "Content-Type": "application/json",
  };
}

// Mock state for when no API key is configured
let mockBots: RecallBot[] = [];

export async function createBot(
  meetingUrl: string,
  botName: string,
  agentUrl?: string,
  roomName?: string
): Promise<RecallBot> {
  if (hasRealApiKey()) {
    const body: Record<string, unknown> = {
      meeting_url: meetingUrl,
      bot_name: botName,
    };

    // Use Output Media to load the bridge webpage in the bot's browser
    // The webpage captures meeting audio and bridges it to a LiveKit room
    if (agentUrl && roomName) {
      body.output_media = {
        camera: {
          kind: "webpage",
          config: {
            url: `${agentUrl}?room=${encodeURIComponent(roomName)}`,
          },
        },
      };
      body.recording_config = {
        include_bot_in_recording: {
          audio: true,
        },
      };
      body.variant = {
        google_meet: "web_4_core",
        zoom: "web_4_core",
      };
    }

    const response = await fetch(`${RECALL_BASE_URL}/bot/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Recall.ai API error (${response.status}): ${errorText}`
      );
    }

    const data = await response.json();
    return {
      id: data.id,
      meetingUrl,
      botName,
      status: data.status_changes?.[0]?.code || "joining",
    };
  }

  // Mock mode
  console.warn("[recall] No API key configured, using mock bot");
  const bot: RecallBot = {
    id: `bot_${Date.now()}`,
    meetingUrl,
    botName,
    status: "joining",
  };

  mockBots.push(bot);

  setTimeout(() => {
    bot.status = "active";
  }, 3000);

  return bot;
}

export async function getBotStatus(
  botId: string
): Promise<RecallBot | null> {
  if (hasRealApiKey()) {
    const response = await fetch(`${RECALL_BASE_URL}/bot/${botId}/`, {
      headers: authHeaders(),
    });

    if (!response.ok) return null;

    const data = await response.json();
    return {
      id: data.id,
      meetingUrl: data.meeting_url,
      botName: data.bot_name,
      status: data.status_changes?.[0]?.code || "joining",
    };
  }

  return mockBots.find((b) => b.id === botId) ?? null;
}

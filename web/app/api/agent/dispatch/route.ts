import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { meetingUrl, meetingTitle, email } = body;

  if (!meetingUrl) {
    return NextResponse.json(
      { error: "Meeting URL is required" },
      { status: 400 }
    );
  }

  const apiKey = process.env.RECALL_API_KEY;
  const hasRealKey = apiKey && !apiKey.startsWith("your-");

  // Look up user by email
  let userName = "User";
  let userId: string | null = null;
  if (email) {
    const { data: user } = await supabase
      .from("users")
      .select("id, name")
      .eq("email", email)
      .single();
    if (user) {
      userName = user.name;
      userId = user.id;
    }
  }

  if (hasRealKey) {
    const response = await fetch("https://api.recall.ai/api/v1/bot/", {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        meeting_url: meetingUrl,
        bot_name: `${userName}'s Agent`,
        real_time_transcription: {
          destination_url: `wss://${process.env.AGENT_WS_HOST || "localhost:8080"}/ws`,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return NextResponse.json(
        { error: `Recall.ai error: ${errorText}` },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Record session in Supabase
    if (userId) {
      await supabase.from("agent_sessions").insert({
        user_id: userId,
        meeting_title: meetingTitle,
        meeting_url: meetingUrl,
        recall_bot_id: data.id,
        status: "joining",
      });
    }

    return NextResponse.json({
      botId: data.id,
      status: "joining",
      meetingTitle,
      message: `Agent is joining "${meetingTitle}"`,
    });
  }

  // Mock mode
  const mockBotId = `bot_${Date.now()}`;

  return NextResponse.json({
    botId: mockBotId,
    status: "joining",
    meetingTitle,
    message: `Agent is joining "${meetingTitle}" (mock mode - no Recall API key)`,
  });
}

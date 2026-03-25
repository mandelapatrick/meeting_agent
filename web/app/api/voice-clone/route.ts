import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const formData = await request.formData();
  const audioFile = formData.get("audio") as File;

  if (!audioFile) {
    return NextResponse.json(
      { error: "No audio file provided" },
      { status: 400 }
    );
  }

  const apiKey = process.env.ELEVEN_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ElevenLabs API key not configured" },
      { status: 500 }
    );
  }

  // Call ElevenLabs voice cloning API
  const elevenLabsForm = new FormData();
  elevenLabsForm.append("name", `${session.user?.name || "User"}'s Voice`);
  elevenLabsForm.append("files", audioFile);

  const response = await fetch("https://api.elevenlabs.io/v1/voices/add", {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: elevenLabsForm,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[voice-clone] ElevenLabs error:", errorText);
    return NextResponse.json(
      { error: "Failed to create voice clone" },
      { status: 502 }
    );
  }

  const data = await response.json();
  const voiceId = data.voice_id;

  // Store voice_clone_id in Supabase users table
  await supabase
    .from("users")
    .update({ voice_clone_id: voiceId })
    .eq("email", session.user?.email);

  return NextResponse.json({
    voiceId,
    message: "Voice clone created successfully",
  });
}

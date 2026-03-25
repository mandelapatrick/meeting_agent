import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const googleId = (session as any).googleId;
  const email = session.user.email;
  const name = session.user.name;

  if (!googleId || !email) {
    return NextResponse.json(
      { error: "Missing user identity" },
      { status: 400 }
    );
  }

  const upsertData: Record<string, any> = {
    google_id: googleId,
    email,
    name,
  };

  if (body.connectors !== undefined) {
    upsertData.connectors = body.connectors;
  }

  if (body.onboardingCompleted !== undefined) {
    upsertData.onboarding_completed = body.onboardingCompleted;
  }

  const { data, error } = await supabase
    .from("users")
    .upsert(upsertData, { onConflict: "google_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: `Database error: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ user: data });
}

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const email = body.email;
  const name = body.name;

  if (!email || !name) {
    return NextResponse.json(
      { error: "Missing name or email" },
      { status: 400 }
    );
  }

  const upsertData: Record<string, any> = {
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
    .upsert(upsertData, { onConflict: "email" })
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

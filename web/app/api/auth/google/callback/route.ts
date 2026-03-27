import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const session = searchParams.get("state") || "";
  const error = searchParams.get("error");
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;

  if (error) {
    return NextResponse.redirect(
      `${appUrl}/onboarding?session=${session}&google=error&reason=${error}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appUrl}/onboarding?session=${session}&google=error&reason=missing_code`
    );
  }

  // Exchange authorization code for tokens
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    console.error("Google token exchange failed:", errBody);
    return NextResponse.redirect(
      `${appUrl}/onboarding?session=${session}&google=error&reason=token_exchange`
    );
  }

  const tokens = await tokenRes.json();

  // Decode the ID token to get user profile
  const idTokenPayload = JSON.parse(
    Buffer.from(tokens.id_token.split(".")[1], "base64").toString()
  );

  const email = idTokenPayload.email;
  const name = idTokenPayload.name || email.split("@")[0];
  const picture = idTokenPayload.picture || "";
  const googleId = idTokenPayload.sub;

  // Upsert user — auto-create from Google profile
  const { data: user, error: userErr } = await supabase
    .from("users")
    .upsert(
      {
        email,
        name,
        google_id: googleId,
        avatar_url: picture,
        connectors: { github: false, slack: false, google: true },
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (userErr || !user) {
    console.error("User upsert failed:", userErr);
    return NextResponse.redirect(
      `${appUrl}/onboarding?session=${session}&google=error&reason=user_create`
    );
  }

  // Store tokens in connector_tokens
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

  await supabase.from("connector_tokens").upsert(
    {
      user_id: user.id,
      provider: "google",
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: expiresAt,
      scopes: ["calendar.readonly", "gmail.readonly", "drive.readonly"],
    },
    { onConflict: "user_id,provider" }
  );

  // Generate a Telegram link token
  const telegramLinkToken = crypto.randomUUID();

  await supabase
    .from("users")
    .update({ telegram_link_token: telegramLinkToken })
    .eq("id", user.id);

  // Redirect back to onboarding at the voice step with profile data
  const redirectParams = new URLSearchParams({
    session,
    step: "voice",
    google: "connected",
    name: encodeURIComponent(name),
    email: encodeURIComponent(email),
    telegram_token: telegramLinkToken,
  });

  return NextResponse.redirect(`${appUrl}/onboarding?${redirectParams.toString()}`);
}

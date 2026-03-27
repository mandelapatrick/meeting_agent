import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { supabase } from "./supabase";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      authorization: {
        params: {
          scope: [
            "openid",
            "profile",
            "email",
            "https://www.googleapis.com/auth/calendar.readonly",
            "https://www.googleapis.com/auth/calendar.events.readonly",
          ].join(" "),
          access_type: "offline",
          prompt: "consent",
        },
      },
    }),
  ],
  callbacks: {
    async jwt({ token, account, profile }) {
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.googleId = account.providerAccountId;

        // Create/update user and save refresh token to Supabase
        if (account.providerAccountId) {
          try {
            // Ensure user exists
            await supabase.from("users").upsert(
              {
                google_id: account.providerAccountId,
                email: token.email || "",
                name: token.name || "",
              },
              { onConflict: "google_id" }
            );

            // Fetch user UUID (separate query to guarantee result)
            const { data: user } = await supabase
              .from("users")
              .select("id")
              .eq("google_id", account.providerAccountId)
              .single();

            // Save tokens to connector_tokens
            if (user?.id) {
              const tokenPayload: Record<string, any> = {
                user_id: user.id,
                provider: "google",
                access_token: account.access_token || "",
                expires_at: account.expires_at
                  ? new Date(account.expires_at * 1000).toISOString()
                  : null,
                scopes: ["calendar.readonly", "calendar.events.readonly"],
              };

              // Only overwrite refresh_token if Google actually gave us one
              if (account.refresh_token) {
                tokenPayload.refresh_token = account.refresh_token;
              }

              const { error: tokenError } = await supabase
                .from("connector_tokens")
                .upsert(tokenPayload, { onConflict: "user_id,provider" });

              if (tokenError) {
                console.error("[auth] connector_tokens upsert error:", tokenError);
              }

              // Warn if no refresh_token available at all
              if (!account.refresh_token) {
                const { data: existing } = await supabase
                  .from("connector_tokens")
                  .select("refresh_token")
                  .eq("user_id", user.id)
                  .eq("provider", "google")
                  .single();
                if (!existing?.refresh_token) {
                  console.error("[auth] No refresh_token from Google and none in DB. User needs to revoke and re-sign-in.");
                }
              }
            }
          } catch (err) {
            console.error("[auth] Failed to save to Supabase:", err);
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).accessToken = token.accessToken;
      (session as any).googleId = token.googleId;
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
});

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

        // Save refresh token to Supabase connector_tokens table
        if (account.refresh_token && account.providerAccountId) {
          try {
            // Look up the user's UUID from users table by google_id
            const { data: user } = await supabase
              .from("users")
              .select("id")
              .eq("google_id", account.providerAccountId)
              .single();

            if (user?.id) {
              await supabase.from("connector_tokens").upsert(
                {
                  user_id: user.id,
                  provider: "google",
                  access_token: account.access_token || "",
                  refresh_token: account.refresh_token,
                  expires_at: account.expires_at
                    ? new Date(account.expires_at * 1000).toISOString()
                    : null,
                  scopes: ["calendar.readonly", "calendar.events.readonly"],
                },
                { onConflict: "user_id,provider" }
              );
            }
          } catch (err) {
            console.error("[auth] Failed to save token to Supabase:", err);
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

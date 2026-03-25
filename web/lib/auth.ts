import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { writeFile } from "fs/promises";
import { resolve } from "path";

const TOKEN_FILE = resolve(process.cwd(), "..", ".claude-delegate-token");

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
      // Persist the Google access token and refresh token
      if (account) {
        token.accessToken = account.access_token;
        token.refreshToken = account.refresh_token;
        token.expiresAt = account.expires_at;
        token.googleId = account.providerAccountId;

        // Save refresh token to file so the MCP server can use it
        if (account.refresh_token) {
          try {
            await writeFile(
              TOKEN_FILE,
              JSON.stringify(
                {
                  refreshToken: account.refresh_token,
                  accessToken: account.access_token,
                  expiresAt: account.expires_at,
                  googleId: account.providerAccountId,
                  email: token.email,
                  name: token.name,
                },
                null,
                2
              )
            );
          } catch (err) {
            console.error("Failed to save token file for MCP server:", err);
          }
        }
      }
      return token;
    },
    async session({ session, token }) {
      // Make the access token and Google ID available to the client
      (session as any).accessToken = token.accessToken;
      (session as any).googleId = token.googleId;
      return session;
    },
  },
  pages: {
    signIn: "/signin",
  },
});

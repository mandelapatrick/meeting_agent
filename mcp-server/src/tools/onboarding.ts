import { getOnboardingStatus, getAppUrl, writeTokenFile } from "../services/proxy.js";

export const getOnboardingStatusToolDef = {
  name: "get_onboarding_status",
  description:
    "Check the current onboarding status of the user's AI delegate setup.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

export async function getOnboardingStatusHandler(): Promise<string> {
  const status = await getOnboardingStatus();

  const stepLabels: Record<string, string> = {
    signIn: "Google Sign-In",
    profile: "Name & Email",
    voiceClone: "Voice Clone (30s recording)",
    avatar: "Profile Photo",
    connectors: "Connected Accounts",
    paraSetup: "PARA Second Brain",
  };

  let output = "## Onboarding Status\n\n";
  output += status.completed
    ? "Your delegate is fully set up and ready to go.\n\n"
    : "Your delegate setup is incomplete.\n\n";

  for (const [key, label] of Object.entries(stepLabels)) {
    const done = status.steps[key];
    output += `- ${done ? "[x]" : "[ ]"} ${label}\n`;
  }

  if (!status.completed) {
    output +=
      "\nRun `/onboard` to open the setup wizard in your browser.";
  }

  return output;
}

export const openOnboardingToolDef = {
  name: "open_onboarding",
  description:
    "Open the onboarding wizard in the user's browser to set up their AI delegate.",
  inputSchema: {
    type: "object" as const,
    properties: {},
  },
};

const PROXY_URL =
  process.env.PROXY_URL || "https://meeting-agent-h4ny.onrender.com";

export async function openOnboardingHandler(): Promise<string> {
  const appUrl = getAppUrl();

  // Generate a unique session ID for this onboarding flow
  const sessionId = `onboard_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const onboardingUrl = `${appUrl}/onboarding?session=${sessionId}`;

  // Register the session with the proxy so the web app can link it
  try {
    await fetch(`${PROXY_URL}/api/onboarding/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId }),
    });
  } catch {
    // Non-critical
  }

  // Open browser
  const { exec } = await import("child_process");
  exec(`open "${onboardingUrl}"`);

  // Poll for onboarding completion in background
  const pollForCompletion = async () => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const resp = await fetch(
          `${PROXY_URL}/api/onboarding/session/${sessionId}`
        );
        if (resp.ok) {
          const data = await resp.json();
          if (data.completed && data.user) {
            await writeTokenFile({
              googleId: data.user.googleId,
              email: data.user.email,
              name: data.user.name,
            });
            console.log("[onboarding] Identity saved");
            return;
          }
        }
      } catch {
        // Keep polling
      }
    }
  };

  pollForCompletion();

  return [
    `Opening onboarding wizard at: ${onboardingUrl}`,
    ``,
    `Complete these steps in your browser:`,
    `1. Sign in with Google`,
    `2. Confirm your name and email`,
    `3. Record 30 seconds of your voice`,
    `4. Take a profile photo`,
    `5. Connect Google Calendar, GitHub, and Slack`,
    `6. Set up your PARA second brain structure`,
    ``,
    `Your identity will be saved automatically when onboarding completes.`,
    `Then run \`/list-meetings\` to see your upcoming meetings.`,
  ].join("\n");
}

"use client";

import { useState, useEffect } from "react";
import VoiceCapture from "@/components/onboarding/VoiceCapture";

const TELEGRAM_BOT_USERNAME =
  process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "ClaudeDelegateBot";

const STEPS = [
  { id: "signin", title: "Sign In", subtitle: "Connect your Google account" },
  { id: "voice", title: "Voice Clone", subtitle: "Record 30 seconds" },
  {
    id: "telegram",
    title: "Connect Telegram",
    subtitle: "Get meeting notifications",
  },
];

const STEP_INDEX: Record<string, number> = {};
STEPS.forEach((s, i) => {
  STEP_INDEX[s.id] = i;
});

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [profileData, setProfileData] = useState({ name: "", email: "" });
  const [telegramToken, setTelegramToken] = useState<string | null>(null);
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [telegramOpened, setTelegramOpened] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);

  // Restore position after Google OAuth redirect
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const step = params.get("step");
    const google = params.get("google");
    const name = params.get("name");
    const email = params.get("email");
    const token = params.get("telegram_token");

    if (google === "connected" && step && STEP_INDEX[step] !== undefined) {
      setCurrentStep(STEP_INDEX[step]);
      if (name) setProfileData((p) => ({ ...p, name: decodeURIComponent(name) }));
      if (email)
        setProfileData((p) => ({ ...p, email: decodeURIComponent(email) }));
      if (token) setTelegramToken(token);
    }
  }, []);

  const canProceed = (() => {
    switch (currentStep) {
      case 0:
        return false; // Sign-in step uses its own button
      case 1:
        return voiceBlob !== null;
      case 2:
        return true;
      default:
        return true;
    }
  })();

  const startGoogleOAuth = () => {
    const params = new URLSearchParams(window.location.search);
    const session = params.get("session") || "";
    window.location.href = `/api/auth/google?session=${encodeURIComponent(session)}`;
  };

  const handleNext = async () => {
    setIsSubmitting(true);
    try {
      if (currentStep === 1 && voiceBlob) {
        // Leaving voice step — upload immediately
        const voiceForm = new FormData();
        voiceForm.append("audio", voiceBlob, "voice.webm");
        voiceForm.append("email", profileData.email);
        await fetch("/api/voice-clone", { method: "POST", body: voiceForm });
      }

      if (currentStep === 2) {
        // Leaving Telegram step — finalize onboarding
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileData.name,
            email: profileData.email,
            connectors: { google: true },
            onboardingCompleted: true,
          }),
        });

        // Notify proxy session so MCP client can pick up identity
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get("session");
        if (sessionId) {
          try {
            await fetch(
              `https://meeting-agent-h4ny.onrender.com/api/onboarding/session/${sessionId}/complete`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  email: profileData.email,
                  name: profileData.name,
                }),
              }
            );
          } catch {
            // Non-critical
          }
        }

        setCompleted(true);
        setIsSubmitting(false);
        return;
      }
    } catch (err) {
      console.error("Onboarding step error:", err);
    }
    setIsSubmitting(false);
    setCurrentStep((prev) => Math.min(prev + 1, STEPS.length - 1));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const step = STEPS[currentStep];

  if (completed) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-6">
        <div className="w-full max-w-lg text-center space-y-4">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-600/20 text-green-400">
            <svg
              className="w-8 h-8"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-white">
            Your Delegate is Ready
          </h3>
          <p className="text-zinc-400 text-sm max-w-sm mx-auto">
            You can close this page. Your delegate will notify you on Telegram
            before upcoming meetings.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex flex-col">
      {/* Progress bar */}
      <div className="border-b border-zinc-800">
        <div className="max-w-2xl mx-auto px-6 py-4">
          <div className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex-1 flex items-center">
                <div
                  className={`h-1 w-full rounded-full transition-colors ${
                    i <= currentStep ? "bg-orange-500" : "bg-zinc-800"
                  }`}
                />
              </div>
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-zinc-500">
            <span>
              Step {currentStep + 1} of {STEPS.length}
            </span>
            <span>{step.title}</span>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-lg">
          {/* Step header */}
          <div className="text-center mb-8">
            <h2 className="text-2xl font-bold text-white">{step.title}</h2>
            <p className="text-zinc-400 mt-1">{step.subtitle}</p>
          </div>

          {/* Step content */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            {currentStep === 0 && (
              <div className="space-y-6 text-center">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-zinc-800">
                  <svg
                    className="w-8 h-8 text-zinc-400"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <div>
                  <p className="text-zinc-400 text-sm">
                    Sign in with Google to get started. This grants access to
                    your Calendar so your delegate knows your schedule.
                  </p>
                </div>
                <button
                  onClick={startGoogleOAuth}
                  className="w-full px-6 py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-xl transition-colors flex items-center justify-center gap-3"
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      fill="#4285F4"
                    />
                    <path
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      fill="#34A853"
                    />
                    <path
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      fill="#FBBC05"
                    />
                    <path
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      fill="#EA4335"
                    />
                  </svg>
                  Continue with Google
                </button>
              </div>
            )}

            {currentStep === 1 && (
              <VoiceCapture onComplete={setVoiceBlob} />
            )}

            {currentStep === 2 && (
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-zinc-400 text-sm mb-1">
                    Connect Telegram to get meeting notifications and control
                    your delegate via chat.
                  </p>
                </div>

                {telegramToken ? (
                  <a
                    href={`https://t.me/${TELEGRAM_BOT_USERNAME}?start=${telegramToken}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setTelegramOpened(true)}
                    className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
                      telegramOpened
                        ? "border-blue-500/50 bg-blue-500/10"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                    }`}
                  >
                    <div
                      className={`flex-shrink-0 ${
                        telegramOpened ? "text-blue-400" : "text-zinc-500"
                      }`}
                    >
                      <svg
                        className="w-6 h-6"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                      >
                        <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-white font-medium text-sm">
                        Open Telegram
                      </span>
                      <p className="text-zinc-500 text-xs mt-0.5">
                        Click to connect your Telegram account
                      </p>
                    </div>
                    {telegramOpened ? (
                      <span className="text-xs text-blue-400 font-medium">
                        Opened
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-500">Connect</span>
                    )}
                  </a>
                ) : (
                  <div className="text-center text-zinc-500 text-sm">
                    Telegram link not available. Please complete Google sign-in
                    first.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            {currentStep > 1 ? (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep > 0 && (
              <button
                onClick={handleNext}
                disabled={!canProceed || isSubmitting}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
              >
                {isSubmitting
                  ? "Setting up..."
                  : currentStep === STEPS.length - 1
                    ? "Complete Setup"
                    : "Continue"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

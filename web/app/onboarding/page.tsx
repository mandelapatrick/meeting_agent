"use client";

import { useState, useEffect } from "react";
import VoiceCapture from "@/components/onboarding/VoiceCapture";
import VideoCapture from "@/components/onboarding/VideoCapture";
import ConnectorApproval from "@/components/onboarding/ConnectorApproval";
import ParaSetup from "@/components/onboarding/ParaSetup";

const STEPS = [
  { id: "signin", title: "Sign In", subtitle: "Connect your Google account" },
  { id: "voice", title: "Voice Clone", subtitle: "Record 30 seconds" },
  { id: "avatar", title: "Profile Photo", subtitle: "Capture your look" },
  { id: "connectors", title: "Connectors", subtitle: "Link your accounts" },
  { id: "para", title: "Second Brain", subtitle: "Organize knowledge" },
  { id: "complete", title: "Ready", subtitle: "Your delegate awaits" },
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
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [connectors, setConnectors] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      if (email) setProfileData((p) => ({ ...p, email: decodeURIComponent(email) }));
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
        return photoBlob !== null;
      case 3:
        return true; // Connectors are optional
      case 4:
        return true; // PARA is optional
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

      if (currentStep === 2 && photoBlob) {
        // Leaving avatar step — upload immediately
        const photoForm = new FormData();
        photoForm.append("photo", photoBlob, "avatar.jpg");
        photoForm.append("email", profileData.email);
        await fetch("/api/avatar", { method: "POST", body: photoForm });
      }

      if (currentStep === STEPS.length - 2) {
        // Leaving PARA step — finalize onboarding
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileData.name,
            email: profileData.email,
            connectors,
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
                  <svg className="w-8 h-8 text-zinc-400" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                </div>
                <div>
                  <p className="text-zinc-400 text-sm">
                    Sign in with Google to get started. This grants access to your
                    Calendar, Gmail, and Google Drive so your delegate has full context.
                  </p>
                </div>
                <button
                  onClick={startGoogleOAuth}
                  className="w-full px-6 py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-xl transition-colors flex items-center justify-center gap-3"
                >
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                  </svg>
                  Continue with Google
                </button>
              </div>
            )}

            {currentStep === 1 && (
              <VoiceCapture onComplete={setVoiceBlob} />
            )}

            {currentStep === 2 && (
              <VideoCapture onComplete={setPhotoBlob} />
            )}

            {currentStep === 3 && (
              <ConnectorApproval
                telegramToken={telegramToken}
                onComplete={setConnectors}
              />
            )}

            {currentStep === 4 && <ParaSetup onComplete={() => {}} />}

            {currentStep === 5 && (
              <div className="text-center py-6 space-y-4">
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
                  Go back to Claude Code and use these commands:
                </p>
                <div className="space-y-2 text-left max-w-xs mx-auto">
                  <div className="bg-zinc-800 rounded-lg px-4 py-2">
                    <code className="text-orange-400 text-sm">
                      /list-meetings
                    </code>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      See your upcoming meetings
                    </p>
                  </div>
                  <div className="bg-zinc-800 rounded-lg px-4 py-2">
                    <code className="text-orange-400 text-sm">
                      /add-agent-to-meeting
                    </code>
                    <p className="text-zinc-500 text-xs mt-0.5">
                      Send your delegate to a meeting
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Navigation */}
          <div className="flex justify-between mt-6">
            {currentStep > 1 && currentStep < STEPS.length - 1 ? (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep > 0 && currentStep < STEPS.length - 1 && (
              <button
                onClick={handleNext}
                disabled={!canProceed || isSubmitting}
                className="px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded-xl transition-colors"
              >
                {isSubmitting
                  ? "Setting up..."
                  : currentStep === STEPS.length - 2
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

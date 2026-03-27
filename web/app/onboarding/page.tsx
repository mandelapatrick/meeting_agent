"use client";

import { useState, useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import VoiceCapture from "@/components/onboarding/VoiceCapture";
import VideoCapture from "@/components/onboarding/VideoCapture";
import ConnectorApproval from "@/components/onboarding/ConnectorApproval";
import ParaSetup from "@/components/onboarding/ParaSetup";

const STEPS = [
  { id: "signin", title: "Sign In", subtitle: "Connect your Google account" },
  { id: "profile", title: "Your Profile", subtitle: "Confirm your identity" },
  { id: "voice", title: "Voice Clone", subtitle: "Record 30 seconds" },
  { id: "avatar", title: "Profile Photo", subtitle: "Capture your look" },
  { id: "connectors", title: "Connectors", subtitle: "Link your accounts" },
  { id: "para", title: "Second Brain", subtitle: "Organize knowledge" },
  { id: "complete", title: "Ready", subtitle: "Your delegate awaits" },
];

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const [currentStep, setCurrentStep] = useState(0);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [profileData, setProfileData] = useState({ name: "", email: "" });
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [connectors, setConnectors] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  // If already signed in (e.g. after OAuth redirect), skip to step 2 and prefill profile
  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      setProfileData({
        name: session.user.name || "",
        email: session.user.email || "",
      });
      if (currentStep === 0) {
        setCurrentStep(1);
      }
    }
  }, [status, session, currentStep]);

  const isSignedIn = status === "authenticated";

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true);
    await signIn("google", { callbackUrl: "/onboarding" });
  };

  const canProceed = (() => {
    switch (currentStep) {
      case 0:
        return isSignedIn;
      case 1:
        return profileData.name.length > 0 && profileData.email.length > 0;
      case 2:
        return voiceBlob !== null;
      case 3:
        return photoBlob !== null;
      case 4:
        return true; // Connectors are optional
      case 5:
        return true; // PARA is optional
      default:
        return true;
    }
  })();

  const handleNext = async () => {
    setIsSubmitting(true);
    try {
      if (currentStep === 1) {
        // Leaving profile step — create user record in Supabase
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ onboardingCompleted: false }),
        });
      }

      if (currentStep === 2 && voiceBlob) {
        // Leaving voice step — upload immediately
        const voiceForm = new FormData();
        voiceForm.append("audio", voiceBlob, "voice.webm");
        await fetch("/api/voice-clone", { method: "POST", body: voiceForm });
      }

      if (currentStep === 3 && photoBlob) {
        // Leaving avatar step — upload immediately
        const photoForm = new FormData();
        photoForm.append("photo", photoBlob, "avatar.jpg");
        await fetch("/api/avatar", { method: "POST", body: photoForm });
      }

      if (currentStep === STEPS.length - 2) {
        // Leaving PARA step — finalize onboarding
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            connectors,
            onboardingCompleted: true,
          }),
        });

        // Notify proxy session so MCP client can pick up identity
        const urlParams = new URLSearchParams(window.location.search);
        const sessionId = urlParams.get("session");
        if (sessionId && session?.user) {
          try {
            await fetch(
              `https://meeting-agent-h4ny.onrender.com/api/onboarding/session/${sessionId}/complete`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  googleId: (session as any).googleId,
                  email: session.user.email,
                  name: session.user.name,
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
              <div className="space-y-6">
                <div className="text-center">
                  <p className="text-zinc-400 text-sm mb-1">
                    Sign in with Google to get started.
                  </p>
                  <p className="text-zinc-500 text-xs">
                    This grants access to your Google Calendar so your delegate
                    knows which meetings to join.
                  </p>
                </div>

                <button
                  onClick={handleGoogleSignIn}
                  disabled={isSigningIn}
                  className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white hover:bg-zinc-100 text-zinc-900 font-medium rounded-xl transition-colors disabled:opacity-50"
                >
                  {isSigningIn ? (
                    <div className="w-5 h-5 border-2 border-zinc-400 border-t-zinc-900 rounded-full animate-spin" />
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                  )}
                  {isSigningIn ? "Signing in..." : "Continue with Google"}
                </button>

                {/* Skip for testing without Google OAuth */}
                <button
                  onClick={() => {
                    setProfileData({ name: "Test User", email: "test@example.com" });
                    setCurrentStep(1);
                  }}
                  className="w-full text-center text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                >
                  Skip for now (testing mode)
                </button>
              </div>
            )}

            {currentStep === 1 && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">
                    Full Name
                  </label>
                  <input
                    type="text"
                    value={profileData.name}
                    onChange={(e) =>
                      setProfileData((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="Your name as it appears in meetings"
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-1.5">
                    Email
                  </label>
                  <input
                    type="email"
                    value={profileData.email}
                    onChange={(e) =>
                      setProfileData((p) => ({ ...p, email: e.target.value }))
                    }
                    placeholder="you@company.com"
                    className="w-full px-4 py-3 bg-zinc-800 border border-zinc-700 rounded-xl text-white placeholder-zinc-500 focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <p className="text-zinc-600 text-xs">
                  Your delegate will identify itself as &ldquo;{profileData.name || "Your Name"}&apos;s
                  Delegate&rdquo; in meetings.
                </p>
              </div>
            )}

            {currentStep === 2 && (
              <VoiceCapture onComplete={setVoiceBlob} />
            )}

            {currentStep === 3 && (
              <VideoCapture onComplete={setPhotoBlob} />
            )}

            {currentStep === 4 && (
              <ConnectorApproval onComplete={setConnectors} />
            )}

            {currentStep === 5 && <ParaSetup onComplete={() => {}} />}

            {currentStep === 6 && (
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
            {currentStep > 0 && currentStep < STEPS.length - 1 ? (
              <button
                onClick={handleBack}
                className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
              >
                Back
              </button>
            ) : (
              <div />
            )}

            {currentStep < STEPS.length - 1 && (
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

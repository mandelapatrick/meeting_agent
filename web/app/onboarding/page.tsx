"use client";

import { useState } from "react";
import VoiceCapture from "@/components/onboarding/VoiceCapture";
import VideoCapture from "@/components/onboarding/VideoCapture";
import ConnectorApproval from "@/components/onboarding/ConnectorApproval";
import ParaSetup from "@/components/onboarding/ParaSetup";

const STEPS = [
  { id: "profile", title: "Your Profile", subtitle: "Tell us who you are" },
  { id: "voice", title: "Voice Clone", subtitle: "Record 30 seconds" },
  { id: "avatar", title: "Profile Photo", subtitle: "Capture your look" },
  { id: "connectors", title: "Connectors", subtitle: "Link your accounts" },
  { id: "para", title: "Second Brain", subtitle: "Organize knowledge" },
  { id: "complete", title: "Ready", subtitle: "Your delegate awaits" },
];

export default function OnboardingPage() {
  const [currentStep, setCurrentStep] = useState(0);
  const [profileData, setProfileData] = useState({ name: "", email: "" });
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);
  const [connectors, setConnectors] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const canProceed = (() => {
    switch (currentStep) {
      case 0:
        return profileData.name.length > 0 && profileData.email.length > 0;
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

  const handleNext = async () => {
    setIsSubmitting(true);
    try {
      if (currentStep === 0) {
        // Leaving profile step — create user record and persist email for OAuth
        localStorage.setItem("onboarding_email", profileData.email);
        await fetch("/api/onboarding/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: profileData.name,
            email: profileData.email,
            onboardingCompleted: false,
          }),
        });
      }

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

            {currentStep === 1 && (
              <VoiceCapture onComplete={setVoiceBlob} />
            )}

            {currentStep === 2 && (
              <VideoCapture onComplete={setPhotoBlob} />
            )}

            {currentStep === 3 && (
              <ConnectorApproval onComplete={setConnectors} />
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

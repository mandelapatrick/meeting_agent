"use client";

import { useState, useRef, useEffect } from "react";

interface VoiceCaptureProps {
  onComplete: (audioBlob: Blob) => void;
}

export default function VoiceCapture({ onComplete }: VoiceCaptureProps) {
  const [isRecording, setIsRecording] = useState(false);
  const [timeLeft, setTimeLeft] = useState(30);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: "audio/webm;codecs=opus",
      });

      chunksRef.current = [];
      mediaRecorderRef.current = mediaRecorder;

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        onComplete(blob);
        stream.getTracks().forEach((t) => t.stop());
      };

      mediaRecorder.start(1000);
      setIsRecording(true);
      setTimeLeft(30);

      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            mediaRecorder.stop();
            setIsRecording(false);
            if (timerRef.current) clearInterval(timerRef.current);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch {
      setError("Microphone access denied. Please allow microphone access.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const resetRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setTimeLeft(30);
  };

  const progress = ((30 - timeLeft) / 30) * 100;

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-1">
          Read the passage below naturally for 30 seconds.
        </p>
        <p className="text-zinc-500 text-xs">
          This creates a voice clone so your agent sounds like you.
        </p>
      </div>

      {/* Reading prompt */}
      <div className="bg-zinc-800/50 border border-zinc-700 rounded-xl p-5 text-zinc-300 text-sm leading-relaxed">
        &ldquo;The most effective teams I&apos;ve worked with share a few common
        traits. They communicate openly, even when the message is difficult.
        They hold each other accountable without making it personal. And they
        celebrate small wins along the way, because momentum matters as much as
        the destination. I believe that building great products starts with
        building great relationships, and that starts with showing up
        authentically every single day.&rdquo;
      </div>

      {/* Recording controls */}
      <div className="flex flex-col items-center gap-4">
        {audioUrl ? (
          <>
            {/* Playback + re-record */}
            <audio src={audioUrl} controls className="w-full max-w-xs h-10" />
            <button
              onClick={resetRecording}
              className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors text-sm"
            >
              Re-record
            </button>
          </>
        ) : (
          <>
            {/* Progress ring */}
            <div className="relative w-24 h-24">
              <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                <circle
                  cx="48"
                  cy="48"
                  r="42"
                  fill="none"
                  stroke="#27272a"
                  strokeWidth="4"
                />
                <circle
                  cx="48"
                  cy="48"
                  r="42"
                  fill="none"
                  stroke={isRecording ? "#ef4444" : "#71717a"}
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeDasharray={`${2 * Math.PI * 42}`}
                  strokeDashoffset={`${2 * Math.PI * 42 * (1 - progress / 100)}`}
                  className="transition-all duration-1000"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-2xl font-mono text-white">{timeLeft}s</span>
              </div>
            </div>

            {/* Start / Stop button */}
            <button
              onClick={isRecording ? stopRecording : startRecording}
              className={`px-6 py-3 rounded-xl font-medium transition-all ${
                isRecording
                  ? "bg-red-600 hover:bg-red-700 text-white animate-pulse"
                  : "bg-orange-600 hover:bg-orange-700 text-white"
              }`}
            >
              {isRecording ? "Stop Recording" : "Start Recording"}
            </button>
          </>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}
    </div>
  );
}

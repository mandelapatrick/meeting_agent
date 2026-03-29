"use client";

import { useState, useRef, useCallback, useEffect } from "react";

interface VideoCaptureProps {
  onComplete: (photoBlob: Blob) => void;
}

export default function VideoCapture({ onComplete }: VideoCaptureProps) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Use callback ref to attach stream as soon as the video element mounts
  const videoCallbackRef = useCallback(
    (node: HTMLVideoElement | null) => {
      (videoRef as React.MutableRefObject<HTMLVideoElement | null>).current = node;
      if (node && stream) {
        node.srcObject = stream;
      }
    },
    [stream]
  );

  const startCamera = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 640, height: 480 },
      });
      setStream(mediaStream);
    } catch {
      setError("Camera access denied. Please allow camera access.");
    }
  };

  const takePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (blob) {
          setPhotoUrl(URL.createObjectURL(blob));
          onComplete(blob);
          // Stop camera
          stream?.getTracks().forEach((t) => t.stop());
          setStream(null);
        }
      },
      "image/jpeg",
      0.9
    );
  }, [stream, onComplete]);

  const retake = () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl);
    setPhotoUrl(null);
    startCamera();
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-1">
          Take a profile photo for your meeting avatar.
        </p>
        <p className="text-zinc-500 text-xs">
          This photo will be shown as your video feed when your agent joins
          meetings.
        </p>
      </div>

      <div className="flex flex-col items-center gap-4">
        {/* Video / Photo preview */}
        <div className="relative w-64 h-48 bg-zinc-800 rounded-2xl overflow-hidden border border-zinc-700">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt="Captured photo"
              className="w-full h-full object-cover"
            />
          ) : stream ? (
            <video
              ref={videoCallbackRef}
              autoPlay
              muted
              playsInline
              className="w-full h-full object-cover mirror"
              style={{ transform: "scaleX(-1)" }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <svg
                className="w-12 h-12 text-zinc-600"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
            </div>
          )}
        </div>

        <canvas ref={canvasRef} className="hidden" />

        {/* Controls */}
        {!photoUrl ? (
          stream ? (
            <button
              onClick={takePhoto}
              className="px-6 py-3 rounded-xl bg-orange-600 hover:bg-orange-700 text-white font-medium transition-colors"
            >
              Capture Photo
            </button>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <button
                onClick={startCamera}
                className="px-6 py-3 rounded-xl bg-zinc-700 hover:bg-zinc-600 text-white font-medium transition-colors"
              >
                Open Camera
              </button>
              <label className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors cursor-pointer text-sm">
                Or upload a photo
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setPhotoUrl(URL.createObjectURL(file));
                      onComplete(file);
                    }
                  }}
                />
              </label>
            </div>
          )
        ) : (
          <button
            onClick={retake}
            className="px-4 py-2 rounded-xl border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 transition-colors"
          >
            Retake
          </button>
        )}
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center">{error}</p>
      )}
    </div>
  );
}

"use client";

import { useState } from "react";

interface ConnectorApprovalProps {
  telegramToken: string | null;
  onComplete: (connectors: Record<string, boolean>) => void;
}

const TELEGRAM_BOT_USERNAME = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "ClaudeDelegateBot";

export default function ConnectorApproval({ telegramToken, onComplete }: ConnectorApprovalProps) {
  const [connectors, setConnectors] = useState<Record<string, boolean>>({
    github: false,
    slack: false,
  });
  const [telegramOpened, setTelegramOpened] = useState(false);

  const toggle = (id: string) => {
    setConnectors((prev) => {
      const updated = { ...prev, [id]: !prev[id] };
      onComplete(updated);
      return updated;
    });
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-1">
          Connect your accounts for richer meeting context.
        </p>
      </div>

      <div className="space-y-3">
        {/* Telegram — deep link */}
        {telegramToken && (
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
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0a12 12 0 00-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-white font-medium text-sm">Telegram</span>
              <p className="text-zinc-500 text-xs mt-0.5">
                Get meeting notifications and control your agent via chat
              </p>
            </div>
            {telegramOpened ? (
              <span className="text-xs text-blue-400 font-medium">Opened</span>
            ) : (
              <span className="text-xs text-zinc-500">Connect</span>
            )}
          </a>
        )}

        {/* GitHub — toggle */}
        <button
          onClick={() => toggle("github")}
          className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
            connectors.github
              ? "border-orange-600/50 bg-orange-600/10"
              : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
          }`}
        >
          <div
            className={`flex-shrink-0 ${
              connectors.github ? "text-orange-400" : "text-zinc-500"
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-white font-medium text-sm">GitHub</span>
            <p className="text-zinc-500 text-xs mt-0.5">
              Pull context from repos, PRs, and issues for technical meetings
            </p>
          </div>
          <div
            className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
              connectors.github ? "bg-orange-600" : "bg-zinc-700"
            }`}
          >
            <div
              className={`w-4 h-4 mt-1 rounded-full bg-white transition-transform ${
                connectors.github ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </div>
        </button>

        {/* Slack — toggle */}
        <button
          onClick={() => toggle("slack")}
          className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
            connectors.slack
              ? "border-orange-600/50 bg-orange-600/10"
              : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
          }`}
        >
          <div
            className={`flex-shrink-0 ${
              connectors.slack ? "text-orange-400" : "text-zinc-500"
            }`}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
              <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.271 0a2.528 2.528 0 01-2.521 2.521 2.528 2.528 0 01-2.521-2.521V2.522A2.528 2.528 0 0115.164 0a2.528 2.528 0 012.521 2.522v6.312zM15.164 18.956a2.528 2.528 0 012.521 2.522A2.528 2.528 0 0115.164 24a2.528 2.528 0 01-2.521-2.522v-2.522h2.521zm0-1.271a2.528 2.528 0 01-2.521-2.521 2.528 2.528 0 012.521-2.521h6.314A2.528 2.528 0 0124 15.164a2.528 2.528 0 01-2.522 2.521h-6.314z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-white font-medium text-sm">Slack</span>
            <p className="text-zinc-500 text-xs mt-0.5">
              Read channel context and post meeting summaries
            </p>
          </div>
          <div
            className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
              connectors.slack ? "bg-orange-600" : "bg-zinc-700"
            }`}
          >
            <div
              className={`w-4 h-4 mt-1 rounded-full bg-white transition-transform ${
                connectors.slack ? "translate-x-5" : "translate-x-1"
              }`}
            />
          </div>
        </button>
      </div>
    </div>
  );
}

"use client";

import { useState } from "react";

interface ConnectorApprovalProps {
  onComplete: (connectors: Record<string, boolean>) => void;
}

const CONNECTORS = [
  {
    id: "github",
    name: "GitHub",
    description: "Pull context from repos, PRs, and issues for technical meetings",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.17 6.839 9.49.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.464-1.11-1.464-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.167 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
      </svg>
    ),
  },
  {
    id: "slack",
    name: "Slack",
    description: "Read channel context and post meeting summaries",
    icon: (
      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="currentColor">
        <path d="M5.042 15.165a2.528 2.528 0 01-2.52 2.523A2.528 2.528 0 010 15.165a2.527 2.527 0 012.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 012.521-2.52 2.527 2.527 0 012.521 2.52v6.313A2.528 2.528 0 018.834 24a2.528 2.528 0 01-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 01-2.521-2.52A2.528 2.528 0 018.834 0a2.528 2.528 0 012.521 2.522v2.52H8.834zm0 1.271a2.528 2.528 0 012.521 2.521 2.528 2.528 0 01-2.521 2.521H2.522A2.528 2.528 0 010 8.834a2.528 2.528 0 012.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 012.522-2.521A2.528 2.528 0 0124 8.834a2.528 2.528 0 01-2.522 2.521h-2.522V8.834zm-1.271 0a2.528 2.528 0 01-2.521 2.521 2.528 2.528 0 01-2.521-2.521V2.522A2.528 2.528 0 0115.164 0a2.528 2.528 0 012.521 2.522v6.312zM15.164 18.956a2.528 2.528 0 012.521 2.522A2.528 2.528 0 0115.164 24a2.528 2.528 0 01-2.521-2.522v-2.522h2.521zm0-1.271a2.528 2.528 0 01-2.521-2.521 2.528 2.528 0 012.521-2.521h6.314A2.528 2.528 0 0124 15.164a2.528 2.528 0 01-2.522 2.521h-6.314z" />
      </svg>
    ),
  },
];

export default function ConnectorApproval({ onComplete }: ConnectorApprovalProps) {
  const [connectors, setConnectors] = useState<Record<string, boolean>>({
    github: false,
    slack: false,
  });

  const toggle = (id: string) => {
    setConnectors((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-1">
          Connect your accounts for richer meeting context.
        </p>
        <p className="text-zinc-500 text-xs">
          Calendar access is handled by Claude.ai&apos;s Google Calendar integration.
        </p>
      </div>

      <div className="space-y-3">
        {CONNECTORS.map((c) => (
          <button
            key={c.id}
            onClick={() => {
              toggle(c.id);
              const updated = { ...connectors, [c.id]: !connectors[c.id] };
              onComplete(updated);
            }}
            className={`w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left ${
              connectors[c.id]
                ? "border-orange-600/50 bg-orange-600/10"
                : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
            }`}
          >
            <div
              className={`flex-shrink-0 ${
                connectors[c.id] ? "text-orange-400" : "text-zinc-500"
              }`}
            >
              {c.icon}
            </div>
            <div className="flex-1 min-w-0">
              <span className="text-white font-medium text-sm">
                {c.name}
              </span>
              <p className="text-zinc-500 text-xs mt-0.5">{c.description}</p>
            </div>
            <div
              className={`w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                connectors[c.id] ? "bg-orange-600" : "bg-zinc-700"
              }`}
            >
              <div
                className={`w-4 h-4 mt-1 rounded-full bg-white transition-transform ${
                  connectors[c.id] ? "translate-x-5" : "translate-x-1"
                }`}
              />
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

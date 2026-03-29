"use client";

import { useState } from "react";

interface ParaSetupProps {
  onComplete: (categories: Record<string, string[]>) => void;
}

const PARA_CATEGORIES = [
  {
    id: "projects",
    name: "Projects",
    description: "Active initiatives with clear goals and deadlines",
    placeholder: "e.g., Q1 Product Launch, API Migration, Hiring Pipeline",
    color: "text-blue-400",
    bg: "bg-blue-500/10 border-blue-500/20",
  },
  {
    id: "areas",
    name: "Areas",
    description: "Ongoing responsibilities you manage",
    placeholder: "e.g., Team Management, Code Quality, Security",
    color: "text-green-400",
    bg: "bg-green-500/10 border-green-500/20",
  },
  {
    id: "resources",
    name: "Resources",
    description: "Reference material and knowledge you draw on",
    placeholder: "e.g., Architecture Docs, Meeting Templates, Style Guides",
    color: "text-purple-400",
    bg: "bg-purple-500/10 border-purple-500/20",
  },
  {
    id: "archive",
    name: "Archive",
    description: "Completed or inactive items for reference",
    placeholder: "e.g., 2024 Roadmap, Old Processes",
    color: "text-zinc-400",
    bg: "bg-zinc-500/10 border-zinc-500/20",
  },
];

export default function ParaSetup({ onComplete }: ParaSetupProps) {
  const [entries, setEntries] = useState<Record<string, string>>({
    projects: "",
    areas: "",
    resources: "",
    archive: "",
  });

  const handleChange = (id: string, value: string) => {
    const updated = { ...entries, [id]: value };
    setEntries(updated);

    // Parse comma-separated values
    const parsed: Record<string, string[]> = {};
    for (const [key, val] of Object.entries(updated)) {
      parsed[key] = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    onComplete(parsed);
  };

  return (
    <div className="space-y-6">
      <div className="text-center">
        <p className="text-zinc-400 text-sm mb-1">
          Organize your knowledge using the PARA method.
        </p>
        <p className="text-zinc-500 text-xs">
          This helps your agent understand your work context and respond with
          relevant information in meetings.
        </p>
      </div>

      <div className="space-y-4">
        {PARA_CATEGORIES.map((cat) => (
          <div
            key={cat.id}
            className={`rounded-xl border p-4 ${cat.bg}`}
          >
            <div className="flex items-center gap-2 mb-2">
              <span className={`font-medium text-sm ${cat.color}`}>
                {cat.name}
              </span>
              <span className="text-zinc-600 text-xs">
                {cat.description}
              </span>
            </div>
            <input
              type="text"
              placeholder={cat.placeholder}
              value={entries[cat.id]}
              onChange={(e) => handleChange(cat.id, e.target.value)}
              className="w-full bg-transparent border-0 text-white text-sm placeholder-zinc-600 focus:outline-none focus:ring-0"
            />
          </div>
        ))}
      </div>

      <p className="text-zinc-600 text-xs text-center">
        Separate multiple items with commas. You can update these anytime with{" "}
        <code className="text-zinc-500">/manage-brain</code>.
      </p>
    </div>
  );
}

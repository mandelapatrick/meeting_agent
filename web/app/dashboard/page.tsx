"use client";

import { useState, useEffect } from "react";

interface Meeting {
  id: string;
  title: string;
  start: string;
  end: string;
  attendees: string[];
  meetingUrl: string | null;
  platform: string;
  hasAgent?: boolean;
}

export default function DashboardPage() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dispatchingId, setDispatchingId] = useState<string | null>(null);

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const res = await fetch("/api/calendar");
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to fetch meetings");
      }
      const data = await res.json();
      setMeetings(data.meetings);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const dispatchAgent = async (meeting: Meeting) => {
    setDispatchingId(meeting.id);
    try {
      const res = await fetch("/api/agent/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          meetingUrl: meeting.meetingUrl,
          meetingTitle: meeting.title,
        }),
      });
      if (res.ok) {
        setMeetings((prev) =>
          prev.map((m) => (m.id === meeting.id ? { ...m, hasAgent: true } : m))
        );
      }
    } finally {
      setDispatchingId(null);
    }
  };

  const groupByDay = (meetings: Meeting[]) => {
    const groups: Record<string, Meeting[]> = {};
    for (const m of meetings) {
      const day = new Date(m.start).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
      });
      if (!groups[day]) groups[day] = [];
      groups[day].push(m);
    }
    return groups;
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a]">
      {/* Header */}
      <header className="border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500 to-pink-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-white">Meeting Agent</h1>
          </div>
          <a
            href="/onboarding"
            className="text-sm text-zinc-400 hover:text-white transition-colors"
          >
            Settings
          </a>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-4xl mx-auto px-6 py-8">
        <h2 className="text-xl font-bold text-white mb-6">
          Upcoming Meetings
        </h2>

        {loading && (
          <div className="text-center py-12">
            <div className="w-8 h-8 border-2 border-zinc-700 border-t-orange-500 rounded-full animate-spin mx-auto" />
            <p className="text-zinc-500 mt-3">Loading meetings...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-800/50 rounded-xl p-4 text-center">
            <p className="text-red-400 text-sm">{error}</p>
            <p className="text-zinc-500 text-xs mt-1">
              Make sure you&apos;re signed in and have granted calendar access.
            </p>
          </div>
        )}

        {!loading && !error && meetings.length === 0 && (
          <div className="text-center py-12">
            <p className="text-zinc-400">No upcoming meetings this week.</p>
          </div>
        )}

        {!loading &&
          Object.entries(groupByDay(meetings)).map(([day, dayMeetings]) => (
            <div key={day} className="mb-8">
              <h3 className="text-sm font-medium text-zinc-400 mb-3">{day}</h3>
              <div className="space-y-2">
                {dayMeetings.map((m) => {
                  const start = new Date(m.start);
                  const end = new Date(m.end);
                  const time = `${start.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })} - ${end.toLocaleTimeString("en-US", {
                    hour: "numeric",
                    minute: "2-digit",
                  })}`;

                  return (
                    <div
                      key={m.id}
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                        m.hasAgent
                          ? "border-orange-600/30 bg-orange-600/5"
                          : "border-zinc-800 bg-zinc-900 hover:border-zinc-700"
                      }`}
                    >
                      {/* Time */}
                      <div className="w-28 flex-shrink-0">
                        <p className="text-sm text-white font-medium">
                          {time}
                        </p>
                      </div>

                      {/* Meeting info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-white font-medium text-sm truncate">
                            {m.title}
                          </p>
                          {m.hasAgent && (
                            <span className="text-[10px] px-1.5 py-0.5 bg-orange-600/20 text-orange-400 rounded-full flex-shrink-0">
                              Agent assigned
                            </span>
                          )}
                        </div>
                        <p className="text-zinc-500 text-xs mt-0.5 truncate">
                          {m.attendees.slice(0, 3).join(", ")}
                          {m.attendees.length > 3 &&
                            ` +${m.attendees.length - 3} more`}
                        </p>
                      </div>

                      {/* Platform badge */}
                      <span
                        className={`text-xs px-2 py-1 rounded-lg flex-shrink-0 ${
                          m.platform === "zoom"
                            ? "bg-blue-900/30 text-blue-400"
                            : "bg-green-900/30 text-green-400"
                        }`}
                      >
                        {m.platform === "zoom" ? "Zoom" : "Meet"}
                      </span>

                      {/* Dispatch button */}
                      {m.meetingUrl && !m.hasAgent && (
                        <button
                          onClick={() => dispatchAgent(m)}
                          disabled={dispatchingId === m.id}
                          className="px-3 py-1.5 text-xs bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white rounded-lg transition-colors flex-shrink-0"
                        >
                          {dispatchingId === m.id
                            ? "Joining..."
                            : "Send Agent"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
      </main>
    </div>
  );
}

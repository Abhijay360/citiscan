"use client";

import type { DayType } from "@/lib/time";
import type { ReplayInfo } from "@/lib/types";

export type Demo = "live" | "whatif" | "replay";

type Props = {
  demo: Demo;
  setDemo: (d: Demo) => void;
  whatIfDay: DayType;
  setWhatIfDay: (d: DayType) => void;
  whatIfTime: string;
  setWhatIfTime: (t: string) => void;
  replays: ReplayInfo[];
  replayId: string | null;
  setReplayId: (id: string) => void;
  reveal: boolean;
  setReveal: (r: boolean) => void;
};

const TABS: [Demo, string][] = [
  ["live", "Live"],
  ["whatif", "What if…"],
  ["replay", "Replay"],
];

/** Live / "what if" (another day and time) / replay (a real past moment, with what actually happened). */
export default function DemoControls(p: Props) {
  const replay = p.replays.find((r) => r.id === p.replayId);
  return (
    <div className="mt-3">
      <div className="flex gap-1 text-xs font-medium">
        {TABS.map(([d, text]) => (
          <button
            key={d}
            onClick={() => p.setDemo(d)}
            className={`rounded-full px-2.5 py-1 ${p.demo === d ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
          >
            {text}
          </button>
        ))}
      </div>

      {p.demo === "whatif" && (
        <div className="mt-2 rounded-lg bg-blue-50 p-2 text-xs text-blue-900">
          <div className="flex items-center gap-2">
            <select
              value={p.whatIfDay}
              onChange={(e) => p.setWhatIfDay(e.target.value as DayType)}
              className="rounded-md border border-blue-200 bg-white px-1.5 py-0.5"
            >
              <option value="weekday">Weekday</option>
              <option value="saturday">Saturday</option>
              <option value="sunday">Sunday</option>
            </select>
            <span>at</span>
            <input
              type="time"
              value={p.whatIfTime}
              onChange={(e) => e.target.value && p.setWhatIfTime(e.target.value)}
              className="rounded-md border border-blue-200 bg-white px-1.5 py-0.5"
            />
          </div>
          <p className="mt-1.5">
            Uses the flows for that day and time on today&apos;s live counts. Pick a station to set how many docks it has
            open.
          </p>
        </div>
      )}

      {p.demo === "replay" && (
        <div className="mt-2 rounded-lg bg-violet-50 p-2 text-xs text-violet-900">
          <select
            value={p.replayId ?? ""}
            onChange={(e) => p.setReplayId(e.target.value)}
            className="w-full rounded-md border border-violet-200 bg-white px-1.5 py-1"
          >
            {p.replays.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
          {replay && (
            <p className="mt-1.5">
              Real counts logged at that moment ({replay.source}). See what we would have predicted, then what happened.
            </p>
          )}
          <label className="mt-1.5 flex items-center gap-1.5 font-medium">
            <input type="checkbox" checked={p.reveal} onChange={(e) => p.setReveal(e.target.checked)} />
            Color the map by what actually happened
          </label>
        </div>
      )}
    </div>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { SourceAccuracy } from "@/lib/accuracy";
import type { Label } from "@/lib/types";
import { LABEL_COLORS, LABEL_TEXT } from "./colors";

const pct = (x: number, digits = 0) => `${(x * 100).toFixed(digits)}%`;
const oneIn = (x: number) => (x > 0 ? `1 in ${Math.round(1 / x)}` : "never");

// The chance each label promises, drawn as a gray band behind its bar
const BAND: Record<Label, [number, number]> = { likely: [80, 100], maybe: [50, 80], unlikely: [0, 50] };

function Tile({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs font-medium text-gray-800">{label}</div>
      <div className="mt-0.5 text-xs text-gray-500">{note}</div>
    </div>
  );
}

/** "How accurate is this?": backtest results on real dock counts the model never saw (pipeline/backtest.py). */
export default function AccuracyPanel({ sources, onClose }: { sources: SourceAccuracy[]; onClose: () => void }) {
  const [key, setKey] = useState(sources[0]?.key);
  const [hovered, setHovered] = useState<number | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const s = sources.find((x) => x.key === key) ?? sources[0];
  if (!s) return null;
  const fewer = s.fullIfCount > 0 ? 1 - s.fullIfLikely / s.fullIfCount : 0;
  const row = hovered === null ? null : s.labels[hovered];

  return (
    <div
      className="fixed inset-0 z-[1200] grid place-items-center bg-black/40 p-3"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="accuracy-title"
    >
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="accuracy-title" className="text-lg font-bold">
            How accurate is CitiScan?
          </h2>
          <button
            ref={closeButton}
            onClick={onClose}
            aria-label="Close"
            className="rounded-full px-2 text-lg leading-none text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            ×
          </button>
        </div>
        <p className="mt-1 text-sm text-gray-600">
          We replayed real dock counts the model never saw and checked each prediction 15 minutes later.
        </p>

        <div className="mt-3 flex flex-wrap gap-1 text-xs font-medium" role="tablist">
          {sources.map((src) => (
            <button
              key={src.key}
              role="tab"
              aria-selected={src.key === s.key}
              onClick={() => setKey(src.key)}
              className={`rounded-full px-2.5 py-1 ${src.key === s.key ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200"}`}
            >
              {src.title}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-gray-500">
          {s.detail} · {s.predictions.toLocaleString()} predictions
        </p>

        <div className="mt-4">
          <div className="text-5xl font-semibold tracking-tight">{pct(fewer)} fewer</div>
          <div className="text-sm font-medium text-gray-900">surprise full stations</div>
          <p className="mt-1 text-sm text-gray-600">
            Trust the current count and the station is full when you arrive {pct(s.fullIfCount, 1)} of the time (
            {oneIn(s.fullIfCount)}). Go where CitiScan says <b>Likely</b> and it&apos;s {pct(s.fullIfLikely, 1)} (
            {oneIn(s.fullIfLikely)}).
          </p>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <Tile
            value={pct(s.filledWarned)}
            label="Stations that filled up that we flagged"
            note={`of ${s.filledCases.toLocaleString()}; the current count flags none`}
          />
          <Tile value={pct(s.falseAlarm, 1)} label="False alarms" note="said Unlikely, but a dock was open" />
        </div>

        <figure className="mt-5">
          <figcaption>
            <div className="text-sm font-semibold">When CitiScan says…, a dock was actually open</div>
            <div className="text-xs text-gray-500">Gray band: the chance each label promises</div>
          </figcaption>
          <div className="mt-2 space-y-2">
            {s.labels.map((r, i) => {
              const [lo, hi] = BAND[r.label];
              return (
                <div
                  key={r.label}
                  tabIndex={0}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  aria-label={`${LABEL_TEXT[r.label]} (promises ${r.promised}): a dock was open ${pct(r.open)} of the time`}
                  className="grid grid-cols-[4.5rem_1fr_2.75rem] items-center gap-2 rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  <span className="text-sm text-gray-900">{LABEL_TEXT[r.label]}</span>
                  {/* the band is taller than the bar, so it stays visible around it */}
                  <div className="relative h-5">
                    <div className="absolute inset-y-0 bg-gray-200/70" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
                    <div
                      className="absolute inset-y-1 left-0 rounded-r-[4px]"
                      style={{ width: pct(r.open), background: LABEL_COLORS[r.label] }}
                    />
                  </div>
                  <span className="text-right text-sm tabular-nums text-gray-900">{pct(r.open)}</span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 min-h-4 text-xs text-gray-600" aria-live="polite">
            {row
              ? `${LABEL_TEXT[row.label]} promises ${row.promised}: a dock was open ${pct(row.open, 1)} of the time, across ${row.n.toLocaleString()} predictions.`
              : "Hover or tab to a bar for details."}
          </p>
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-gray-500">View as table</summary>
            <table className="mt-1 w-full text-left">
              <thead className="text-gray-500">
                <tr>
                  <th className="font-medium">Label</th>
                  <th className="font-medium">Promises</th>
                  <th className="text-right font-medium">Dock open</th>
                  <th className="text-right font-medium">Predictions</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {s.labels.map((r) => (
                  <tr key={r.label}>
                    <td>{LABEL_TEXT[r.label]}</td>
                    <td>{r.promised}</td>
                    <td className="text-right">{pct(r.open, 1)}</td>
                    <td className="text-right">{r.n.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </figure>

        <div className="mt-4 text-sm text-gray-700">
          <div className="font-semibold text-gray-900">How it works</div>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              From 16 million trips (June-August 2026) we learned how many bikes arrive at and leave every station in
              each 15 minutes of a weekday, Saturday and Sunday, and how much that swings day to day.
            </li>
            <li>
              Open docks when you arrive = open docks now minus the bikes expected to arrive first. The chance of a free
              dock comes from that day-to-day swing.
            </li>
            <li>
              Exact counts 15 minutes out are mostly noise (our count estimates beat the current count by only 1-5%).
              The win is knowing how volatile each station is at that time of day, which is what the labels capture.
            </li>
          </ul>
          <p className="mt-2 text-xs text-gray-500">
            Probability score (Brier, lower is better): {s.brierModel.toFixed(3)} for CitiScan vs{" "}
            {s.brierCount.toFixed(3)} for trusting the current count.{" "}
            <a
              href="https://github.com/Abhijay360/citiscan#how-well-it-works"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Full method and code
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

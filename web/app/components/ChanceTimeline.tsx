"use client";

import { useState } from "react";
import type { TimelineResponse } from "@/lib/types";
import { LABEL_COLORS } from "./colors";
import { formatTime, type Mode } from "./PredictionDetails";

// SVG viewBox units; the chart scales to the card's width
const W = 320;
const H = 112;
const PAD = { left: 30, right: 10, top: 8, bottom: 30 }; // bottom leaves room for the time axis and the replay row
const LINE = LABEL_COLORS.likely; // one series, one color

type Point = TimelineResponse["points"][number];

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** One plain sentence about the next 30 minutes, e.g. "Likely full by 8:57, about 12 min from now." */
export function outlook(points: Point[], mode: Mode, countNow: number, clock: (m: number) => string) {
  const key = mode === "dock" ? "pDock" : "pBike";
  const gone = mode === "dock" ? "full" : "empty";
  if (countNow === 0) return `${mode === "dock" ? "Full" : "Empty"} right now.`;
  const first = points.find((p) => p[key] < 0.5);
  if (first) return `Likely ${gone} by ${clock(first.minutes)}, about ${first.minutes} min from now.`;
  const lowest = points.reduce((a, b) => (b[key] < a[key] ? b : a));
  const last = points[points.length - 1].minutes;
  if (lowest[key] < 0.8) {
    return `Getting tight: down to ${pct(lowest[key])} chance of ${mode === "dock" ? "a dock" : "a bike"} by ${clock(lowest.minutes)}.`;
  }
  return `${mode === "dock" ? "Docks" : "Bikes"} likely for at least the next ${last} minutes.`;
}

type Props = { timeline: TimelineResponse; mode: Mode; arrivalMinutes: number; countNow: number };

/** Chance of a dock (or bike) for each minute of the next 30, with your arrival marked. */
export default function ChanceTimeline({ timeline, mode, arrivalMinutes, countNow }: Props) {
  const [inspected, setInspected] = useState<number | null>(null); // minute under the pointer or keyboard
  const key = mode === "dock" ? "pDock" : "pBike";
  const thing = mode === "dock" ? "a dock" : "a bike";
  const pts = timeline.points;
  const last = pts[pts.length - 1].minutes;
  const start = new Date(timeline.now).getTime();
  const clock = (m: number) => formatTime(new Date(start + m * 60_000).toISOString());

  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const x = (m: number) => PAD.left + (m / last) * plotW;
  const y = (p: number) => PAD.top + (1 - p) * plotH;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(p.minutes).toFixed(1)},${y(p[key]).toFixed(1)}`).join("");
  const area = `${line}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`;

  const arrival = pts[Math.min(Math.max(Math.round(arrivalMinutes), 0), last)];
  const shown = pts[inspected ?? arrival.minutes];
  const actualAt = (m: number) => timeline.actual?.find((a) => a.minutes === m);
  const actualCount = (a: { docks: number; bikes: number }) => (mode === "dock" ? a.docks : a.bikes);
  const shownActual = actualAt(shown.minutes);

  function inspectAt(clientX: number, rect: DOMRect) {
    const m = Math.round(((((clientX - rect.left) / rect.width) * W - PAD.left) / plotW) * last);
    setInspected(Math.min(Math.max(m, 0), last));
  }

  return (
    <div className="mt-3 border-t border-gray-200 pt-2">
      <div className="text-sm font-medium text-gray-900">{outlook(pts, mode, countNow, clock)}</div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full touch-none select-none rounded outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        role="img"
        aria-label={`Chance of ${thing} over the next ${last} minutes. Use the arrow keys to read each minute.`}
        tabIndex={0}
        onPointerMove={(e) => inspectAt(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setInspected(null)}
        onBlur={() => setInspected(null)}
        onKeyDown={(e) => {
          const from = inspected ?? arrival.minutes;
          if (e.key === "ArrowRight") setInspected(Math.min(from + 1, last));
          if (e.key === "ArrowLeft") setInspected(Math.max(from - 1, 0));
        }}
      >
        {/* guides at the label thresholds: above 80% is "likely", below 50% "unlikely" */}
        {[0.8, 0.5].map((g) => (
          <g key={g}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)} stroke="#e5e7eb" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(g) + 3} textAnchor="end" fontSize={9} fill="#6b7280">
              {pct(g)}
            </text>
          </g>
        ))}
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeWidth={1} />
        <path d={area} fill={LINE} fillOpacity={0.1} />
        <path d={line} fill="none" stroke={LINE} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {inspected !== null && (
          <line x1={x(inspected)} x2={x(inspected)} y1={PAD.top} y2={y(0)} stroke="#9ca3af" strokeWidth={1} />
        )}
        <circle cx={x(arrival.minutes)} cy={y(arrival[key])} r={4.5} fill={LINE} stroke="#ffffff" strokeWidth={2} />
        {inspected !== null && inspected !== arrival.minutes && (
          <circle cx={x(inspected)} cy={y(pts[inspected][key])} r={4} fill="#ffffff" stroke={LINE} strokeWidth={2} />
        )}
        {[0, 10, 20, 30]
          .filter((m) => m <= last)
          .map((m) => (
            <text
              key={m}
              x={x(m)}
              y={y(0) + 11}
              textAnchor={m === 0 ? "start" : m === last ? "end" : "middle"}
              fontSize={9}
              fill="#6b7280"
            >
              {clock(m)}
            </text>
          ))}
        {timeline.actual && (
          <g>
            <text x={PAD.left - 4} y={H - 4} textAnchor="end" fontSize={9} fill="#6b7280">
              real
            </text>
            {timeline.actual.map((a) => (
              <rect
                key={a.minutes}
                x={x(a.minutes) - (a.minutes === 0 ? 0 : a.minutes === last ? 8 : 4)}
                y={H - 12}
                width={8}
                height={8}
                rx={2}
                fill={actualCount(a) >= 1 ? LABEL_COLORS.likely : LABEL_COLORS.unlikely}
              />
            ))}
          </g>
        )}
      </svg>
      <p className="min-h-4 text-xs text-gray-600" aria-live="polite">
        {clock(shown.minutes)}
        {shown.minutes === arrival.minutes ? " (when you arrive)" : ""}: {pct(shown[key])} chance of {thing}
        {shownActual && `; really had ${actualCount(shownActual)} ${mode === "dock" ? "open docks" : "bikes"}`}
      </p>
      {timeline.actual && (
        <p className="mt-0.5 flex items-center gap-3 text-xs text-gray-600">
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LABEL_COLORS.likely }} />
            really had {thing}
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: LABEL_COLORS.unlikely }} />
            really {mode === "dock" ? "full" : "empty"} (logged every 5 min)
          </span>
        </p>
      )}
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer text-gray-500">View as table</summary>
        <table className="mt-1 w-full text-left">
          <thead className="text-gray-500">
            <tr>
              <th className="font-medium">Time</th>
              <th className="text-right font-medium">Chance of {thing}</th>
              {timeline.actual && <th className="text-right font-medium">Really had</th>}
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {pts
              .filter((p) => p.minutes % 5 === 0)
              .map((p) => {
                const a = actualAt(p.minutes);
                return (
                  <tr key={p.minutes}>
                    <td>{clock(p.minutes)}</td>
                    <td className="text-right">{pct(p[key])}</td>
                    {timeline.actual && <td className="text-right">{a ? actualCount(a) : "-"}</td>}
                  </tr>
                );
              })}
          </tbody>
        </table>
      </details>
    </div>
  );
}

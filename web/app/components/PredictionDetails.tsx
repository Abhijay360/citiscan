import type { Label, StationPrediction } from "@/lib/types";
import { LABEL_COLORS, LABEL_TEXT, NO_DATA_COLOR } from "./colors";

export type Mode = "dock" | "bike";

export function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LabelChip({ label, hasHistory, small }: { label: Label; hasHistory: boolean; small?: boolean }) {
  return (
    <span
      className={`inline-block rounded-full font-semibold text-white ${small ? "px-2 text-xs" : "px-2.5 py-0.5 text-sm"}`}
      style={{ background: hasHistory ? LABEL_COLORS[label] : NO_DATA_COLOR }}
    >
      {LABEL_TEXT[label]}
    </span>
  );
}

function describeChange(change: number) {
  const n = Math.round(Math.abs(change));
  if (n === 0) return "Usually quiet at this time, so little change expected.";
  const bikes = `${n} more bike${n === 1 ? "" : "s"}`;
  return change > 0 ? `About ${bikes} arriving than leaving by then.` : `About ${bikes} leaving than arriving by then.`;
}

/** Now vs. at arrival for one station: label, chance, predicted count, and why. */
export default function PredictionDetails({
  station: s,
  mode,
  at,
}: {
  station: StationPrediction;
  mode: Mode;
  at: string;
}) {
  const isDock = mode === "dock";
  const label = isDock ? s.dockLabel : s.bikeLabel;
  const chance = Math.round((isDock ? s.pDock : s.pBike) * 100);
  const predicted = Math.round(isDock ? s.predictedDocks : s.predictedBikes);
  return (
    <div>
      <div className="text-sm text-gray-600">
        Now: {s.docks} open dock{s.docks === 1 ? "" : "s"} · {s.bikes} bike{s.bikes === 1 ? "" : "s"}
        {s.ebikes > 0 && ` (${s.ebikes === s.bikes ? "all" : s.ebikes} e-bike${s.ebikes === 1 ? "" : "s"})`}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <LabelChip label={label} hasHistory={s.hasHistory} />
        <span className="text-sm">
          {chance}% chance of {isDock ? "an open dock" : "a bike"} at {formatTime(at)}
        </span>
      </div>
      <div className="mt-2 text-sm">
        Predicted {isDock ? "open docks" : "bikes"} at {formatTime(at)}: <b>~{predicted}</b>
      </div>
      <div className="text-xs text-gray-500">{describeChange(s.expectedChange)}</div>
      {isDock && !s.isReturning && (
        <p className="mt-2 text-xs font-medium text-red-700">This station isn&apos;t accepting bikes right now.</p>
      )}
      {!isDock && !s.isRenting && (
        <p className="mt-2 text-xs font-medium text-red-700">This station isn&apos;t renting bikes right now.</p>
      )}
      {s.rebalanced && (
        <p className="mt-2 text-xs text-amber-700">
          Citi Bike moves bikes at this station (trucks or valet), so the real change is often smaller than predicted.
        </p>
      )}
      {!s.hasHistory && (
        <p className="mt-2 text-xs text-gray-500">
          New station with no trip history yet: we assume the count stays the same.
        </p>
      )}
    </div>
  );
}

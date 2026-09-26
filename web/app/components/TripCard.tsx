import type { Alternative } from "@/lib/alternatives";
import { distanceMeters, walkMinutes, type Place } from "@/lib/geo";
import type { StationPrediction, TimelineResponse } from "@/lib/types";
import ChanceTimeline from "./ChanceTimeline";
import type { Demo } from "./DemoControls";
import PredictionDetails, { LabelChip, formatTime, type Mode } from "./PredictionDetails";

type Props = {
  station: StationPrediction; // the station nearest the destination
  destination: Place;
  mode: Mode;
  at: string;
  travelNote: string; // e.g. "12 min by e-bike from your location"
  alternatives: Alternative[];
  demo: Demo;
  onOverride: (docks: number) => void; // "what if" mode: pretend the station has this many open docks
  timeline: TimelineResponse | null; // this station's chance over the next 30 minutes
  arrivalMinutes: number;
};

const walkText = (meters: number) => `${Math.max(1, Math.round(walkMinutes(meters)))} min walk`;

/** Replay mode: did the label hold up against what was really logged at the arrival time? */
function Outcome({ station: s, mode, at }: { station: StationPrediction; mode: Mode; at: string }) {
  const isDock = mode === "dock";
  const actual = isDock ? s.actualDocks : s.actualBikes;
  if (actual === undefined) return null;
  const label = isDock ? s.dockLabel : s.bikeLabel;
  const available = actual >= 1;
  const verdict =
    label === "maybe"
      ? { text: "we said maybe", color: "text-gray-600" }
      : (label === "likely") === available
        ? { text: "✓ we called it", color: "text-green-700" }
        : { text: "✗ we missed this one", color: "text-red-700" };
  return (
    <div className="mt-2 rounded-lg bg-violet-50 px-2.5 py-1.5 text-sm">
      What actually happened at {formatTime(at)}: <b>{actual}</b> {isDock ? "open docks" : "bikes"}
      {!available && (isDock ? " (full)" : " (empty)")} ·{" "}
      <span className={`font-semibold ${verdict.color}`}>{verdict.text}</span>
    </div>
  );
}

export default function TripCard({
  station,
  destination,
  mode,
  at,
  travelNote,
  alternatives,
  demo,
  onOverride,
  timeline,
  arrivalMinutes,
}: Props) {
  const isDock = mode === "dock";
  const label = isDock ? station.dockLabel : station.bikeLabel;
  const toDestination = distanceMeters(station, destination);
  const pickedStation = destination.label === station.name;
  const total = station.docks + station.bikes;

  return (
    <div className="mt-3 rounded-xl border border-gray-200 p-3">
      {!pickedStation && (
        <div className="text-xs text-gray-500">
          Nearest station to {destination.label} · {walkText(toDestination)}
        </div>
      )}
      <div className="font-semibold leading-tight">{station.name}</div>
      <div className="mb-2 text-xs text-gray-500">
        {travelNote} · arrive ~{formatTime(at)}
      </div>

      {demo === "whatif" && (
        <label className="mb-2 block rounded-lg bg-blue-50 px-2.5 py-1.5 text-xs text-blue-900">
          What if it had <b>{station.docks}</b> open docks now?
          <input
            type="range"
            min={0}
            max={total}
            value={station.docks}
            onChange={(e) => onOverride(Number(e.target.value))}
            className="w-full accent-blue-600"
          />
        </label>
      )}

      <PredictionDetails station={station} mode={mode} at={at} />
      <Outcome station={station} mode={mode} at={at} />
      {timeline && (
        <ChanceTimeline
          timeline={timeline}
          mode={mode}
          arrivalMinutes={arrivalMinutes}
          countNow={isDock ? station.docks : station.bikes}
        />
      )}

      {label !== "likely" && (
        <div className="mt-3 border-t border-gray-200 pt-2">
          <div className="text-sm font-semibold">
            {alternatives.length
              ? `Backup stations where ${isDock ? "a dock" : "a bike"} is likely`
              : `No station within 1 km looks likely to have ${isDock ? "a dock" : "a bike"}`}
          </div>
          <ol>
            {alternatives.map((a, i) => {
              const actual = isDock ? a.station.actualDocks : a.station.actualBikes;
              return (
                <li key={a.station.id} className="mt-2 flex items-start gap-2 text-sm">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-gray-900 text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate leading-tight">{a.station.name}</span>
                      <LabelChip
                        small
                        label={isDock ? a.station.dockLabel : a.station.bikeLabel}
                        hasHistory={a.station.hasHistory}
                      />
                    </div>
                    <div className="text-xs text-gray-600">
                      {Math.round((isDock ? a.station.pDock : a.station.pBike) * 100)}% chance · ~
                      {Math.round(isDock ? a.station.predictedDocks : a.station.predictedBikes)}{" "}
                      {isDock ? "docks" : "bikes"} · {walkText(a.meters)}{" "}
                      {pickedStation ? "away" : "to your destination"}
                      {actual !== undefined && ` · actually had ${actual}`}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

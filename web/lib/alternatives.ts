import { distanceMeters } from "./geo";
import type { StationPrediction } from "./types";

export type Alternative = { station: StationPrediction; meters: number };

const MAX_METERS = 1000; // further than ~15 minutes' walk isn't a useful backup

/** Up to `max` stations near the destination where a dock (or bike) is likely at arrival, closest first. */
export function findAlternatives(
  stations: StationPrediction[],
  destination: { lat: number; lon: number },
  excludeId: string,
  mode: "dock" | "bike",
  max = 3,
): Alternative[] {
  return stations
    .filter((s) => s.id !== excludeId && (mode === "dock" ? s.pDock : s.pBike) >= 0.8)
    .map((s) => ({ station: s, meters: distanceMeters(destination, s) }))
    .filter((a) => a.meters <= MAX_METERS)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, max);
}

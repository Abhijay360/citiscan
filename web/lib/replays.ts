import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ReplayInfo } from "./types";

export type ReplayScenario = ReplayInfo & {
  stations: Record<string, { docks: number[]; bikes: number[] }>; // counts at each offset, by GBFS station_id
};

// Built offline by pipeline/make_replays.py (real logged moments, with what happened next).
let replays: Promise<ReplayScenario[]> | null = null;

function read(): Promise<ReplayScenario[]> {
  return readFile(path.join(process.cwd(), "data", "replays.json"), "utf8").then((text) => JSON.parse(text).scenarios);
}

export function loadReplays(): Promise<ReplayScenario[]> {
  if (process.env.NODE_ENV !== "production") return read(); // pick up pipeline reruns without a restart
  replays ??= read();
  return replays;
}

export function replayInfo(scenario: ReplayScenario): ReplayInfo {
  const { id, title, mode, source, now, offsets, center, stats } = scenario;
  return { id, title, mode, source, now, offsets, center, stats };
}

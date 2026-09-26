// Works out what a request is asking about (which "now", and whose counts: live, a "what if" override, or a
// replayed moment) and predicts from there. Shared by /api/predict (every station) and /api/timeline (one station).

import { loadFlowTable } from "./flows";
import { getLiveStations, type LiveStation } from "./gbfs";
import { label, predictStation, windowWeights, type FlowTable } from "./predict";
import { loadReplays, type ReplayScenario } from "./replays";
import type { StationPrediction, TimelineResponse } from "./types";

export type Scenario = {
  now: Date;
  table: FlowTable;
  stations: LiveStation[];
  feedUpdated: Date;
  replay?: ReplayScenario;
};

export class ScenarioError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** Query params: `replay=<id>`, or live counts with optional `now=<ISO>` and `override=<station_id>:<docks>`. */
export async function resolveScenario(q: URLSearchParams): Promise<Scenario> {
  const table = await loadFlowTable();

  const replayId = q.get("replay");
  if (replayId) {
    const replay = (await loadReplays()).find((r) => r.id === replayId);
    if (!replay) throw new ScenarioError("unknown replay", 404);
    // Replays carry their own station details, so they keep working when the live feed is down
    const stations = Object.entries(replay.stations).map(([id, s]) => ({
      id,
      shortName: s.shortName,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity,
      bikes: s.bikes[0],
      ebikes: s.ebikes[0],
      docks: s.docks[0],
      isRenting: true,
      isReturning: true,
    }));
    const now = new Date(replay.now);
    return { now, table, stations, feedUpdated: now, replay };
  }

  const live = await getLiveStations().catch(() => null);
  if (!live) throw new ScenarioError("Couldn't reach Citi Bike's live feed.", 503);
  const [overrideId, overrideDocks] = (q.get("override") ?? "").split(":");
  const stations = overrideId
    ? live.stations.map((s) => (s.id === overrideId ? withOpenDocks(s, Number(overrideDocks)) : s))
    : live.stations;
  const now = q.get("now") ? new Date(q.get("now")!) : new Date();
  if (Number.isNaN(now.getTime())) throw new ScenarioError("bad `now` time", 400);
  return { now, table, stations, feedUpdated: live.lastUpdated };
}

/** "What if" override: same station, but `docks` of its docking points open and the rest holding bikes. */
function withOpenDocks(s: LiveStation, docks: number): LiveStation {
  const total = s.docks + s.bikes;
  const open = Math.min(Math.max(docks || 0, 0), total);
  return { ...s, docks: open, bikes: total - open, ebikes: Math.min(s.ebikes, total - open) };
}

/** Every station, predicted for arriving `minutes` after the scenario's now. Replays snap to their logged offsets. */
export function predictAll(sc: Scenario, minutes: number) {
  let offsetIndex = 0;
  if (sc.replay) {
    offsetIndex = nearestIndex(sc.replay.offsets, minutes);
    minutes = sc.replay.offsets[offsetIndex];
  }
  const at = new Date(sc.now.getTime() + minutes * 60_000);
  const weights = windowWeights(sc.now, at, sc.table.meta.bucket_minutes);

  const stations: StationPrediction[] = sc.stations.map((s) => {
    const flows = sc.table.stations[s.shortName];
    const p = predictStation(s, flows, weights, sc.table.meta.params);
    const logged = sc.replay?.stations[s.id];
    return {
      id: s.id,
      shortName: s.shortName,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity,
      bikes: s.bikes,
      ebikes: s.ebikes,
      docks: s.docks,
      expectedChange: round1(p.expectedChange),
      predictedBikes: round1(p.predictedBikes),
      predictedDocks: round1(p.predictedDocks),
      pDock: round2(p.pDock),
      pBike: round2(p.pBike),
      dockLabel: label(p.pDock),
      bikeLabel: label(p.pBike),
      isRenting: s.isRenting,
      isReturning: s.isReturning,
      hasHistory: Boolean(flows),
      rebalanced: flows?.rebalanced ?? false,
      ...(logged && { actualDocks: logged.docks[offsetIndex], actualBikes: logged.bikes[offsetIndex] }),
    };
  });
  return { at, stations };
}

/** One station's chance of a dock and a bike for each minute of the next `horizon` minutes. */
export function stationTimeline(sc: Scenario, stationId: string, horizon = 30): TimelineResponse | null {
  const s = sc.stations.find((x) => x.id === stationId);
  if (!s) return null;
  const flows = sc.table.stations[s.shortName];
  const points = [];
  for (let m = 0; m <= horizon; m++) {
    const at = new Date(sc.now.getTime() + m * 60_000);
    const p = predictStation(s, flows, windowWeights(sc.now, at, sc.table.meta.bucket_minutes), sc.table.meta.params);
    points.push({ minutes: m, pDock: round2(p.pDock), pBike: round2(p.pBike) });
  }
  const logged = sc.replay?.stations[stationId];
  const actual = logged
    ? sc.replay!.offsets.map((m, i) => ({ minutes: m, docks: logged.docks[i], bikes: logged.bikes[i] }))
    : undefined;
  return { now: sc.now.toISOString(), points, ...(actual && { actual }) };
}

function nearestIndex(values: number[], target: number) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  return best;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

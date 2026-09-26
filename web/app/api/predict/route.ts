// GET /api/predict?minutes=15              predictions for arriving 15 minutes from now
// GET /api/predict?at=2026-09-28T12:45Z     predictions for a specific arrival time
// Demo options:
//   &now=<ISO>               "what if": use the flows for another time of day (counts stay live)
//   &override=<id>:<docks>   "what if": pretend one station has this many open docks now
//   &replay=<id>             replay a real logged moment (/api/replays); adds what actually happened

import type { NextRequest } from "next/server";
import { loadFlowTable } from "@/lib/flows";
import { getLiveStations, type LiveStation } from "@/lib/gbfs";
import { label, predictStation, windowWeights } from "@/lib/predict";
import { loadReplays, replayInfo, type ReplayScenario } from "@/lib/replays";
import type { PredictResponse, StationPrediction } from "@/lib/types";

export const dynamic = "force-dynamic"; // live data: never prerender at build time

const MAX_HORIZON_MIN = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let replay: ReplayScenario | undefined;
  if (q.get("replay")) {
    replay = (await loadReplays()).find((r) => r.id === q.get("replay"));
    if (!replay) return Response.json({ error: "unknown replay" }, { status: 404 });
  }

  const now = replay ? new Date(replay.now) : q.get("now") ? new Date(q.get("now")!) : new Date();
  let minutes = q.get("at")
    ? (new Date(q.get("at")!).getTime() - now.getTime()) / 60_000
    : Number(q.get("minutes") ?? 15);
  let offsetIndex = 0;
  if (replay) {
    // replays only know the counts every 5 minutes: snap to the nearest logged offset
    offsetIndex = nearestIndex(replay.offsets, minutes);
    minutes = replay.offsets[offsetIndex];
  }
  if (Number.isNaN(minutes) || minutes < 0 || minutes > MAX_HORIZON_MIN) {
    return Response.json({ error: `arrival must be 0-${MAX_HORIZON_MIN} minutes after now` }, { status: 400 });
  }
  const at = new Date(now.getTime() + minutes * 60_000);

  const [table, live] = await Promise.all([loadFlowTable(), getLiveStations().catch(() => null)]);
  if (!live)
    return Response.json({ error: "Couldn't reach Citi Bike's live feed. Try again in a minute." }, { status: 503 });

  let stations: LiveStation[] = live.stations;
  if (replay) {
    const logged = replay.stations;
    stations = stations
      .filter((s) => logged[s.id])
      .map((s) => ({
        ...s,
        docks: logged[s.id].docks[0],
        bikes: logged[s.id].bikes[0],
        isRenting: true,
        isReturning: true,
      }));
  }
  const [overrideId, overrideDocks] = (q.get("override") ?? "").split(":");
  if (overrideId) {
    stations = stations.map((s) => {
      if (s.id !== overrideId) return s;
      const total = s.docks + s.bikes;
      const docks = Math.min(Math.max(Number(overrideDocks) || 0, 0), total);
      return { ...s, docks, bikes: total - docks };
    });
  }

  const weights = windowWeights(now, at, table.meta.bucket_minutes);
  const predictions: StationPrediction[] = stations.map((s) => {
    const flows = table.stations[s.shortName];
    const p = predictStation(s, flows, weights, table.meta.params);
    return {
      id: s.id,
      shortName: s.shortName,
      name: s.name,
      lat: s.lat,
      lon: s.lon,
      capacity: s.capacity,
      bikes: s.bikes,
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
      ...(replay && {
        actualDocks: replay.stations[s.id].docks[offsetIndex],
        actualBikes: replay.stations[s.id].bikes[offsetIndex],
      }),
    };
  });

  const body: PredictResponse = {
    now: now.toISOString(),
    at: at.toISOString(),
    feedUpdated: replay ? now.toISOString() : live.lastUpdated.toISOString(),
    speedKmh: table.meta.speed_kmh,
    ...(replay && { replay: replayInfo(replay) }),
    stations: predictions,
  };
  return Response.json(body);
}

function nearestIndex(values: number[], target: number) {
  let best = 0;
  for (let i = 1; i < values.length; i++) if (Math.abs(values[i] - target) < Math.abs(values[best] - target)) best = i;
  return best;
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const round2 = (x: number) => Math.round(x * 100) / 100;

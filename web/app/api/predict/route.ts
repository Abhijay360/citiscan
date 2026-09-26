// GET /api/predict?minutes=15              predictions for arriving 15 minutes from now
// GET /api/predict?at=2026-09-28T12:45Z     predictions for a specific arrival time
// Demo options:
//   &now=<ISO>               "what if": use the flows for another time of day (counts stay live)
//   &override=<id>:<docks>   "what if": pretend one station has this many open docks now
//   &replay=<id>             replay a real logged moment (/api/replays); adds what actually happened and
//                            works without the live feed

import type { NextRequest } from "next/server";
import { ScenarioError, predictAll, resolveScenario } from "@/lib/scenario";
import { replayInfo } from "@/lib/replays";
import type { PredictResponse } from "@/lib/types";

export const dynamic = "force-dynamic"; // live data: never prerender at build time

const MAX_HORIZON_MIN = 120;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    const sc = await resolveScenario(q);
    const minutes = q.get("at")
      ? (new Date(q.get("at")!).getTime() - sc.now.getTime()) / 60_000
      : Number(q.get("minutes") ?? 15);
    if (Number.isNaN(minutes) || minutes < 0 || minutes > MAX_HORIZON_MIN) {
      return Response.json({ error: `arrival must be 0-${MAX_HORIZON_MIN} minutes after now` }, { status: 400 });
    }
    const { at, stations } = predictAll(sc, minutes);
    const body: PredictResponse = {
      now: sc.now.toISOString(),
      at: at.toISOString(),
      feedUpdated: sc.feedUpdated.toISOString(),
      speedKmh: sc.table.meta.speed_kmh,
      ...(sc.replay && { replay: replayInfo(sc.replay) }),
      stations,
    };
    return Response.json(body);
  } catch (e) {
    if (e instanceof ScenarioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

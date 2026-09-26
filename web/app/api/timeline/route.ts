// GET /api/timeline?station=<station_id>   one station's chance of a dock and a bike for each of the next 30 minutes
// Takes the same scenario options as /api/predict (&now, &override, &replay); replays add what actually happened.

import type { NextRequest } from "next/server";
import { ScenarioError, resolveScenario, stationTimeline } from "@/lib/scenario";

export const dynamic = "force-dynamic"; // live data: never prerender at build time

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const station = q.get("station");
  if (!station) return Response.json({ error: "station is required" }, { status: 400 });
  try {
    const timeline = stationTimeline(await resolveScenario(q), station);
    if (!timeline) return Response.json({ error: "unknown station" }, { status: 404 });
    return Response.json(timeline);
  } catch (e) {
    if (e instanceof ScenarioError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }
}

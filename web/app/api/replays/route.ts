// GET /api/replays -> the real past moments available in replay mode (see pipeline/make_replays.py)

import { loadReplays, replayInfo } from "@/lib/replays";

export async function GET() {
  const scenarios = await loadReplays();
  return Response.json(scenarios.map(replayInfo));
}

// The prediction math. pipeline/backtest.py mirrors these functions, so keep the two in sync.
//
//   predicted open docks = open docks now - expected net inflow until arrival   (clamped to the station)
//   chance of a dock     = P(net inflow <= open docks now - 1), net inflow ~ Normal(mean, variance)
//
// expected net inflow = flow_scale[day type] x the historical trip flow: real dock counts move less than trips
// imply (rebalancing, and summer weekends are busier than autumn ones). See pipeline/build_flow_table.py.

import type { Label } from "./types";

export type StationFlows = {
  mean: number[][]; // [dayType][bucket] expected net inflow (arrivals - departures) per bucket
  var: number[][]; // [dayType][bucket] day-to-day variance of that net inflow
  trips_per_day: number;
  rebalanced: boolean;
};

export type FlowTable = {
  meta: {
    bucket_minutes: number;
    day_types: string[]; // ["weekday", "saturday", "sunday"]
    speed_kmh: { classic: number; ebike: number };
    params: { shrink_bikes: number; flow_scale: number[] }; // flow_scale per day type
    months: string[];
  };
  stations: Record<string, StationFlows>; // keyed by GBFS short_name
};

/** Variance floor so quiet stations (or ones with no history) still get some uncertainty. */
export const MIN_VARIANCE = 0.25;

export function label(p: number): Label {
  return p >= 0.8 ? "likely" : p >= 0.5 ? "maybe" : "unlikely";
}

const NYC_CLOCK = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
  hourCycle: "h23",
});

/** Minutes since midnight and day type (0 weekday, 1 saturday, 2 sunday) in New York, whatever the server's timezone. */
export function nycClock(t: Date) {
  const p = Object.fromEntries(NYC_CLOCK.formatToParts(t).map((x) => [x.type, x.value]));
  const minuteOfDay = Number(p.hour) * 60 + Number(p.minute) + Number(p.second) / 60;
  const dayType = p.weekday === "Sat" ? 1 : p.weekday === "Sun" ? 2 : 0;
  return { minuteOfDay, dayType };
}

export type WindowWeight = { dayType: number; bucket: number; fraction: number };

/**
 * Which 15-minute buckets the window [from, to) covers, and what fraction of each.
 * E.g. 8:37 -> 8:52 covers 8/15 of the 8:30 bucket and 7/15 of the 8:45 bucket.
 * The same for every station, so compute it once per request.
 */
export function windowWeights(from: Date, to: Date, bucketMinutes: number): WindowWeight[] {
  const weights: WindowWeight[] = [];
  const bucketMs = bucketMinutes * 60_000;
  const bucketsPerDay = (24 * 60) / bucketMinutes;
  let t = from.getTime();
  const end = to.getTime();
  while (t < end) {
    const { minuteOfDay, dayType } = nycClock(new Date(t));
    const bucket = Math.floor(minuteOfDay / bucketMinutes) % bucketsPerDay;
    const untilNextBucket = (bucketMinutes - (minuteOfDay % bucketMinutes)) * 60_000;
    const step = Math.min(untilNextBucket, end - t);
    weights.push({ dayType, bucket, fraction: step / bucketMs });
    t += step;
  }
  return weights;
}

/** Expected net inflow and its variance over the window. Buckets are treated as independent (checked on
 * the trip data: a 30-min window's variance is 1.03x the sum of its two 15-min variances). */
export function expectedFlow(flows: StationFlows, weights: WindowWeight[], flowScale: number[]) {
  let mean = 0;
  let variance = 0;
  for (const w of weights) {
    mean += w.fraction * flowScale[w.dayType] * flows.mean[w.dayType][w.bucket];
    variance += w.fraction * flows.var[w.dayType][w.bucket];
  }
  return { mean, variance };
}

/** Pull the expected change toward zero; changes smaller than `by` bikes become "no change". */
export function shrink(x: number, by: number) {
  return Math.sign(x) * Math.max(Math.abs(x) - by, 0);
}

const clamp = (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi);

export function predictStation(
  now: { bikes: number; docks: number; isRenting: boolean; isReturning: boolean },
  flows: StationFlows | undefined,
  weights: WindowWeight[],
  params: FlowTable["meta"]["params"],
) {
  const { mean, variance } = flows ? expectedFlow(flows, weights, params.flow_scale) : { mean: 0, variance: 0 };
  const change = shrink(mean, params.shrink_bikes);
  const total = now.bikes + now.docks; // working docking points right now
  const sd = Math.sqrt(variance + MIN_VARIANCE);
  // +/- 0.5 is a continuity correction: counts are whole numbers, the normal curve isn't
  const pDock = now.isReturning && total > 0 ? normalCdf((now.docks - 0.5 - mean) / sd) : 0;
  const pBike = now.isRenting && total > 0 ? normalCdf((now.bikes - 0.5 + mean) / sd) : 0;
  return {
    expectedChange: change,
    predictedDocks: clamp(now.docks - change, 0, total),
    predictedBikes: clamp(now.bikes + change, 0, total),
    pDock,
    pBike,
  };
}

/** Standard normal CDF (Abramowitz & Stegun 7.1.26, error < 1e-7). */
export function normalCdf(z: number) {
  const t = 1 / (1 + (0.3275911 * Math.abs(z)) / Math.SQRT2);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

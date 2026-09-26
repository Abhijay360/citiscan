export type Place = { lat: number; lon: number; label: string };
type LatLon = { lat: number; lon: number };

const WALK_METERS_PER_MIN = 80; // ~4.8 km/h
const WALK_DETOUR = 1.3; // street grid vs straight line
const DOCK_OVERHEAD_MIN = 2; // unlocking + docking

export function distanceMeters(a: LatLon, b: LatLon) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

export function walkMinutes(meters: number) {
  return (meters * WALK_DETOUR) / WALK_METERS_PER_MIN;
}

/** speedKmh is a straight-line speed measured from real trips, so detours are already baked in. */
export function bikeMinutes(meters: number, speedKmh: number) {
  return (meters / 1000 / speedKmh) * 60 + DOCK_OVERHEAD_MIN;
}

export function nearest<T extends LatLon>(items: T[], to: LatLon): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const item of items) {
    const d = distanceMeters(item, to);
    if (d < bestDist) {
      best = item;
      bestDist = d;
    }
  }
  return best;
}

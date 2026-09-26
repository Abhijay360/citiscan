// Live station data from Citi Bike's public GBFS feed (https://gbfs.lyft.com/gbfs/2.3/bkn/gbfs.json).

// GBFS_FEED can point elsewhere, e.g. at a dead URL to test how the app behaves when the feed is down
const FEED = process.env.GBFS_FEED ?? "https://gbfs.lyft.com/gbfs/2.3/bkn/en";
const STATUS_TTL_MS = 30_000; // the feed itself refreshes every 60s
const INFO_TTL_MS = 10 * 60_000; // names and locations rarely change

export type LiveStation = {
  id: string;
  shortName: string;
  name: string;
  lat: number;
  lon: number;
  capacity: number;
  bikes: number;
  ebikes: number; // of `bikes`, how many are e-bikes
  docks: number;
  isRenting: boolean;
  isReturning: boolean;
};

type GbfsInfo = {
  data: {
    stations: { station_id: string; short_name: string; name: string; lat: number; lon: number; capacity: number }[];
  };
};
type GbfsStatus = {
  last_updated: number;
  data: {
    stations: {
      station_id: string;
      num_bikes_available: number;
      num_ebikes_available?: number;
      num_docks_available: number;
      is_installed: number;
      is_renting: number;
      is_returning: number;
    }[];
  };
};

const cache = new Map<string, { fetchedAt: number; body: unknown }>();

async function fetchFeed<T>(name: string, ttlMs: number): Promise<T> {
  const hit = cache.get(name);
  if (hit && Date.now() - hit.fetchedAt < ttlMs) return hit.body as T;
  try {
    const res = await fetch(`${FEED}/${name}.json`, { cache: "no-store", signal: AbortSignal.timeout(8_000) });
    if (!res.ok) throw new Error(`GBFS ${name} returned ${res.status}`);
    const body = await res.json();
    cache.set(name, { fetchedAt: Date.now(), body });
    return body as T;
  } catch (e) {
    if (hit) return hit.body as T; // a network blip: keep serving the last good copy (feedUpdated shows its age)
    throw e;
  }
}

/** Installed stations with their current bike and dock counts. */
export async function getLiveStations(): Promise<{ lastUpdated: Date; stations: LiveStation[] }> {
  const [info, status] = await Promise.all([
    fetchFeed<GbfsInfo>("station_information", INFO_TTL_MS),
    fetchFeed<GbfsStatus>("station_status", STATUS_TTL_MS),
  ]);
  const infoById = new Map(info.data.stations.map((s) => [s.station_id, s]));
  const stations: LiveStation[] = [];
  for (const s of status.data.stations) {
    const i = infoById.get(s.station_id);
    if (!i || !s.is_installed) continue;
    stations.push({
      id: s.station_id,
      shortName: i.short_name,
      name: i.name,
      lat: i.lat,
      lon: i.lon,
      capacity: i.capacity,
      bikes: s.num_bikes_available,
      ebikes: s.num_ebikes_available ?? 0,
      docks: s.num_docks_available,
      isRenting: s.is_renting === 1,
      isReturning: s.is_returning === 1,
    });
  }
  return { lastUpdated: new Date(status.last_updated * 1000), stations };
}

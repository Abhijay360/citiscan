"use client";

import { useMemo, useState } from "react";
import type { Place } from "@/lib/geo";
import type { StationPrediction } from "@/lib/types";

type Props = {
  stations: StationPrediction[];
  onPick: (place: Place) => void;
};

// Station names match as you type; Enter looks the text up as an address with OpenStreetMap's Nominatim
// geocoder (their usage policy allows lookups on submit, not per keystroke).
export default function PlaceSearch({ stations, onPick }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return stations.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, stations]);

  function pick(place: Place) {
    onPick(place);
    setQuery(place.label);
    setOpen(false);
    setStatus(null);
  }

  async function searchAddress() {
    const q = query.trim();
    const exact = stations.find((s) => s.name.toLowerCase() === q.toLowerCase());
    if (exact) return pick({ lat: exact.lat, lon: exact.lon, label: exact.name });
    if (!q) return;
    setStatus("Searching...");
    try {
      const url =
        "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&bounded=1&viewbox=-74.26,40.92,-73.70,40.49&q=" +
        encodeURIComponent(q);
      const results: { lat: string; lon: string; name?: string }[] = await (await fetch(url)).json();
      if (!results.length) return setStatus(`Couldn't find "${q}" in NYC. Try a station name or tap the map.`);
      pick({ lat: Number(results[0].lat), lon: Number(results[0].lon), label: results[0].name || q });
    } catch {
      setStatus("Address search failed. Try a station name or tap the map.");
    }
  }

  return (
    <form
      className="relative"
      onSubmit={(e) => {
        e.preventDefault();
        searchAddress();
      }}
    >
      <input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setStatus(null);
        }}
        onFocus={() => setOpen(true)}
        placeholder="Where to? Station or address, or tap the map"
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-gray-200 bg-white text-sm shadow-lg">
          {matches.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => pick({ lat: s.lat, lon: s.lon, label: s.name })}
                className="block w-full px-3 py-1.5 text-left hover:bg-gray-100"
              >
                {s.name}
              </button>
            </li>
          ))}
          <li className="border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">Press Enter to search as an address</li>
        </ul>
      )}
      {status && <p className="mt-1 text-xs text-gray-600">{status}</p>}
    </form>
  );
}

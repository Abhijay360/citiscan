"use client";

import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Place } from "@/lib/geo";
import type { StationPrediction } from "@/lib/types";
import { LABEL_COLORS, LABEL_RADIUS, LABEL_TEXT, NO_DATA_COLOR } from "./colors";

type Props = {
  stations: StationPrediction[];
  mode: "dock" | "bike";
  selectedId: string | null; // destination station
  alternativeIds: string[]; // backup stations, drawn with numbers
  origin: Place | null;
  destination: Place | null;
  reveal: boolean; // replays: color by what actually happened instead of the prediction
  focus: [number, number] | null; // fly here when it changes (a replay's area)
  onStationClick: (station: StationPrediction) => void;
  onMapClick: (lat: number, lon: number) => void;
};

// Leaflet touches `window` on import, so this component is loaded with next/dynamic and ssr: false.
export default function StationMap(props: Props) {
  const { stations, mode, selectedId, alternativeIds, origin, destination, reveal, focus } = props;
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const stationLayer = useRef<L.LayerGroup | null>(null);
  const tripLayer = useRef<L.LayerGroup | null>(null);
  const callbacks = useRef(props);

  useEffect(() => {
    callbacks.current = props;
  });

  useEffect(() => {
    // canvas rendering keeps 2,400 markers fast
    const m = L.map(container.current!, { preferCanvas: true, zoomControl: false }).setView([40.735, -73.985], 13);
    L.control.zoom({ position: "bottomright" }).addTo(m);
    // Standard OSM tiles (no API key), greyed out in globals.css so the station colours stand out
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19,
      className: "basemap",
    }).addTo(m);
    stationLayer.current = L.layerGroup().addTo(m);
    tripLayer.current = L.layerGroup().addTo(m);
    m.on("click", (e) => callbacks.current.onMapClick(e.latlng.lat, e.latlng.lng));
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const group = stationLayer.current;
    if (!group) return;
    group.clearLayers();
    for (const s of stations) {
      const selected = s.id === selectedId;
      const altIndex = alternativeIds.indexOf(s.id);
      const isDock = mode === "dock";
      const actual = isDock ? s.actualDocks : s.actualBikes;
      const shown =
        reveal && actual !== undefined ? (actual >= 1 ? "likely" : "unlikely") : isDock ? s.dockLabel : s.bikeLabel;
      const fill = reveal || s.hasHistory ? LABEL_COLORS[shown] : NO_DATA_COLOR;
      const tip =
        reveal && actual !== undefined
          ? `${s.name}: actually ${actual} ${isDock ? "open docks" : "bikes"}`
          : `${s.name}: ${LABEL_TEXT[shown]}, ${Math.round((isDock ? s.pDock : s.pBike) * 100)}% chance of ${isDock ? "a dock" : "a bike"}`;
      const marker = L.circleMarker([s.lat, s.lon], {
        radius: selected ? 10 : altIndex >= 0 ? 8 : LABEL_RADIUS[shown],
        color: selected || altIndex >= 0 ? "#111827" : "#ffffff",
        weight: selected ? 3 : altIndex >= 0 ? 2 : 1,
        fillColor: fill,
        fillOpacity: 0.9,
        bubblingMouseEvents: false, // a station click shouldn't also count as a map click
      }).on("click", () => callbacks.current.onStationClick(s));
      if (altIndex >= 0) {
        marker.bindTooltip(String(altIndex + 1), { permanent: true, direction: "right", className: "alt-label" });
      } else {
        marker.bindTooltip(tip);
      }
      marker.addTo(group);
    }
  }, [stations, mode, selectedId, alternativeIds, reveal]);

  const focusKey = focus ? focus.join(",") : null;
  useEffect(() => {
    const f = callbacks.current.focus;
    if (map.current && f) map.current.flyTo(f, 14, { duration: 0.8 });
  }, [focusKey]);

  useEffect(() => {
    const group = tripLayer.current;
    if (!group) return;
    group.clearLayers();
    if (origin) {
      // a hollow ring, so the start can't be mistaken for a station
      L.circleMarker([origin.lat, origin.lon], {
        radius: 7,
        color: "#111827",
        weight: 3,
        fillColor: "#ffffff",
        fillOpacity: 1,
      })
        .bindTooltip(`Start: ${origin.label}`)
        .addTo(group);
    }
    if (destination) {
      L.circleMarker([destination.lat, destination.lon], {
        radius: 4,
        color: "#111827",
        weight: 2,
        fillColor: "#111827",
        fillOpacity: 1,
      })
        .bindTooltip(`Destination: ${destination.label}`)
        .addTo(group);
    }
  }, [origin, destination]);

  // Zoom to the destination and its backups whenever a new destination is picked
  const destKey = destination ? `${destination.lat},${destination.lon}` : null;
  useEffect(() => {
    const m = map.current;
    if (!m || !destKey) return;
    const { destination: dest, stations: all, alternativeIds: alts } = callbacks.current;
    const points: L.LatLngTuple[] = [[dest!.lat, dest!.lon]];
    for (const s of all) if (alts.includes(s.id)) points.push([s.lat, s.lon]);
    const small = window.innerWidth < 768;
    m.flyToBounds(L.latLngBounds(points).pad(0.3), {
      maxZoom: 16,
      paddingTopLeft: small ? [20, 20] : [420, 40], // keep clear of the side panel
      paddingBottomRight: small ? [20, window.innerHeight * 0.55] : [40, 40], // ...or the bottom sheet
      duration: 0.8,
    });
  }, [destKey]);

  return <div ref={container} className="h-full w-full" />;
}

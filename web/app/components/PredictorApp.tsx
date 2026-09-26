"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SourceAccuracy } from "@/lib/accuracy";
import { findAlternatives } from "@/lib/alternatives";
import { bikeMinutes, distanceMeters, nearest, walkMinutes, type Place } from "@/lib/geo";
import { nextNycTime, type DayType } from "@/lib/time";
import type { Label, PredictResponse, ReplayInfo, StationPrediction } from "@/lib/types";
import AccuracyPanel from "./AccuracyPanel";
import DemoControls, { type Demo } from "./DemoControls";
import PlaceSearch from "./PlaceSearch";
import { LabelChip, formatTime, type Mode } from "./PredictionDetails";
import TripCard from "./TripCard";
import { LABEL_COLORS, NO_DATA_COLOR } from "./colors";

const StationMap = dynamic(() => import("./StationMap"), {
  ssr: false,
  loading: () => <div className="grid h-full place-items-center text-gray-500">Loading map…</div>,
});

const LEGEND: Record<Mode, Record<Label, string>> = {
  dock: { likely: "Dock likely (80%+)", maybe: "Maybe (50-80%)", unlikely: "Likely full" },
  bike: { likely: "Bike likely (80%+)", maybe: "Maybe (50-80%)", unlikely: "Likely empty" },
};

const dayTime = (iso: string) =>
  new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

export default function PredictorApp({ accuracy }: { accuracy: SourceAccuracy[] }) {
  const [mode, setMode] = useState<Mode>("dock");
  const [manualMinutes, setManualMinutes] = useState(15);
  const [data, setData] = useState<PredictResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [pickingOrigin, setPickingOrigin] = useState(false);
  const [bikeType, setBikeType] = useState<"ebike" | "classic">("ebike");
  const [searchKey, setSearchKey] = useState(0); // bump to clear the search box
  const [collapsed, setCollapsed] = useState(false); // on phones, hide the panel to see the map
  const [showAccuracy, setShowAccuracy] = useState(false);
  const closeAccuracy = useCallback(() => setShowAccuracy(false), []);

  // demo modes
  const [demo, setDemo] = useState<Demo>("live");
  const [whatIfDay, setWhatIfDay] = useState<DayType>("weekday");
  const [whatIfTime, setWhatIfTime] = useState("08:45");
  const [override, setOverride] = useState<{ id: string; docks: number } | null>(null);
  const [replays, setReplays] = useState<ReplayInfo[]>([]);
  const [replayId, setReplayId] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => {
    fetch("/api/replays")
      .then((r) => (r.ok ? r.json() : []))
      .then(setReplays)
      .catch(() => setReplays([]));
  }, []);

  const stations = useMemo(() => data?.stations ?? [], [data]);
  const destStation = useMemo(() => (destination ? nearest(stations, destination) : null), [stations, destination]);

  // With a start point, arrival time comes from distance and real riding (or walking) speed.
  const eta = useMemo(() => {
    if (demo === "replay" || !origin || !destStation || !data) return null;
    const meters = distanceMeters(origin, destStation);
    return mode === "dock" ? bikeMinutes(meters, data.speedKmh[bikeType]) : walkMinutes(meters);
  }, [demo, origin, destStation, data, mode, bikeType]);
  const minutes = eta === null ? manualMinutes : Math.min(60, Math.max(1, Math.round(eta)));

  const query = useMemo(() => {
    const params = new URLSearchParams({ minutes: String(minutes) });
    if (demo === "whatif") {
      params.set("now", nextNycTime(whatIfDay, whatIfTime).toISOString());
      if (override) params.set("override", `${override.id}:${override.docks}`);
    }
    if (demo === "replay" && replayId) params.set("replay", replayId);
    return params.toString();
  }, [minutes, demo, whatIfDay, whatIfTime, override, replayId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/predict?${query}`);
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `API returned ${res.status}`);
        const body: PredictResponse = await res.json();
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    }
    const debounce = setTimeout(load, 250); // wait for sliders to settle
    const refresh = demo === "replay" ? undefined : setInterval(load, 60_000); // live counts change every minute
    return () => {
      cancelled = true;
      clearTimeout(debounce);
      clearInterval(refresh);
    };
  }, [query, demo]);

  const destLabel = destStation && (mode === "dock" ? destStation.dockLabel : destStation.bikeLabel);
  const alternatives = useMemo(
    () =>
      destination && destStation && destLabel !== "likely"
        ? findAlternatives(stations, destination, destStation.id, mode)
        : [],
    [stations, destination, destStation, destLabel, mode],
  );
  const alternativeIds = useMemo(() => alternatives.map((a) => a.station.id), [alternatives]);

  const summary = useMemo(() => {
    const unlikely = (s: StationPrediction) => (mode === "dock" ? s.dockLabel : s.bikeLabel) === "unlikely";
    const emptyNow = (s: StationPrediction) => (mode === "dock" ? s.docks : s.bikes) === 0;
    return { later: stations.filter(unlikely).length, now: stations.filter(emptyNow).length };
  }, [stations, mode]);

  // Replay scorecard: of the stations that ran out by the arrival time, how many did we flag in advance?
  const scorecard = useMemo(() => {
    if (!data?.replay) return null;
    const isDock = mode === "dock";
    const count = (s: StationPrediction) => (isDock ? s.docks : s.bikes);
    const actual = (s: StationPrediction) => (isDock ? s.actualDocks : s.actualBikes) ?? 0;
    const ranOut = stations.filter((s) => count(s) >= 1 && actual(s) === 0);
    const flagged = ranOut.filter((s) => (isDock ? s.pDock : s.pBike) < 0.8);
    const likely = stations.filter((s) => (isDock ? s.dockLabel : s.bikeLabel) === "likely");
    const likelyRight = likely.filter((s) => actual(s) >= 1).length;
    return {
      ranOut: ranOut.length,
      flagged: flagged.length,
      likelyPct: likely.length ? Math.round((100 * likelyRight) / likely.length) : null,
    };
  }, [data, stations, mode]);

  function pickDestination(place: Place) {
    setDestination(place);
    setOverride(null);
  }

  function choose(place: Place) {
    if (pickingOrigin) {
      setOrigin(place);
      setPickingOrigin(false);
    } else {
      pickDestination(place);
    }
  }

  function changeDemo(d: Demo) {
    setDemo(d);
    setOverride(null);
    setReveal(false);
    if (d === "replay") {
      const first = replays.find((r) => r.id === replayId) ?? replays[0];
      if (first) chooseReplay(first.id);
    }
  }

  function chooseReplay(id: string) {
    const r = replays.find((x) => x.id === id);
    setReplayId(id);
    setDestination(null);
    setOrigin(null);
    setSearchKey((k) => k + 1);
    if (r) {
      setMode(r.mode);
      setManualMinutes(15);
    }
  }

  // "What if" shortcut: E 47 St & Park Ave with only a few open docks at weekday rush hour
  function tryScenario(name: string, docks: number) {
    const s = stations.find((x) => x.name === name);
    if (!s) return;
    setMode("dock");
    pickDestination({ lat: s.lat, lon: s.lon, label: s.name });
    setOverride({ id: s.id, docks });
  }

  function locateMe() {
    if (!navigator.geolocation) return setError("Location isn't available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (pos) => setOrigin({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "your location" }),
      () => setError("Couldn't get your location. Use “Pick on map” instead."),
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  const travelNote =
    eta !== null && origin
      ? `${minutes} min ${mode === "dock" ? `by ${bikeType === "ebike" ? "e-bike" : "classic bike"}` : "on foot"} from ${origin.label}`
      : `Arriving in ${data ? Math.round((new Date(data.at).getTime() - new Date(data.now).getTime()) / 60_000) : minutes} min`;
  const replay = data?.replay;
  const revealing = demo === "replay" && reveal && Boolean(replay);

  return (
    <div className="relative h-dvh w-full">
      <StationMap
        stations={stations}
        mode={mode}
        selectedId={destStation?.id ?? null}
        alternativeIds={alternativeIds}
        origin={origin}
        destination={destination}
        reveal={revealing}
        focus={demo === "replay" && replay ? replay.center : null}
        onStationClick={(s) => choose({ lat: s.lat, lon: s.lon, label: s.name })}
        onMapClick={(lat, lon) => choose({ lat, lon, label: pickingOrigin ? "your start pin" : "the dropped pin" })}
      />

      <aside className="absolute inset-x-2 bottom-2 z-[1100] max-h-[55dvh] overflow-y-auto rounded-2xl bg-white/95 p-4 shadow-xl backdrop-blur md:inset-x-auto md:bottom-auto md:left-4 md:top-4 md:max-h-[calc(100dvh-2rem)] md:w-96">
        <div className="flex items-center gap-2.5">
          <Image src="/citi-logo.png" alt="Citi logo" width={46} height={27} priority />
          <div className="flex-1">
            <h1 className="text-xl font-bold leading-none tracking-tight">
              <span className="text-[#255be3]">Citi</span>Scan
            </h1>
            <p className="mt-1 text-xs text-gray-600">Will there be a dock when you get there?</p>
          </div>
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 hover:text-gray-900"
          >
            {collapsed ? "Show" : "Hide"}
          </button>
        </div>

        {collapsed && destStation && data && (
          <div className="mt-2 flex items-center gap-2 text-sm">
            <LabelChip
              small
              label={mode === "dock" ? destStation.dockLabel : destStation.bikeLabel}
              hasHistory={destStation.hasHistory}
            />
            <span className="truncate">
              {destStation.name}: {Math.round((mode === "dock" ? destStation.pDock : destStation.pBike) * 100)}% at{" "}
              {formatTime(data.at)}
            </span>
          </div>
        )}

        {!collapsed && (
          <>
            <DemoControls
              demo={demo}
              setDemo={changeDemo}
              whatIfDay={whatIfDay}
              setWhatIfDay={setWhatIfDay}
              whatIfTime={whatIfTime}
              setWhatIfTime={setWhatIfTime}
              replays={replays}
              replayId={replayId}
              setReplayId={chooseReplay}
              reveal={reveal}
              setReveal={setReveal}
              onTryScenario={tryScenario}
            />

            <div className="mt-3 grid grid-cols-2 rounded-lg bg-gray-100 p-1 text-sm font-medium">
              {(["dock", "bike"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-md py-1.5 ${mode === m ? "bg-white shadow" : "text-gray-600"}`}
                >
                  {m === "dock" ? "I need a dock" : "I need a bike"}
                </button>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-2">
              <div className="flex-1">
                <PlaceSearch
                  // remount when the destination changes, so the box shows it however it was picked
                  key={`${searchKey}:${destination?.lat},${destination?.lon}`}
                  initialQuery={destination?.label.replace(/^the dropped pin$/, "Dropped pin") ?? ""}
                  stations={stations}
                  onPick={pickDestination}
                />
              </div>
              {destination && (
                <button
                  onClick={() => {
                    setDestination(null);
                    setSearchKey((k) => k + 1);
                  }}
                  className="text-xs text-gray-500 hover:text-gray-900"
                >
                  Clear
                </button>
              )}
            </div>

            {demo !== "replay" && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
                {origin ? (
                  <>
                    <span className="text-gray-700">
                      From <b>{origin.label}</b>
                    </span>
                    <button onClick={() => setOrigin(null)} className="text-xs text-gray-500 hover:text-gray-900">
                      Clear
                    </button>
                    {mode === "dock" && (
                      <select
                        value={bikeType}
                        onChange={(e) => setBikeType(e.target.value as "ebike" | "classic")}
                        className="ml-auto rounded-md border border-gray-300 px-1.5 py-0.5 text-xs"
                      >
                        <option value="ebike">E-bike ({data?.speedKmh.ebike} km/h)</option>
                        <option value="classic">Classic ({data?.speedKmh.classic} km/h)</option>
                      </select>
                    )}
                  </>
                ) : pickingOrigin ? (
                  <span className="text-blue-700">
                    Tap the map or a station to set your start.{" "}
                    <button onClick={() => setPickingOrigin(false)} className="text-xs text-gray-500 underline">
                      Cancel
                    </button>
                  </span>
                ) : (
                  <>
                    <span className="text-gray-500">Start:</span>
                    <button
                      onClick={locateMe}
                      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                    >
                      My location
                    </button>
                    <button
                      onClick={() => setPickingOrigin(true)}
                      className="rounded-md border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                    >
                      Pick on map
                    </button>
                  </>
                )}
              </div>
            )}

            {eta === null && (
              <label className="mt-3 block text-sm">
                <div className="flex justify-between">
                  <span>
                    Arriving in{" "}
                    <b>{demo === "replay" && data ? travelNote.replace("Arriving in ", "") : `${minutes} min`}</b>
                  </span>
                  <span className="text-gray-500">
                    {data && (demo === "live" ? formatTime(data.at) : dayTime(data.at))}
                  </span>
                </div>
                <input
                  type="range"
                  min={demo === "replay" ? 5 : 0}
                  max={demo === "replay" ? 30 : 60}
                  step={demo === "replay" ? 5 : 1}
                  value={manualMinutes}
                  onChange={(e) => setManualMinutes(Number(e.target.value))}
                  className="w-full accent-blue-600"
                />
              </label>
            )}

            {scorecard && replay && (
              <div className="mt-3 rounded-lg bg-violet-50 p-2.5 text-sm text-violet-950">
                <b>{scorecard.ranOut}</b> stations that had {mode === "dock" ? "open docks" : "bikes"} at{" "}
                {dayTime(replay.now)} were {mode === "dock" ? "full" : "empty"} by {formatTime(data!.at)}. We flagged{" "}
                <b>{scorecard.flagged}</b> of them ahead of time.
                {scorecard.likelyPct !== null && (
                  <>
                    {" "}
                    When we said <i>likely</i>, there really was {mode === "dock" ? "a dock" : "a bike"}{" "}
                    <b>{scorecard.likelyPct}%</b> of the time.
                  </>
                )}
              </div>
            )}

            {destination && destStation && data ? (
              <TripCard
                station={destStation}
                destination={destination}
                mode={mode}
                at={data.at}
                travelNote={travelNote}
                alternatives={alternatives}
                demo={demo}
                onOverride={(docks) => setOverride({ id: destStation.id, docks })}
              />
            ) : (
              <p className="mt-3 text-sm text-gray-500">
                {data || error
                  ? "Search for a destination, or tap a station or anywhere on the map."
                  : "Loading live Citi Bike data…"}
              </p>
            )}

            {data && !revealing && (
              <p className="mt-3 text-sm">
                <b>{summary.later}</b> stations likely {mode === "dock" ? "full" : "empty"} by {formatTime(data.at)} (
                {summary.now} {demo === "replay" ? "at the start" : "right now"})
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-700">
              {revealing ? (
                <>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: LABEL_COLORS.likely }} />
                    Actually had {mode === "dock" ? "a dock" : "a bike"}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: LABEL_COLORS.unlikely }} />
                    Actually {mode === "dock" ? "full" : "empty"}
                  </span>
                </>
              ) : (
                <>
                  {(["likely", "maybe", "unlikely"] as const).map((l) => (
                    <span key={l} className="flex items-center gap-1">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ background: LABEL_COLORS[l] }} />
                      {LEGEND[mode][l]}
                    </span>
                  ))}
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3 w-3 rounded-full" style={{ background: NO_DATA_COLOR }} />
                    No history
                  </span>
                </>
              )}
            </div>

            {accuracy.length > 0 && (
              <button
                onClick={() => setShowAccuracy(true)}
                className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-left hover:bg-gray-50"
              >
                <span className="text-sm font-medium">How accurate is this? →</span>
                <span className="block text-xs text-gray-500">
                  Tested on {Math.round(accuracy.reduce((n, a) => n + a.predictions, 0) / 1000)}K predictions against
                  real dock counts
                </span>
              </button>
            )}

            {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
            {data && (
              <p className="mt-3 text-xs text-gray-400">
                {demo === "replay" && replay
                  ? `Replaying counts logged at ${dayTime(replay.now)} (${replay.source}).`
                  : demo === "whatif"
                    ? `Flows for ${whatIfDay === "weekday" ? "a weekday" : `a ${whatIfDay}`} at ${formatTime(data.now)}, applied to live counts from ${formatTime(data.feedUpdated)}.`
                    : `Live counts from Citi Bike as of ${formatTime(data.feedUpdated)}.`}{" "}
                Predictions from 16M trips, Jun-Aug 2026.
              </p>
            )}
            <p className="mt-1 text-xs text-gray-400">
              Independent hackathon project, not affiliated with or endorsed by Citi, Citi Bike or Lyft.
            </p>
          </>
        )}
      </aside>

      {showAccuracy && <AccuracyPanel sources={accuracy} onClose={closeAccuracy} />}
    </div>
  );
}

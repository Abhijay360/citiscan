"""Pick real past moments for the app's replay mode and save them to web/data/replays.json.

A replay is a logged snapshot (the "now") plus the counts actually logged every 5 minutes for the next 30, so
the app can show its prediction next to what really happened. We pick the moments where the most stations
filled up (or emptied) within 15 minutes, i.e. the most interesting ones, and report our hit rate on them as-is.

Usage:
    python3 pipeline/make_replays.py
"""

import datetime as dt
import json

import numpy as np

import backtest as bt

OFFSETS = [0, 5, 10, 15, 20, 25, 30]  # minutes after the replay's "now"


def candidates(df, source, info_by_id, meta, mean, var, index):
    """Every start time with snapshots at all OFFSETS, with how many stations filled up / emptied in 15 min."""
    stations = sorted(set(df.station_id) & set(info_by_id))
    wide = {k: df.pivot(index="t", columns="station_id", values=k).reindex(columns=stations) for k in ("docks", "bikes", "ebikes")}
    times = wide["docks"].index.to_numpy()
    tolerance = 65  # our log occasionally misses a minute when the feed doesn't update
    rows = np.array([index[info_by_id[s]["short_name"]] for s in stations])
    out = []
    for t0 in times[np.r_[True, np.diff(times // 300) > 0]]:  # at most one start per 5 minutes
        idx = []
        for off in OFFSETS:
            j = int(np.argmin(np.abs(times - (t0 + off * 60))))
            if abs(times[j] - (t0 + off * 60)) > tolerance:
                break
            idx.append(j)
        if len(idx) < len(OFFSETS):
            continue
        docks = wide["docks"].iloc[idx].to_numpy()  # offsets x stations
        bikes = wide["bikes"].iloc[idx].to_numpy()
        ebikes = wide["ebikes"].iloc[idx].to_numpy()
        ok = ~np.isnan(docks).any(axis=0) & ~np.isnan(bikes).any(axis=0) & ~np.isnan(ebikes).any(axis=0)
        # Skip feed glitches: riders can't move 5% of an area's bikes in 5 minutes, but the feed sometimes
        # briefly drops bikes (Brooklyn, Sep 9 6:50pm: 27 stations at 0 bikes, back to 1 at 7:00).
        totals = np.nansum(bikes, axis=1)
        if np.max(np.abs(np.diff(totals)) / totals[:-1]) > 0.05:
            continue
        w = bt.window_weights(t0, t0 + 15 * 60, meta["bucket_minutes"])
        scale = meta["params"]["flow_scale"]
        m = sum(f * scale[day] * mean[rows, day, b] for day, b, f in w)
        sd = np.sqrt(sum(f * var[rows, day, b] for day, b, f in w) + bt.MIN_VARIANCE)
        p_dock = bt.norm_cdf((docks[0] - 0.5 - m) / sd)
        p_bike = bt.norm_cdf((bikes[0] - 0.5 + m) / sd)
        filled = ok & (docks[0] >= 1) & (docks[3] == 0)
        emptied = ok & (bikes[0] >= 1) & (bikes[3] == 0)
        out.append({
            "t0": int(t0), "source": source, "stations": [stations[i] for i in np.where(ok)[0]],
            "docks": docks[:, ok], "bikes": bikes[:, ok], "ebikes": ebikes[:, ok],
            "filled": int(filled.sum()), "filled_warned": int((filled & (p_dock < bt.LIKELY)).sum()),
            "emptied": int(emptied.sum()), "emptied_warned": int((emptied & (p_bike < bt.LIKELY)).sum()),
        })
    return out


def scenario(c, info_by_id, title, mode):
    lat = np.mean([info_by_id[s]["lat"] for s in c["stations"]])
    lon = np.mean([info_by_id[s]["lon"] for s in c["stations"]])
    return {
        "id": f"{c['source']}-{c['t0']}",
        "title": title,
        "mode": mode,  # which toggle to start in: "dock" or "bike"
        "source": "Brooklyn archive (github.com/smturzo/citibike-williamsburg)" if c["source"] == "brooklyn" else "our snapshot log",
        "now": dt.datetime.fromtimestamp(c["t0"], dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "offsets": OFFSETS,
        "center": [round(lat, 5), round(lon, 5)],
        "stats": {k: c[k] for k in ("filled", "filled_warned", "emptied", "emptied_warned")},
        # Station details travel with the replay, so replays work even when Citi Bike's live feed is down
        "stations": {
            s: {
                "shortName": info_by_id[s]["short_name"],
                "name": info_by_id[s]["name"],
                "lat": info_by_id[s]["lat"],
                "lon": info_by_id[s]["lon"],
                "capacity": info_by_id[s]["capacity"],
                "docks": c["docks"][:, i].astype(int).tolist(),
                "bikes": c["bikes"][:, i].astype(int).tolist(),
                "ebikes": c["ebikes"][:, i].astype(int).tolist(),
            }
            for i, s in enumerate(c["stations"])
        },
    }


def label_time(t0, area):
    local = dt.datetime.fromtimestamp(t0, bt.NYC)
    return f"{area}, {local:%a %b} {local.day}, {local:%-I:%M%p}".replace("AM", "am").replace("PM", "pm")


def main():
    info = json.loads(bt.STATION_INFO.read_text())["data"]["stations"]
    info_by_id = {s["station_id"]: s for s in info}
    short_names = sorted({s["short_name"] for s in info})
    index = {s: i for i, s in enumerate(short_names)}
    meta, mean, var, _, _ = bt.load_table(short_names)

    picks = []
    for source in ("brooklyn", "ours"):
        cands = candidates(bt.load_snapshots(source), source, info_by_id, meta, mean, var, index)
        weekday = [c for c in cands if dt.datetime.fromtimestamp(c["t0"], bt.NYC).weekday() < 5]
        print(f"\n{source}: {len(cands)} possible start times")
        for c in sorted(cands, key=lambda c: -c["filled"])[:5]:
            print(f"  {label_time(c['t0'], source):32s} filled up {c['filled']:3d} (warned {c['filled_warned']}), "
                  f"emptied {c['emptied']:3d} (warned {c['emptied_warned']})")
        if source == "brooklyn":
            best_dock = max(weekday, key=lambda c: c["filled"])
            mornings = [c for c in weekday if 6 <= dt.datetime.fromtimestamp(c["t0"], bt.NYC).hour < 10]
            best_bike = max(mornings or weekday, key=lambda c: c["emptied"])
            print(f"  weekday mornings: " + ", ".join(f"{label_time(c['t0'], '')[2:]} emptied {c['emptied']} (warned {c['emptied_warned']})"
                                                   for c in sorted(mornings, key=lambda c: -c["emptied"])[:4]))
            picks.append(scenario(best_dock, info_by_id, label_time(best_dock["t0"], "Williamsburg area"), "dock"))
            if best_bike["emptied"] >= 5 and best_bike["t0"] != best_dock["t0"]:  # only if something happens
                picks.append(scenario(best_bike, info_by_id, label_time(best_bike["t0"], "Williamsburg area"), "bike"))
        elif cands:
            best = max(cands, key=lambda c: c["filled"])
            picks.append(scenario(best, info_by_id, label_time(best["t0"], "All of NYC"), "dock"))

    out = bt.ROOT / "web" / "data" / "replays.json"
    out.write_text(json.dumps({"scenarios": picks}, separators=(",", ":")))
    for p in picks:
        print(f"picked: {p['title']} ({p['mode']}) {p['stats']}")
    print(f"wrote {out.relative_to(bt.ROOT)} ({out.stat().st_size / 1e3:.0f} KB)")


if __name__ == "__main__":
    main()

"""Build the expected-net-flow lookup table from historical Citi Bike trips.

For every station, day type (weekday / saturday / sunday) and 15-minute bucket of the day we store:
  mean  expected net inflow = bikes arriving minus bikes leaving, smoothed over neighbouring buckets
  var   day-to-day variance of that net inflow (drives the likely / maybe / unlikely label)

At runtime: predicted open docks = open docks now - FLOW_SCALE x expected net inflow until arrival (clamped),
where expected changes smaller than SHRINK_BIKES are treated as "no change".

Usage:
    python3 pipeline/build_flow_table.py                        # the 3 most recent months in data/raw
    python3 pipeline/build_flow_table.py --months 202509,202608 # only these months
    python3 pipeline/build_flow_table.py --recount              # re-read the zips instead of the cached counts

Output: web/data/flow_table.json
"""

import argparse
import datetime as dt
import json
import pathlib
import re
import ssl
import time
import urllib.request
import warnings
import zipfile

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "data" / "raw"
CACHE_DIR = ROOT / "data" / "processed"  # per-month trip counts, so adding a month doesn't recount the rest
OUT = ROOT / "web" / "data" / "flow_table.json"
STATION_INFO_URL = "https://gbfs.lyft.com/gbfs/2.3/bkn/en/station_information.json"

BUCKET_MIN = 15
BUCKETS = 24 * 60 // BUCKET_MIN  # 96 per day
DAY_TYPES = ["weekday", "saturday", "sunday"]  # 7 separate weekdays leave too few samples per bucket
HOLIDAYS = {"2025-09-01", "2026-06-19", "2026-07-03"}  # Labor Day, Juneteenth, July 4th (observed): dropped
SMOOTH = (0.25, 0.5, 0.25)  # blend each bucket with its neighbours; real flows change smoothly
CLIP_PCT = 5  # clip each bucket to its 5th-95th percentile across days: one-off events (Summer Streets,
              # group rides) otherwise dominate the variance. Made held-out 80% ranges cover 80-82%.
MIN_VARIANCE = 0.25  # same floor as web/lib/predict.ts
HOLDOUT_DAYS = 14
# Most station-slots are quiet; predicting "+0.3 bikes" there only adds error. Ignoring expected changes
# under half a bike beat both the raw average and "nothing changes" on held-out weeks. Used by the app too.
SHRINK_BIKES = 0.5
# Real dock counts move less than trip flows imply (trucks and valets rebalance, and summer weekends are busier
# than September ones). Fit on real September dock counts (backtest.py, Brooklyn Sep 1-15): weekday changes are
# ~0.8x the trip-flow prediction, weekend ~0.35x. Scored on Sep 16-25 and our own logs. Used by the app too.
FLOW_SCALE = {"weekday": 0.8, "saturday": 0.35, "sunday": 0.35}

TRIP_COLS = ["started_at", "ended_at", "start_station_id", "end_station_id", "rideable_type",
             "member_casual", "start_lat", "start_lng", "end_lat", "end_lng"]


def day_type(day):
    if day.strftime("%Y-%m-%d") in HOLIDAYS:
        return None
    return {5: "saturday", 6: "sunday"}.get(day.weekday(), "weekday")


def load_station_info():
    """Current stations from the live feed (falls back to the copy the snapshot logger saves)."""
    try:
        cafile = "/etc/ssl/cert.pem" if pathlib.Path("/etc/ssl/cert.pem").exists() else None
        req = urllib.request.Request(STATION_INFO_URL, headers={"User-Agent": "citiscan"})
        with urllib.request.urlopen(req, timeout=30, context=ssl.create_default_context(cafile=cafile)) as r:
            info = json.load(r)
    except Exception as e:
        print(f"live station_information failed ({e}); using data/snapshots copy")
        info = json.loads((ROOT / "data" / "snapshots" / "station_information.json").read_text())
    return info["data"]["stations"]


# ---------------------------------------------------------------- step 1: count trips per station/day/bucket

def add_events(chunk, station_col, time_col, counts, index, first_day):
    """Add one count per trip to counts[station, day, bucket] (arrivals use ended_at, departures started_at).
    Trips outside the month (e.g. a ride that started the evening before) are skipped."""
    s = chunk[station_col].map(index)
    t = pd.to_datetime(chunk[time_col], format="ISO8601")
    d = (t.dt.normalize() - first_day).dt.days
    ok = s.notna() & (d >= 0) & (d < counts.shape[1])
    b = t.dt.hour * (60 // BUCKET_MIN) + t.dt.minute // BUCKET_MIN
    np.add.at(counts, (s[ok].astype(int).to_numpy(), d[ok].to_numpy(), b[ok].to_numpy()), 1)


def sample_speeds(chunk, speeds, rng):
    """Straight-line km/h of member trips between two different stations (used for the ETA estimate)."""
    c = chunk.sample(frac=0.05, random_state=rng)
    minutes = (pd.to_datetime(c.ended_at, format="ISO8601") - pd.to_datetime(c.started_at, format="ISO8601")).dt.total_seconds() / 60
    lat1, lon1, lat2, lon2 = (np.radians(c[k].to_numpy(float)) for k in ["start_lat", "start_lng", "end_lat", "end_lng"])
    a = np.sin((lat2 - lat1) / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin((lon2 - lon1) / 2) ** 2
    km = 6371 * 2 * np.arcsin(np.sqrt(a))
    ok = ((c.member_casual == "member") & (c.start_station_id != c.end_station_id) & minutes.between(2, 60) & (km > 0.3)).to_numpy()
    for kind in speeds:
        m = ok & (c.rideable_type == kind).to_numpy()
        speeds[kind].extend((km[m] / (minutes.to_numpy()[m] / 60)).tolist())


def month_files():
    """{"202608": [NYC zip, Jersey City zip], ...} for every trip zip in data/raw."""
    files = {}
    for f in sorted(RAW_DIR.glob("*citibike-tripdata*.zip")):
        files.setdefault(re.search(r"(\d{6})-citibike", f.name)[1], []).append(f)
    return files


def count_month(month, files, stations):
    """Arrivals and departures per [station, day, bucket] for one month, cached in data/processed."""
    first_day = pd.Timestamp(f"{month[:4]}-{month[4:]}-01")
    days = pd.date_range(first_day, first_day + pd.offsets.MonthEnd(0))
    index = {s: i for i, s in enumerate(stations)}
    arrivals = np.zeros((len(stations), len(days), BUCKETS), np.int16)
    departures = np.zeros_like(arrivals)
    speeds = {"classic_bike": [], "electric_bike": []}
    rng = np.random.default_rng(0)
    for f in files:
        started = time.time()
        n = 0
        with zipfile.ZipFile(f) as z:
            for member in z.namelist():
                if not member.endswith(".csv") or member.startswith("__MACOSX"):
                    continue
                # station ids must stay strings: "5805.10" as a float would become 5805.1
                for chunk in pd.read_csv(z.open(member), usecols=TRIP_COLS, chunksize=500_000,
                                         dtype={"start_station_id": str, "end_station_id": str}):
                    add_events(chunk, "end_station_id", "ended_at", arrivals, index, first_day)
                    add_events(chunk, "start_station_id", "started_at", departures, index, first_day)
                    sample_speeds(chunk, speeds, rng)
                    n += len(chunk)
        print(f"  {f.name}: {n:,} trips ({time.time() - started:.0f}s)")
    medians = [float(np.median(speeds[k])) for k in ("classic_bike", "electric_bike")]
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE_DIR / f"counts_{month}.npz", arrivals=arrivals, departures=departures,
                        stations=np.array(stations), speed_kmh=np.array(medians))
    return arrivals, departures, days, medians


def load_counts(stations, months, recount):
    """Per-month counts (cached or freshly counted), joined along the day axis."""
    files = month_files()
    missing = [m for m in months if m not in files]
    if missing:
        raise SystemExit(f"no trip zips for {missing} in {RAW_DIR}; see README for download commands")
    parts = []
    for month in months:
        cache = CACHE_DIR / f"counts_{month}.npz"
        z = np.load(cache) if cache.exists() and not recount else None
        if z is not None and list(z["stations"]) == stations:
            first_day = pd.Timestamp(f"{month[:4]}-{month[4:]}-01")
            days = pd.date_range(first_day, periods=z["arrivals"].shape[1])
            parts.append((z["arrivals"], z["departures"], days, list(z["speed_kmh"])))
        else:
            print(f"counting {month} trips (reads each CSV straight out of its zip)...")
            parts.append(count_month(month, files[month], stations))
    arrivals = np.concatenate([p[0] for p in parts], axis=1)
    departures = np.concatenate([p[1] for p in parts], axis=1)
    days = pd.DatetimeIndex(np.concatenate([p[2] for p in parts]))
    classic, ebike = np.mean([p[3] for p in parts], axis=0)
    return arrivals, departures, days, {"classic_bike": round(float(classic), 1), "electric_bike": round(float(ebike), 1)}


# ---------------------------------------------------------------- step 2: average into a lookup table

def smooth(a):
    """Circular 3-tap smoothing along the last (bucket) axis."""
    return SMOOTH[0] * np.roll(a, 1, axis=-1) + SMOOTH[1] * a + SMOOTH[2] * np.roll(a, -1, axis=-1)


def active_days(arrivals, departures):
    """[station, day] True if the station had any trip that day. Zero trips all day means it wasn't there
    yet or was closed (e.g. Lafayette St & Astor Pl only shows up in August), so those days are skipped."""
    return (arrivals.sum(axis=2, dtype=np.int32) + departures.sum(axis=2, dtype=np.int32)) > 0


def build_table(arrivals, departures, days, use_day=None):
    """{day_type: (mean[station, bucket], var[station, bucket], n_days)} from the selected days."""
    net = arrivals.astype(np.float32) - departures
    active = active_days(arrivals, departures)
    types = np.array([day_type(d) for d in days])
    use_day = np.ones(len(days), bool) if use_day is None else use_day
    table = {}
    for t in DAY_TYPES:
        sel = (types == t) & use_day
        x, w = net[:, sel, :], active[:, sel, None]
        with np.errstate(all="ignore"), warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # stations with no active days
            lo, hi = np.nanpercentile(np.where(w, x, np.nan), [CLIP_PCT, 100 - CLIP_PCT], axis=1, keepdims=True)
        x = np.clip(x, np.nan_to_num(lo), np.nan_to_num(hi))
        n = w.sum(axis=1)
        mean = np.where(w, x, 0).sum(axis=1) / np.maximum(n, 1)
        var = np.where(w, (x - mean[:, None, :]) ** 2, 0).sum(axis=1) / np.maximum(n - 1, 1)
        table[t] = (smooth(mean), smooth(var), int(sel.sum()))
    return table


def swing(mean_row):
    """Largest rise or fall of the expected cumulative bike count over one day."""
    cum = np.cumsum(mean_row)
    return float(cum.max() - cum.min())


# ---------------------------------------------------------------- step 3: sanity check on held-out days

def window_sums(x, h):
    """Sum over every run of h consecutive buckets along the last axis."""
    c = np.concatenate([np.zeros(x.shape[:-1] + (1,), x.dtype), np.cumsum(x, axis=-1)], axis=-1)
    return c[..., h:] - c[..., :-h]


def shrink(expected):
    """Soft threshold: pull the expected change toward 0 by SHRINK_BIKES (small changes become 0)."""
    return np.sign(expected) * np.maximum(np.abs(expected) - SHRINK_BIKES, 0)


def holdout_check(arrivals, departures, days):
    """Train on all but the last two weeks, then compare against 'nothing changes' on those two weeks.

    This only checks trip flows. The real test against observed dock counts is backtest.py.
    """
    n = len(days)
    test = np.arange(n) >= n - HOLDOUT_DAYS
    table = build_table(arrivals, departures, days, ~test)
    net = arrivals.astype(np.float32) - departures
    active = active_days(arrivals, departures)
    busiest = np.argsort(-(arrivals.sum(axis=(1, 2)) + departures.sum(axis=(1, 2))))[: len(arrivals) // 10]
    rush = np.zeros(BUCKETS, bool)
    rush[7 * 4:10 * 4] = rush[16 * 4:19 * 4] = True
    day_buckets = np.zeros(BUCKETS, bool)
    day_buckets[6 * 4:22 * 4] = True

    print(f"\nheld-out check: train {days[0]:%b %d} - {days[n - HOLDOUT_DAYS - 1]:%b %d}, "
          f"test {days[n - HOLDOUT_DAYS]:%b %d} - {days[-1]:%b %d}")
    print("error = mean |actual net inflow - predicted| in bikes; naive always predicts 0 (count stays the same)")
    results = {}
    for h in (1, 2):
        rows = {"all stations, 6am-10pm": [[], []], "busiest 10%, weekday rush": [[], []]}
        covered = []
        for d in np.where(test)[0]:
            t = day_type(days[d])
            if t is None:
                continue
            actual = window_sums(net[:, d, :], h)
            expected = window_sums(table[t][0], h)
            model = shrink(expected)
            valid = active[:, d, None] & day_buckets[None, : BUCKETS - h + 1]
            rows["all stations, 6am-10pm"][0].append(np.abs(actual - model)[valid].mean())
            rows["all stations, 6am-10pm"][1].append(np.abs(actual)[valid].mean())
            # how often the actual change lands inside our 80% range (should be ~80% if the variance is right)
            sd = np.sqrt(window_sums(table[t][1], h) + MIN_VARIANCE)
            covered.append((np.abs(actual - expected) <= 1.2816 * sd)[valid].mean())
            if t == "weekday":
                r = valid[busiest] & rush[None, : BUCKETS - h + 1]
                rows["busiest 10%, weekday rush"][0].append(np.abs(actual - model)[busiest][r].mean())
                rows["busiest 10%, weekday rush"][1].append(np.abs(actual)[busiest][r].mean())
        for label, (m, b) in rows.items():
            m, b = float(np.mean(m)), float(np.mean(b))
            print(f"  {15 * h} min ahead, {label:26s} model {m:.2f}  naive {b:.2f}  -> {1 - m / b:+.0%}")
            results[f"{15 * h}min {label}"] = {"model_mae": round(m, 3), "naive_mae": round(b, 3)}
        print(f"  {15 * h} min ahead, actual change inside our 80% range: {np.mean(covered):.0%} of the time")
        results[f"{15 * h}min 80% range coverage"] = round(float(np.mean(covered)), 3)
    return results


# ---------------------------------------------------------------- step 4: write JSON for the web app

def compact(values):
    return [0 if abs(v) < 0.005 else round(float(v), 2) for v in values]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--months", help="comma-separated YYYYMM list (default: every month in data/raw)")
    parser.add_argument("--recount", action="store_true", help="re-read the trip zips instead of using the cache")
    parser.add_argument("--out", type=pathlib.Path, default=OUT, help="where to write the table")
    args = parser.parse_args()

    info = load_station_info()
    capacity = {s["short_name"]: s["capacity"] for s in info}
    stations = sorted(capacity)
    months = args.months.split(",") if args.months else sorted(month_files())[-3:]
    arrivals, departures, days, speed_kmh = load_counts(stations, months, args.recount)
    print(f"months: {', '.join(months)} ({len(days)} days)")

    table = build_table(arrivals, departures, days)
    holdout = holdout_check(arrivals, departures, days)

    active = active_days(arrivals, departures)
    n_days = {t: table[t][2] for t in DAY_TYPES}
    out_stations = {}
    for i, sid in enumerate(stations):
        trips = int(arrivals[i].sum()) + int(departures[i].sum())
        if trips == 0:
            continue  # no history (new or uninstalled): the app falls back to "no change", low confidence
        swings = [swing(table[t][0][i]) for t in DAY_TYPES]
        out_stations[sid] = {
            "mean": [compact(table[t][0][i]) for t in DAY_TYPES],
            "var": [compact(table[t][1][i]) for t in DAY_TYPES],
            "trips_per_day": round(trips / max(active[i].sum(), 1), 1),
            # flows bigger than the station could physically absorb => bikes get moved by trucks/valets
            "rebalanced": bool(capacity[sid] and max(swings) > capacity[sid]),
        }

    meta = {
        "built_at": dt.datetime.now().isoformat(timespec="seconds"),
        "months": months,
        "bucket_minutes": BUCKET_MIN,
        "day_types": DAY_TYPES,
        "days_used": n_days,
        "holidays_excluded": sorted(HOLIDAYS),
        "smoothing": SMOOTH,
        "speed_kmh": {"classic": speed_kmh["classic_bike"], "ebike": speed_kmh["electric_bike"]},
        "clip_percentiles": [CLIP_PCT, 100 - CLIP_PCT],
        "params": {"shrink_bikes": SHRINK_BIKES, "flow_scale": [FLOW_SCALE[t] for t in DAY_TYPES]},
        "holdout": holdout,
        "notes": "mean = expected net inflow (arrivals - departures) per 15-min bucket in NYC local time; "
                 "var = day-to-day variance of that net inflow. Keys are GBFS short_name.",
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"meta": meta, "stations": out_stations}, separators=(",", ":")))

    flagged = sum(s["rebalanced"] for s in out_stations.values())
    print(f"\nday types: {n_days}  (holidays dropped: {sorted(HOLIDAYS)})")
    print(f"straight-line riding speed: {meta['speed_kmh']} km/h")
    print(f"{len(out_stations)} stations with history ({flagged} flagged as rebalanced), "
          f"{len(stations) - len(out_stations)} without")
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()

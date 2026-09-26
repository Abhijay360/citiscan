"""Backtest: were our dock predictions right, and better than "the count stays the same"?

For every logged snapshot we predict open docks 5-30 minutes ahead with exactly the app's math
(web/lib/predict.ts), then compare with the dock count actually logged at that time.

Ground truth:
  ours        data/snapshots/*.csv.gz       every station, ~1/min, from snapshot_logger.py
  brooklyn    data/external/williamsburg/   195 Brooklyn stations, 5-min snapshots in 30-min bursts,
                                            Aug 26 - Sep 25 2026, incl. weekday rush hours
                                            (github.com/smturzo/citibike-williamsburg); we only use September,
                                            which is after our June-August training data

Baselines:
  current count   what the Citi Bike app shows: open docks now = open docks later
  spread only     our uncertainty, but no expected flow (isolates what the flow model adds)

Usage:
    python3 pipeline/backtest.py                            # prints the tables, writes web/data/backtest.json
    python3 pipeline/backtest.py --table other.json --out /tmp/bt.json   # try another flow table
"""

import argparse
import datetime as dt
import glob
import json
import math
import pathlib
from zoneinfo import ZoneInfo

import numpy as np
import pandas as pd

ROOT = pathlib.Path(__file__).resolve().parent.parent
TABLE = ROOT / "web" / "data" / "flow_table.json"
STATION_INFO = ROOT / "data" / "snapshots" / "station_information.json"
OUT = ROOT / "web" / "data" / "backtest.json"
NYC = ZoneInfo("America/New_York")

HORIZONS = [5, 10, 15, 20, 30]  # minutes ahead
MIN_VARIANCE = 0.25  # same as web/lib/predict.ts
OUR_STEP_SEC = 300  # start a prediction every 5 minutes of our 1-minute logs (keeps memory in check)
LIKELY, MAYBE = 0.8, 0.5  # label thresholds, same as the app


# ---------------------------------------------------------------- the app's math, in numpy

def window_weights(t0, t1, bucket_min):
    """[(day_type, bucket, fraction)] covered by [t0, t1) in NYC time; mirrors windowWeights() in predict.ts."""
    weights, t = [], float(t0)
    while t < t1:
        local = dt.datetime.fromtimestamp(t, NYC)
        minute = local.hour * 60 + local.minute + local.second / 60
        day_type = {5: 1, 6: 2}.get(local.weekday(), 0)
        bucket = int(minute // bucket_min) % (24 * 60 // bucket_min)
        step = min((bucket_min - minute % bucket_min) * 60, t1 - t)
        weights.append((day_type, bucket, step / (bucket_min * 60)))
        t += step
    return weights


def norm_cdf(z):
    return 0.5 * (1 + np.vectorize(math.erf)(z / math.sqrt(2)))


def predict(docks, bikes, returning, mean, var, shrink_bikes):
    """Vectorised predictStation(): predicted open docks and the chance of at least one."""
    change = np.sign(mean) * np.maximum(np.abs(mean) - shrink_bikes, 0)
    total = docks + bikes
    predicted = np.clip(docks - change, 0, total)
    sd = np.sqrt(var + MIN_VARIANCE)
    ok = returning & (total > 0)
    p_model = np.where(ok, norm_cdf((docks - 0.5 - mean) / sd), 0.0)
    p_spread = np.where(ok, norm_cdf((docks - 0.5) / sd), 0.0)  # same uncertainty, no flow
    return predicted, p_model, p_spread


# ---------------------------------------------------------------- data

def load_table(short_names, path=TABLE):
    t = json.loads(pathlib.Path(path).read_text())
    stations = t["stations"]
    has = np.array([s in stations for s in short_names])
    zeros = [[0.0] * 96] * 3
    mean = np.array([stations[s]["mean"] if s in stations else zeros for s in short_names], np.float32)
    var = np.array([stations[s]["var"] if s in stations else zeros for s in short_names], np.float32)
    trips = np.array([stations[s]["trips_per_day"] if s in stations else 0 for s in short_names])
    return t["meta"], mean, var, trips, has


def load_snapshots(source):
    """Long table: t (unix s), station_id, bikes, ebikes, docks, returning."""
    if source == "ours":
        files = sorted(glob.glob(str(ROOT / "data" / "snapshots" / "*.csv.gz")))
        df = pd.concat((pd.read_csv(f, usecols=["ts", "station_id", "bikes", "ebikes", "docks", "is_returning"]) for f in files),
                       ignore_index=True).rename(columns={"ts": "t"})
    else:
        files = sorted(glob.glob(str(ROOT / "data" / "external" / "williamsburg" / "2026-09-*.csv.gz")))
        df = pd.concat((pd.read_csv(f, usecols=["ts_bucket", "station_id", "bikes", "ebikes", "docks", "is_returning"]) for f in files),
                       ignore_index=True).rename(columns={"ts_bucket": "t"})
    df = df.drop_duplicates(["t", "station_id"])
    df["returning"] = df.pop("is_returning").astype(bool)
    return df


def build_pairs(df, source, short_by_id, meta, mean, var, trips, has, index):
    """One row per (start snapshot, station, horizon) with actual, naive and model predictions."""
    stations = sorted(set(df.station_id) & set(short_by_id))
    col = {s: i for i, s in enumerate(stations)}
    rows_idx = np.array([index[short_by_id[s]] for s in stations])
    wide = {k: df.pivot(index="t", columns="station_id", values=k).reindex(columns=stations) for k in ("docks", "bikes", "returning")}
    times = wide["docks"].index.to_numpy()
    tolerance = 45 if source == "ours" else 60
    starts = times
    if source == "ours":  # thin to one start every OUR_STEP_SEC
        starts = times[np.r_[True, np.diff(times // OUR_STEP_SEC) > 0]]

    out = []
    for t0 in starts:
        i0 = np.searchsorted(times, t0)
        d0, b0 = wide["docks"].iloc[i0].to_numpy(float), wide["bikes"].iloc[i0].to_numpy(float)
        ret0 = wide["returning"].iloc[i0].to_numpy()
        local = dt.datetime.fromtimestamp(t0, NYC)
        for h in HORIZONS:
            target = t0 + h * 60
            i1 = np.searchsorted(times, target)
            cands = [j for j in (i1 - 1, i1) if 0 <= j < len(times)]
            j = min(cands, key=lambda j: abs(times[j] - target))
            if abs(times[j] - target) > tolerance:
                continue
            d1 = wide["docks"].iloc[j].to_numpy(float)
            w = window_weights(t0, target, meta["bucket_minutes"])
            scale = meta["params"]["flow_scale"]
            m = sum(f * scale[day] * mean[rows_idx, day, b] for day, b, f in w)
            v = sum(f * var[rows_idx, day, b] for day, b, f in w)
            ok = ~np.isnan(d0) & ~np.isnan(d1) & ~np.isnan(b0)
            ret = np.where(ok, ret0, False).astype(bool)
            pred, p_model, p_spread = predict(np.nan_to_num(d0), np.nan_to_num(b0), ret, m, v, meta["params"]["shrink_bikes"])
            out.append(pd.DataFrame({
                "source": source, "horizon": h, "t0": t0, "station": np.array(stations)[ok],
                "hour": local.hour, "weekend": local.weekday() >= 5,
                "docks_now": d0[ok], "docks_later": d1[ok], "predicted": pred[ok], "expected_inflow": m[ok], "variance": v[ok],
                "p_model": p_model[ok], "p_spread": p_spread[ok], "returning": ret[ok],
                "trips_per_day": trips[rows_idx][ok], "has_history": has[rows_idx][ok],
            }))
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame()


# ---------------------------------------------------------------- metrics

def summarize(p):
    """Error in open docks (ours vs current count) and how often each label came true."""
    err_model = (p.predicted - p.docks_later).abs().mean()
    err_naive = (p.docks_now - p.docks_later).abs().mean()
    open_later = p.docks_later >= 1
    had_docks = (p.docks_now >= 1) & p.returning
    filled = had_docks & ~open_later  # had docks when you checked, full when you arrived
    labels = {}
    for name, lo, hi in (("likely", LIKELY, 1.01), ("maybe", MAYBE, LIKELY), ("unlikely", -0.01, MAYBE)):
        sel = p.returning & (p.p_model >= lo) & (p.p_model < hi)
        labels[name] = {"n": int(sel.sum()), "dock_open_rate": round(float(open_later[sel].mean()), 3) if sel.any() else None}
    brier = lambda q: float(((q - open_later) ** 2)[p.returning].mean())
    return {
        "n": int(len(p)),
        "mae_model": round(float(err_model), 3),
        "mae_current_count": round(float(err_naive), 3),
        "improvement": round(float(1 - err_model / err_naive), 3) if err_naive > 0 else None,
        "filled_up_cases": int(filled.sum()),
        "filled_up_warned": round(float((p.p_model < LIKELY)[filled].mean()), 3) if filled.any() else None,
        "filled_up_warned_spread_only": round(float((p.p_spread < LIKELY)[filled].mean()), 3) if filled.any() else None,
        "false_alarm_rate": round(float((p.p_model < MAYBE)[had_docks & open_later].mean()), 3) if (had_docks & open_later).any() else None,
        # a rider who trusts the view: how often is the station full when they get there?
        "full_on_arrival_if_count_shows_docks": round(float((~open_later)[had_docks].mean()), 4) if had_docks.any() else None,
        "full_on_arrival_if_we_say_likely": round(float((~open_later)[p.returning & (p.p_model >= LIKELY)].mean()), 4)
        if (p.returning & (p.p_model >= LIKELY)).any() else None,
        "labels": labels,
        "brier_model": round(brier(p.p_model), 4),
        "brier_spread_only": round(brier(p.p_spread), 4),
        "brier_current_count": round(brier((p.docks_now >= 1).astype(float)), 4),
    }


def subsets(p, busy_cutoff):
    rush = ~p.weekend & (p.hour.between(7, 9) | p.hour.between(16, 18))
    return {
        "all": p,
        "3 or fewer docks open now": p[p.docks_now <= 3],
        "busiest 10% of stations": p[p.trips_per_day >= busy_cutoff],
        "weekday rush hours": p[rush],
        "weekday rush, 3 or fewer docks": p[rush & (p.docks_now <= 3)],
    }


def fmt(x, pct=False):
    if x is None:
        return "   -"
    return f"{x:+.0%}" if pct else f"{x:.2f}"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--table", type=pathlib.Path, default=TABLE, help="flow table to test")
    parser.add_argument("--out", type=pathlib.Path, default=OUT, help="where to write the results JSON")
    args = parser.parse_args()

    info = json.loads(STATION_INFO.read_text())["data"]["stations"]
    short_by_id = {s["station_id"]: s["short_name"] for s in info}
    short_names = sorted(set(short_by_id.values()))
    index = {s: i for i, s in enumerate(short_names)}
    meta, mean, var, trips, has = load_table(short_names, args.table)
    busy_cutoff = np.percentile(trips[has], 90)

    results = {"generated": dt.datetime.now().isoformat(timespec="seconds"), "table_months": meta["months"], "sources": {}}
    for source in ("brooklyn", "ours"):
        df = load_snapshots(source)
        span = f"{dt.datetime.fromtimestamp(df.t.min(), NYC):%b %d %H:%M} - {dt.datetime.fromtimestamp(df.t.max(), NYC):%b %d %H:%M}"
        pairs = build_pairs(df, source, short_by_id, meta, mean, var, trips, has, index)
        if pairs.empty:
            print(f"\n{source}: not enough snapshots yet ({span})")
            continue
        print(f"\n=== {source}: {df.station_id.nunique()} stations, {df.t.nunique()} snapshots, {span} ===")
        print(f"{'':32s}{'horizon':>8s}{'n':>9s}{'ours':>7s}{'count':>7s}{'better':>8s}   when 'likely'/'maybe'/'unlikely', a dock was open")
        results["sources"][source] = {"span": span, "stations": int(df.station_id.nunique()), "by_subset": {}}
        for name, sub in subsets(pairs, busy_cutoff).items():
            results["sources"][source]["by_subset"][name] = {}
            for h in HORIZONS:
                s = sub[sub.horizon == h]
                if len(s) < 50:
                    continue
                m = summarize(s)
                results["sources"][source]["by_subset"][name][str(h)] = m
                if h in (10, 15, 20, 30):
                    rates = " / ".join(fmt(m["labels"][k]["dock_open_rate"]) if m["labels"][k]["dock_open_rate"] is not None else "-"
                                       for k in ("likely", "maybe", "unlikely"))
                    print(f"{name:32s}{h:>6d}m{m['n']:>9,d}{m['mae_model']:>7.2f}{m['mae_current_count']:>7.2f}"
                          f"{fmt(m['improvement'], True):>8s}   {rates}")
        allh = pairs[pairs.horizon == 15]
        m = summarize(allh)
        if m["filled_up_cases"]:
            print(f"15 min: {m['filled_up_cases']} times a station with open docks was full 15 min later; we warned "
                  f"(maybe/unlikely) {m['filled_up_warned']:.0%} of those (spread-only baseline {m['filled_up_warned_spread_only']:.0%}, "
                  f"current count 0%). False alarms ('unlikely' but a dock was open): {m['false_alarm_rate']:.1%}")
        print(f"15 min: count showed open docks but station was full on arrival {m['full_on_arrival_if_count_shows_docks']:.1%}; "
              f"we said 'likely' but it was full {m['full_on_arrival_if_we_say_likely']:.1%}")
        print(f"15 min Brier score for 'is a dock open' (lower is better): ours {m['brier_model']:.4f}, "
              f"spread only {m['brier_spread_only']:.4f}, current count {m['brier_current_count']:.4f}")

    args.out.write_text(json.dumps(results, indent=1))
    print(f"\nwrote {args.out}")


if __name__ == "__main__":
    main()

"""Poll Citi Bike's live station_status feed every 30s and log every snapshot.

Output: data/snapshots/YYYY-MM-DD.csv.gz (one row per installed station per feed update, ~1/min)
        data/snapshots/station_information.json (station names, coords, capacity)

These logs are the ground truth for backtest.py. Standard library only, so it runs anywhere:

    python3 pipeline/snapshot_logger.py

Leave it running (on macOS, `caffeinate -i python3 pipeline/snapshot_logger.py` keeps the laptop awake).
"""

import csv
import datetime
import gzip
import io
import json
import pathlib
import ssl
import time
import urllib.request
from zoneinfo import ZoneInfo

FEED = "https://gbfs.lyft.com/gbfs/2.3/bkn/en"
OUT_DIR = pathlib.Path(__file__).resolve().parent.parent / "data" / "snapshots"
NYC = ZoneInfo("America/New_York")
# python.org builds on macOS ship without CA certs; fall back to the system bundle.
SSL_CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem") if pathlib.Path("/etc/ssl/cert.pem").exists() else None
FIELDS = ["ts", "station_id", "bikes", "ebikes", "docks", "bikes_disabled", "docks_disabled",
          "is_renting", "is_returning", "last_reported"]


def fetch(name):
    req = urllib.request.Request(f"{FEED}/{name}.json", headers={"User-Agent": "citiscan"})
    with urllib.request.urlopen(req, timeout=30, context=SSL_CTX) as resp:
        return json.load(resp)


def save_station_information():
    info = fetch("station_information")
    (OUT_DIR / "station_information.json").write_text(json.dumps(info))


def log_snapshot(status):
    ts = status["last_updated"]
    buf = io.StringIO()
    writer = csv.writer(buf)
    count = 0
    for s in status["data"]["stations"]:
        if not s.get("is_installed"):
            continue
        writer.writerow([ts, s["station_id"], s["num_bikes_available"], s.get("num_ebikes_available", 0),
                         s["num_docks_available"], s.get("num_bikes_disabled", 0), s.get("num_docks_disabled", 0),
                         s["is_renting"], s["is_returning"], s["last_reported"]])
        count += 1

    day = datetime.datetime.fromtimestamp(ts, NYC).strftime("%Y-%m-%d")
    path = OUT_DIR / f"{day}.csv.gz"
    is_new = not path.exists()
    # Each append adds a new gzip member; gzip/pandas read multi-member files transparently.
    with gzip.open(path, "at", newline="") as f:
        if is_new:
            f.write(",".join(FIELDS) + "\n")
        f.write(buf.getvalue())
    return path, count


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    save_station_information()
    last_ts = None
    info_saved_on = datetime.date.today()
    while True:
        try:
            status = fetch("station_status")
            if status["last_updated"] != last_ts:
                path, count = log_snapshot(status)
                last_ts = status["last_updated"]
                stamp = datetime.datetime.fromtimestamp(last_ts, NYC).strftime("%H:%M:%S")
                print(f"{stamp}  logged {count} stations -> {path.name}", flush=True)
            if datetime.date.today() != info_saved_on:
                save_station_information()
                info_saved_on = datetime.date.today()
        except Exception as e:  # network blips shouldn't kill an overnight run
            print(f"error: {e}", flush=True)
        time.sleep(30 - time.time() % 30)  # poll every 30s; the CDN sometimes serves a stale copy for a minute


if __name__ == "__main__":
    main()

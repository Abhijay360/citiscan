// The preview card shown when the link is shared (Devpost, Slack, iMessage...). Generated at build time.

import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { summarizeBacktest, type BacktestFile } from "@/lib/accuracy";

export const alt = "CitiScan: will there be a Citi Bike dock when you get there?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const logo = `data:image/png;base64,${await readFile(join(process.cwd(), "public", "citi-logo.png"), "base64")}`;
const backtest: BacktestFile = JSON.parse(await readFile(join(process.cwd(), "data", "backtest.json"), "utf8"));
const brooklyn = summarizeBacktest(backtest).find((s) => s.key === "brooklyn");
const fewer = brooklyn ? Math.round(100 * (1 - brooklyn.fullIfLikely / brooklyn.fullIfCount)) : null;

export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: 80,
        background: "#ffffff",
        color: "#111827",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <img src={logo} width={163} height={96} alt="" />
        <div style={{ display: "flex", fontSize: 96, fontWeight: 700, letterSpacing: -2 }}>
          <span style={{ color: "#255be3" }}>Citi</span>
          <span>Scan</span>
        </div>
      </div>
      <div style={{ marginTop: 44, fontSize: 52, fontWeight: 600 }}>Will there be a dock when you get there?</div>
      <div style={{ marginTop: 20, fontSize: 32, color: "#4b5563" }}>
        {`Predicts open Citi Bike docks at your arrival time, not just right now.${
          fewer ? ` ${fewer}% fewer surprise full stations in testing.` : ""
        }`}
      </div>
    </div>,
    size,
  );
}

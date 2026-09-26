import { readFile } from "node:fs/promises";
import path from "node:path";
import { summarizeBacktest, type BacktestFile } from "@/lib/accuracy";
import PredictorApp from "./components/PredictorApp";

export default async function Home() {
  // Backtest results (pipeline/backtest.py) are read when the page is built and baked into it.
  const backtest: BacktestFile = JSON.parse(await readFile(path.join(process.cwd(), "data", "backtest.json"), "utf8"));
  return <PredictorApp accuracy={summarizeBacktest(backtest)} />;
}

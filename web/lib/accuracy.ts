// Turns pipeline/backtest.py's output (data/backtest.json) into the numbers the "How accurate is this?" panel shows.
// All numbers are for arriving 15 minutes after the snapshot.

import type { Label } from "./types";

type LabelStats = { n: number; dock_open_rate: number | null };
type HorizonStats = {
  n: number;
  filled_up_cases: number;
  filled_up_warned: number | null;
  false_alarm_rate: number | null;
  full_on_arrival_if_count_shows_docks: number | null;
  full_on_arrival_if_we_say_likely: number | null;
  labels: Record<Label, LabelStats>;
  brier_model: number;
  brier_current_count: number;
};
export type BacktestFile = {
  generated: string;
  sources: Record<string, { span: string; stations: number; by_subset: Record<string, Record<string, HorizonStats>> }>;
};

export type SourceAccuracy = {
  key: string;
  title: string;
  detail: string;
  predictions: number;
  fullIfCount: number; // share of arrivals to a full station when the current count showed open docks
  fullIfLikely: number; // ...when CitiScan said "likely"
  filledCases: number; // stations with open docks that were full 15 minutes later
  filledWarned: number; // share of those CitiScan labeled maybe/unlikely beforehand
  falseAlarm: number; // share of "unlikely" calls where a dock was open after all
  labels: { label: Label; promised: string; open: number; n: number }[];
  brierModel: number;
  brierCount: number;
};

const PROMISED: Record<Label, string> = { likely: "80%+", maybe: "50-80%", unlikely: "under 50%" };
const NAMES: Record<string, [string, string]> = {
  brooklyn: ["Brooklyn, September", "195 stations, Sep 1-25 2026, weekdays and weekends (public archive)"],
  ours: ["All of NYC, our log", "2,442 stations, logged every minute from Sat Sep 26 2026"],
};

export function summarizeBacktest(file: BacktestFile, horizon = "15"): SourceAccuracy[] {
  return Object.entries(file.sources)
    .filter(([, src]) => src.by_subset.all?.[horizon])
    .map(([key, src]) => {
      const m = src.by_subset.all[horizon];
      return {
        key,
        title: NAMES[key]?.[0] ?? key,
        detail: NAMES[key]?.[1] ?? src.span,
        predictions: m.n,
        fullIfCount: m.full_on_arrival_if_count_shows_docks ?? 0,
        fullIfLikely: m.full_on_arrival_if_we_say_likely ?? 0,
        filledCases: m.filled_up_cases,
        filledWarned: m.filled_up_warned ?? 0,
        falseAlarm: m.false_alarm_rate ?? 0,
        labels: (["likely", "maybe", "unlikely"] as const).map((label) => ({
          label,
          promised: PROMISED[label],
          open: m.labels[label].dock_open_rate ?? 0,
          n: m.labels[label].n,
        })),
        brierModel: m.brier_model,
        brierCount: m.brier_current_count,
      };
    });
}

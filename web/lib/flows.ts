import { readFile } from "node:fs/promises";
import path from "node:path";
import type { FlowTable } from "./predict";

// Built offline by pipeline/build_flow_table.py. Not imported as a module: TypeScript would try to type 7 MB
// of JSON. next.config.ts ships the file with the API functions.
let table: Promise<FlowTable> | null = null;

function read(): Promise<FlowTable> {
  return readFile(path.join(process.cwd(), "data", "flow_table.json"), "utf8").then(JSON.parse);
}

export function loadFlowTable(): Promise<FlowTable> {
  if (process.env.NODE_ENV !== "production") return read(); // pick up pipeline rebuilds without a restart
  table ??= read();
  return table;
}

import { readFileSync } from "node:fs";
import {
  createRepairTelemetryReport,
  formatRepairTelemetryReport
} from "./repairReport.js";
import type { TelemetryEvent } from "./types.js";

const telemetryPath = process.argv[2] ?? process.env.TELEMETRY_EVENTS_PATH;
const events: TelemetryEvent[] = telemetryPath
  ? (JSON.parse(readFileSync(telemetryPath, "utf8")) as TelemetryEvent[])
  : [];

console.log(formatRepairTelemetryReport(createRepairTelemetryReport(events)));

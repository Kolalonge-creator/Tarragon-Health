import { getConnectionKind } from "./connection-kind";
import { shouldHoldForWifi, type ConnectionKind } from "./data-cost-rules";
import { loadDataCostConfig } from "./data-cost-config";
import { loadMedicineRules } from "./medicines-config";
import { lagosTimeToUtcMs } from "./lagos-date";
import { readWifiOnly } from "./wifi-only";
import { recordSyncError } from "./sync-diagnostics";
import type { OutboxKind } from "./outbox-rules";

/**
 * The one place that decides, for one outbox row, whether Wi-Fi only holds it right now (S06z). The flush and the sync
 * banner both ask here, so what the banner says is waiting for Wi-Fi is exactly what the flush leaves behind.
 */
export interface HoldContext {
  wifiOnly: boolean;
  connection: ConnectionKind;
  maxHoldMs: number;
  serverMissedMs: number;
}

/** What the rule needs from a row. `payload` is read defensively: a payload we do not recognise is treated as urgent. */
export interface HoldableRow {
  kind: OutboxKind;
  danger: boolean;
  createdAt: string;
  payload: unknown;
}

/**
 * Reads the choice, the connection and the configured values once. Never throws. A value that cannot be read errs toward
 * SENDING: an unreadable choice is off, an unreadable cap is zero (nothing held), an unreadable missed window is zero (a
 * scheduled dose is never held).
 */
export async function loadHoldContext(): Promise<HoldContext> {
  const wifiOnly = await readWifiOnly();
  const connection = wifiOnly ? await getConnectionKind() : "unknown";
  let maxHoldMs = 0;
  try {
    maxHoldMs = loadDataCostConfig().maxHoldMs;
  } catch (error) {
    recordSyncError("offline_outbox", "dataCostConfig", error);
  }
  let serverMissedMs = 0;
  try {
    serverMissedMs = loadMedicineRules().serverMissedAfterMinutes * 60_000;
  } catch (error) {
    recordSyncError("offline_outbox", "medicineRulesConfig", error);
  }
  return { wifiOnly, connection, maxHoldMs, serverMissedMs };
}

function field(payload: unknown, name: string): unknown {
  return typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>)[name] : undefined;
}

export function isHeldForWifi(row: HoldableRow, ctx: HoldContext, nowMs: number, forced = false): boolean {
  const vitalType = row.kind === "vital" && typeof field(row.payload, "vital_type") === "string" ? (field(row.payload, "vital_type") as string) : null;
  let dueMs: number | null = null;
  if (row.kind === "dose") {
    const date = field(row.payload, "scheduled_for_date");
    const time = field(row.payload, "scheduled_time");
    if (typeof date === "string" && typeof time === "string") {
      try {
        dueMs = lagosTimeToUtcMs(date, time);
      } catch {
        dueMs = null;
      }
    }
  }
  // A scheduled dose whose due time cannot be worked out is never held: the missed-dose rule could not be honoured.
  if (row.kind === "dose" && typeof field(row.payload, "scheduled_time") === "string" && dueMs === null) return false;
  return shouldHoldForWifi({
    wifiOnly: ctx.wifiOnly,
    connection: ctx.connection,
    entry: { kind: row.kind, danger: row.danger, vitalType, createdAtMs: Date.parse(row.createdAt), dueMs },
    nowMs,
    maxHoldMs: ctx.maxHoldMs,
    serverMissedMs: ctx.serverMissedMs,
    forced,
  });
}

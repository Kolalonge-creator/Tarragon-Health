import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");

describe("finance.reconciliation mirrors the money_reconciliation_alert_config seed", () => {
  it("carries the same two windows as the migration seed", () => {
    const sql = readFileSync(join(ROOT, "supabase", "migrations", "20261021113500_money_reconciliation_daily_alert.sql"), "utf8");
    const match = /money-reconciliation-alert-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("money-reconciliation-alert seed not found");
    const seed = JSON.parse(match[1]) as { unsent_refund_minutes: number; grace_minutes: number };
    const v = getProposedConfig("finance.reconciliation").value as { unsent_refund_minutes: number; grace_minutes: number };
    expect(seed).toEqual({ unsent_refund_minutes: v.unsent_refund_minutes, grace_minutes: v.grace_minutes });
  });
});

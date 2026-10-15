import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const MIGRATIONS = join(ROOT, "supabase", "migrations");

function seed(suffix: string, marker: string): unknown {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ${suffix} not found`);
  const match = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  if (!match?.[1]) throw new Error(`${marker} seed not found in ${file}`);
  return JSON.parse(match[1]);
}

describe("providers.layer mirrors the provider_layer_config seed", () => {
  it("is identical to the migration seed", () => {
    expect(seed("_s14x_provider_inbox_reconciliation_health.sql", "providers-layer-rules")).toEqual(getProposedConfig("providers.layer").value);
  });
  it("keeps the breaker and the inbox sane", () => {
    const v = getProposedConfig("providers.layer").value as { inbox: { maxAttempts: number; leaseSeconds: number; backoffBaseSeconds: number; backoffMaxSeconds: number }; circuit: { failureThreshold: number; openSeconds: number }; reconciliation: { ageingBucketsHours: number[] } };
    expect(v.circuit.failureThreshold).toBeGreaterThanOrEqual(3);
    expect(v.circuit.openSeconds).toBeGreaterThanOrEqual(30);
    expect(v.inbox.maxAttempts).toBeGreaterThanOrEqual(3);
    expect(v.inbox.backoffMaxSeconds).toBeGreaterThanOrEqual(v.inbox.backoffBaseSeconds);
    expect([...v.reconciliation.ageingBucketsHours].sort((a, b) => a - b)).toEqual(v.reconciliation.ageingBucketsHours);
  });
});

describe("payouts.controls mirrors the payout_controls_config seed", () => {
  it("is identical to the migration seed", () => {
    expect(seed("_s31x_payout_reversal_gl_and_batch_controls.sql", "payouts-controls")).toEqual(getProposedConfig("payouts.controls").value);
  });
  it("is whole kobo, with a batch able to hold at least one maximum payout and a clinician limit no below one payout", () => {
    const v = getProposedConfig("payouts.controls").value as { perPayoutMaxKobo: number; perClinicianRolling7DaysMaxKobo: number; perBatchMaxKobo: number; perBatchMaxCount: number };
    for (const n of Object.values(v)) expect(Number.isInteger(n) && n > 0).toBe(true);
    expect(v.perBatchMaxKobo).toBeGreaterThanOrEqual(v.perPayoutMaxKobo);
    expect(v.perClinicianRolling7DaysMaxKobo).toBeGreaterThanOrEqual(v.perPayoutMaxKobo);
  });
});

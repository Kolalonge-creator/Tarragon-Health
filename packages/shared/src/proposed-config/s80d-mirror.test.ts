import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig, PROPOSED_CONFIG } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");

type Monitoring = { sample_rate: number; always_sample: string[]; cost_spike: { factor: number; min_tokens: number } };
type Sla = {
  first_response_minutes: Record<"critical" | "high" | "normal" | "low", number>;
  resolution_hours: Record<"critical" | "high" | "normal" | "low", number>;
  clinical_first_response_minutes: number;
  warn_fraction: number;
};

describe("ai.monitoring_rules mirrors the migration seed (S80d)", () => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s80d_ai_monitoring_scheduler_and_risk_weighted_sampling.sql"));
  if (!file) throw new Error("S80d AI monitoring migration not found");
  const sql = readFileSync(join(MIGRATIONS, file), "utf8");
  const cfg = getProposedConfig<Monitoring>("ai.monitoring_rules");

  it("is identical to the ai_monitoring_config v1 seed", () => {
    const match = /ai-monitoring-v1-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql);
    if (!match?.[1]) throw new Error("monitoring seed not found in the migration");
    expect(JSON.parse(match[1])).toEqual(cfg.value);
  });

  it("uses the same sample rate as ai.review_sample_rate (one rate, not two)", () => {
    expect(cfg.value.sample_rate).toBe(getProposedConfig<number>("ai.review_sample_rate").value);
  });

  it("is PROPOSED and owned by the CMO, never signed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "ai.monitoring_rules");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("CMO");
  });

  it("the migration seeds it unsigned and inactive and nothing in the seed signs", () => {
    expect(sql).toMatch(/values \(1, false, '2026-10-27'/);
    const seedPart = sql.slice(sql.indexOf("ai-monitoring-v1-begin"), sql.indexOf("ai-monitoring-v1-end"));
    expect(seedPart).not.toMatch(/approved_at|is_active\s*=\s*true/);
  });

  it("every always-sampled group the config names has a rule in the draw", () => {
    for (const g of cfg.value.always_sample) {
      const key = g === "emergency_touching" ? "'emergency_touching'" : g === "patient_reported" ? "'patient_reported'" : "'cost_spike'";
      expect(sql).toContain(`v_always ? ${key}`);
    }
  });

  it("loads no model price anywhere in the migration (finance enters prices)", () => {
    expect(sql).not.toMatch(/insert into public\.ai_model_prices/i);
  });
});

describe("support.sla_targets (S80d)", () => {
  const cfg = getProposedConfig<Sla>("support.sla_targets");

  it("is PROPOSED and owned by the founder, never confirmed in code", () => {
    const e = PROPOSED_CONFIG.find((x) => x.key === "support.sla_targets");
    expect(e?.status).toBe("proposed");
    expect(e?.owner).toBe("Founder");
  });

  it("gets tighter as priority rises, and a clinical ticket is never slower than a high one", () => {
    const f = cfg.value.first_response_minutes;
    expect(f.critical).toBeLessThan(f.high);
    expect(f.high).toBeLessThan(f.normal);
    expect(f.normal).toBeLessThan(f.low);
    const r = cfg.value.resolution_hours;
    expect(r.critical).toBeLessThan(r.high);
    expect(r.high).toBeLessThan(r.normal);
    expect(r.normal).toBeLessThan(r.low);
    expect(cfg.value.clinical_first_response_minutes).toBeLessThanOrEqual(f.high);
    expect(cfg.value.warn_fraction).toBeGreaterThan(0);
    expect(cfg.value.warn_fraction).toBeLessThan(1);
  });
});

import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { getProposedConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const sql = (suffix: string): string => {
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith(suffix));
  if (!file) throw new Error(`migration ${suffix} not found`);
  return readFileSync(join(MIGRATIONS, file), "utf8");
};

describe("symptom.diagnosis_urgency_map mirrors the migration seed (S59d)", () => {
  it("is identical to symptom_diagnosis_urgency_maps version 1", () => {
    const m = /urgency-map-begin[\s\S]*?\$json\$([\s\S]*?)\$json\$/.exec(sql("_s59d_encounter_outcome_audit_feed.sql"));
    if (!m?.[1]) throw new Error("urgency map seed not found");
    expect(JSON.parse(m[1])).toEqual(getProposedConfig("symptom.diagnosis_urgency_map").value);
  });

  it("is proposed and owned by the CMO, uses only the four categories, and has no prefix twice", () => {
    const cfg = getProposedConfig("symptom.diagnosis_urgency_map");
    expect(cfg.owner).toBe("CMO");
    expect(cfg.status).toBe("proposed");
    const entries = (cfg.value as { entries: Array<{ prefix: string; category: string }> }).entries;
    expect(entries.length).toBeGreaterThan(10);
    const prefixes = entries.map((e) => e.prefix);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    for (const e of entries) {
      expect(e.prefix).toMatch(/^[A-TV-Z][0-9][0-9AB][0-9A-Z]{0,4}$/);
      expect(["emergency", "urgent", "routine", "self_management"]).toContain(e.category);
    }
  });

  it("the migration seeds the map INACTIVE and unconfirmed, and nothing in S59d confirms it", () => {
    const text = sql("_s59d_encounter_outcome_audit_feed.sql");
    expect(text).toMatch(/\$json\$::jsonb, '[^']*not signed, not active[^']*', false\);/);
    const code = text.replace(/--[^\n]*/g, "");
    expect(code).not.toMatch(/perform\s+public\.confirm_symptom_diagnosis_urgency_map/i);
    expect(code).not.toMatch(/select\s+public\.confirm_symptom_diagnosis_urgency_map/i);
    expect(code).not.toMatch(/is_active\s*=\s*true[^;]*where\s+version\s*=\s*1\b/i);
  });
});

describe("symptom.risk_tightening and symptom.context_tightening version 3 (S59d) stay drafts", () => {
  it("every entry of the latest version is an unsigned draft with no sign-off", () => {
    for (const key of ["symptom.risk_tightening", "symptom.context_tightening"]) {
      const cfg = getProposedConfig(key);
      expect(cfg.version).toBe(3);
      const entries = (cfg.value as { entries: Array<{ status: string; clinical_sign_off: unknown }> }).entries;
      expect(entries.length).toBeGreaterThan(3);
      for (const e of entries) {
        expect(e.status).toBe("draft");
        expect(e.clinical_sign_off).toBeNull();
      }
    }
  });
});

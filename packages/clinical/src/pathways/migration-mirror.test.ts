import { describe, expect, it } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ASTHMA_COPD_V1, CKD_V1, DIABETES_CARE_V1, HEART_FAILURE_V1, HTN_RTSL_NG_DRAFT, PATHWAY_DEFINITIONS, loadCadenceConfig } from "./index";

const MIGRATIONS = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "supabase", "migrations");
const FILE = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s61_s62_pathway_engine.sql")) as string;
const SQL = readFileSync(join(MIGRATIONS, FILE), "utf8");

function seed(marker: string): unknown {
  const m = new RegExp(`${marker}-begin[\\s\\S]*?\\$json\\$([\\s\\S]*?)\\$json\\$`).exec(SQL);
  if (!m?.[1]) throw new Error(`${marker} seed not found`);
  return JSON.parse(m[1]);
}

describe("the S61/S62 migration seeds are identical to the code (a number is never typed twice)", () => {
  it("the migration exists", () => expect(FILE).toBeDefined());
  it("diabetes_care_triage", () => expect(seed("diabetes-rule-set")).toEqual(DIABETES_CARE_V1));
  it("asthma_copd_care_triage", () => expect(seed("asthma-rule-set")).toEqual(ASTHMA_COPD_V1));
  it("heart_failure_triage", () => expect(seed("hf-rule-set")).toEqual(HEART_FAILURE_V1));
  it("ckd_monitoring_triage", () => expect(seed("ckd-rule-set")).toEqual(CKD_V1));
  it("the draft hypertension step table", () => expect(seed("htn-step-table")).toEqual(HTN_RTSL_NG_DRAFT));
  it("the cadence config", () => expect(seed("pathway-cadence")).toEqual(loadCadenceConfig().value));
  it("the registry (both copies in the file)", () => {
    const blocks = [...SQL.matchAll(/jsonb_array_elements\(\$json\$([\s\S]*?)\$json\$::jsonb\) d/g)].map((m) => JSON.parse(m[1] as string));
    expect(blocks).toHaveLength(2);
    for (const b of blocks) expect(b).toEqual(JSON.parse(JSON.stringify(PATHWAY_DEFINITIONS)));
  });
  it("every seeded rule set and the step table is a draft with no approver", () => {
    for (const marker of ["diabetes-rule-set", "asthma-rule-set", "hf-rule-set", "ckd-rule-set", "htn-step-table"]) {
      expect((seed(marker) as { status: string }).status).toBe("draft");
    }
    const inserts = SQL.match(/insert into public\.(triage_rule_sets|protocols)[^;]*;/g) ?? [];
    expect(inserts.length).toBe(5);
    for (const i of inserts) expect(i).not.toMatch(/approved_by|approved_at|'approved'/);
  });
  it("the outcome_snapshots check lists every registry code", () => {
    const check = /outcome_snapshots_pathway_code_check\s+check \(pathway_code in \(([^)]*)\)\)/.exec(SQL)?.[1] ?? "";
    for (const p of PATHWAY_DEFINITIONS) expect(check).toContain(`'${p.code}'`);
  });
});

import { describe, it, expect, jest } from "@jest/globals";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { guidanceForItem, isSensitiveResultCode, resultAudioAllowed, SENSITIVE_RESULT_CODES } from "./guidance";
import { generatePatientExplanation } from "../patient-explainer/generate";

const MIGRATIONS = join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations");

describe("INV-04 guidance for a result item (S46, 3.13)", () => {
  it("gives a plain explanation and one next step for an ordinary flagged result", () => {
    expect(guidanceForItem({ analyte_code: "alt", flag: "high" }, true)).toEqual({ explanationKey: "labres.guide.high", nextStepKey: "labres.next.outside" });
    expect(guidanceForItem({ analyte_code: "hba1c", flag: "normal" }, true)).toEqual({ explanationKey: "labres.guide.normal", nextStepKey: "labres.next.normal" });
  });

  it("never explains HIV, hepatitis B surface antigen or hepatitis C antibody, whatever the flag", () => {
    for (const code of SENSITIVE_RESULT_CODES) {
      for (const flag of ["positive", "negative", "normal", "high"] as const) {
        const g = guidanceForItem({ analyte_code: code, flag }, true);
        expect([code, flag, g.explanationKey]).toEqual([code, flag, null]);
        expect(g.nextStepKey).toBe("labres.next.sensitive");
      }
    }
    expect(guidanceForItem({ analyte_code: "HbsAg", flag: "positive" }, true).explanationKey).toBeNull();
  });

  it("explains nothing when the database says the result is not explainable", () => {
    expect(guidanceForItem({ analyte_code: "alt", flag: "high" }, false).explanationKey).toBeNull();
    expect(guidanceForItem({ analyte_code: "alt", flag: "positive", sensitive_positive: true }, true).explanationKey).toBeNull();
  });

  it("audio is only for an explainable, non-sensitive item with a recorded clip", () => {
    expect(resultAudioAllowed({ analyte_code: "alt" }, true, true)).toBe(true);
    expect(resultAudioAllowed({ analyte_code: "alt" }, true, false)).toBe(false);
    expect(resultAudioAllowed({ analyte_code: "alt" }, false, true)).toBe(false);
    expect(resultAudioAllowed({ analyte_code: "hcv_ab" }, true, true)).toBe(false);
    expect(resultAudioAllowed({ analyte_code: "alt", sensitive_positive: true }, true, true)).toBe(false);
  });

  it("the sensitive code list mirrors the migration seed exactly", () => {
    const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_s46_results_serology_health_report.sql"));
    if (!file) throw new Error("S46 migration not found");
    const sql = readFileSync(join(MIGRATIONS, file), "utf8");
    const block = /insert into public\.sensitive_result_codes[\s\S]*?;/.exec(sql)?.[0] ?? "";
    const codes = [...block.matchAll(/\('([a-z_]+)',\s*'(?:hiv|hbv|hcv)'\)/g)].map((m) => m[1]).sort();
    expect(codes).toEqual([...SENSITIVE_RESULT_CODES].sort());
    expect(isSensitiveResultCode(" HIV_Screen ")).toBe(true);
    expect(isSensitiveResultCode("hba1c")).toBe(false);
  });
});

describe("the AI-003 explainer refuses a sensitive result before any model call or write (INV-04)", () => {
  it("returns failed, touches no table and calls no RPC for hiv_screen, hbsag and hcv_ab", async () => {
    const from = jest.fn();
    const rpc = jest.fn();
    const supabase = { from, rpc } as unknown as SupabaseClient<Database>;
    const service = jest.fn(() => ({ from, rpc }) as unknown as SupabaseClient<Database>);
    for (const subjectKey of ["hiv_screen", "hbsag", "hcv_ab", "HEP_B"]) {
      const out = await generatePatientExplanation(supabase, service, { patientId: "p", organisationId: "o", kind: "lab_analyte", subjectKey, label: "x", language: "en" });
      expect(out).toEqual({ status: "failed" });
    }
    expect(from).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
    expect(service).not.toHaveBeenCalled();
  });
});

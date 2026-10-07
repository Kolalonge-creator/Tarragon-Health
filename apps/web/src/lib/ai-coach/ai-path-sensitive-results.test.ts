/**
 * INV-04 (S51 pre-fix): the assistant and the result explainer never read a positive HIV, HBsAg or HCV result.
 * Proof in three layers: the tool/context/explainer drop such a row even if a source returns one; a negative still gets
 * through; and a repo scan fails the build if the AI path ever queries the unfiltered lab base tables again.
 */
import { describe, expect, it, jest } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { buildPatientRecordTools } from "./tools";
import { chainable } from "./test-support";
import { buildResultSnapshot } from "../patient-explainer/snapshot";

function toolByName(tools: ReturnType<typeof buildPatientRecordTools>, name: string) {
  const found = tools.find((t) => t.name === name);
  if (!found) throw new Error(`tool ${name} not found`);
  return found;
}

function fakeSupabase(result: unknown) {
  const from = jest.fn((_table: string) => chainable(result));
  return { client: { from } as unknown as SupabaseClient<Database>, from };
}

describe("getRecentLabResults (INV-04)", () => {
  const rows = [
    { code: "hba1c", value: 6.1, value_text: null, unit: "%", taken_at: "2026-10-01T00:00:00Z" },
    { code: "hiv_screen", value: null, value_text: "positive", unit: "", taken_at: "2026-10-02T00:00:00Z" },
    { code: "HBsAg", value: null, value_text: "reactive", unit: "", taken_at: "2026-10-02T00:00:00Z" },
    { code: "hcv_ab", value: null, value_text: "negative", unit: "", taken_at: "2026-10-02T00:00:00Z" },
  ];

  it("reads only the AI-safe view and never returns a positive or reactive screening result", async () => {
    const { client, from } = fakeSupabase({ data: rows, error: null });
    const tool = toolByName(buildPatientRecordTools(client, "p1"), "getRecentLabResults");
    const out = JSON.parse((await tool.invoke({})) as string) as { results: { code: string }[] };
    expect(from).toHaveBeenCalledWith("ai_readable_lab_readings");
    expect(from).not.toHaveBeenCalledWith("lab_analyte_readings");
    const codes = out.results.map((r) => r.code);
    expect(codes).toContain("hba1c");
    expect(codes).toContain("hcv_ab"); // an explicit negative still reaches the model
    expect(codes).not.toContain("hiv_screen");
    expect(codes).not.toContain("HBsAg");
  });

  it("says there is nothing on file when only sensitive rows exist", async () => {
    const { client } = fakeSupabase({ data: [rows[1]], error: null });
    const tool = toolByName(buildPatientRecordTools(client, "p1"), "getRecentLabResults");
    const out = JSON.parse((await tool.invoke({})) as string) as { results: unknown[]; note: string };
    expect(out.results).toEqual([]);
    expect(JSON.stringify(out)).not.toMatch(/positive|reactive|hiv/i);
  });
});

describe("result explainer snapshot (INV-04)", () => {
  it("returns nothing for a positive screening analyte and uses the AI-safe view", async () => {
    const { client, from } = fakeSupabase({
      data: [{ value: null, value_text: "positive", unit: "", taken_at: "2026-10-02T00:00:00Z" }],
      error: null,
    });
    const snap = await buildResultSnapshot(client, "p1", "lab_analyte", "hiv_screen", "HIV screen");
    expect(snap).toBeNull();
    expect(from).toHaveBeenCalledWith("ai_readable_lab_readings");
  });
});

describe("AI path never reads the unfiltered lab tables (scan)", () => {
  const ROOTS = [
    join(__dirname),
    join(__dirname, "..", "patient-explainer"),
    join(__dirname, "..", "ai-governance"),
  ];
  const FORBIDDEN = /\.from\(\s*["'](lab_analyte_readings|lab_result_items|lab_results)["']/;
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return files(p);
      return /\.(ts|tsx)$/.test(f) && !/\.test\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  }
  it("finds no direct query of lab_analyte_readings, lab_result_items or lab_results", () => {
    const offenders = ROOTS.flatMap(files).filter((f) => FORBIDDEN.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

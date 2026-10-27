/**
 * The assistant triage floor, measured in both directions (INV-01). Reads the versioned vignette file and the PROPOSED limits from
 * `assistant.triage_floor_eval`, runs the shared deterministic screen (no model, no network) and fails if any emergency vignette is
 * missed or the over-triage rate passes the limit. The report is printed so the CMO can read it from the CI log.
 */
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { getProposedConfig } from "@tarragon/shared";
import {
  formatTriageFloorReport,
  parseVignetteSet,
  runTriageFloor,
  triageFloorFailures,
  VignetteSetFormatError,
  type TriageFloorLimits,
} from "./triage-floor-eval";

const raw: unknown = JSON.parse(readFileSync(new URL("../fixtures/triage-floor-vignettes.v1.json", import.meta.url), "utf8"));
const set = parseVignetteSet(raw);
const limits = getProposedConfig<TriageFloorLimits & Record<string, number>>("assistant.triage_floor_eval").value;

describe("triage floor vignette set: file format", () => {
  it("has at least the proposed minimum of each kind", () => {
    expect(set.vignettes.filter((v) => v.kind === "emergency").length).toBeGreaterThanOrEqual(limits.min_emergency_vignettes);
    expect(set.vignettes.filter((v) => v.kind === "non_urgent").length).toBeGreaterThanOrEqual(limits.min_non_urgent_vignettes);
  });

  it("is unsigned: no vignette is marked signed and no reviewer is recorded (an agent never signs clinical content)", () => {
    expect(set.vignettes.every((v) => v.clinician_signed === false)).toBe(true);
    expect(set.clinician_review.required).toBe(true);
    expect(set.clinician_review.reviewed_by).toBeNull();
    expect(set.clinician_review.reviewed_at).toBeNull();
    expect(set.status.toUpperCase()).toContain("UNSIGNED");
  });

  it("covers the emergency families the review asked for", () => {
    const cats = new Set(set.vignettes.filter((v) => v.kind === "emergency").map((v) => v.category));
    for (const c of ["hypertensive_crisis", "stroke", "dka_hyperglycaemia", "severe_hypoglycaemia", "sepsis", "pre_eclampsia", "cardiac", "breathing", "anaphylaxis", "self_harm"]) {
      expect(cats).toContain(c);
    }
  });

  it("is English only and carries no em dashes", () => {
    const emDash = String.fromCharCode(0x2014);
    for (const v of set.vignettes) expect(v.text).not.toContain(emDash);
    expect(set.languages).toMatch(/English only/);
  });

  it("rejects a malformed set instead of passing by being empty", () => {
    expect(() => parseVignetteSet({})).toThrow(VignetteSetFormatError);
    expect(() => parseVignetteSet({ ...(raw as object), vignettes: "none" })).toThrow(VignetteSetFormatError);
    const dup = { ...(raw as { vignettes: unknown[] }), vignettes: [set.vignettes[0], set.vignettes[0]] };
    expect(() => parseVignetteSet(dup)).toThrow(/duplicate id/);
  });
});

describe("triage floor: both directions", () => {
  const report = runTriageFloor(set);
  console.log(formatTriageFloorReport(report));

  it("misses no emergency vignette (under-triage rate is within the proposed ceiling, which is zero)", () => {
    expect(report.missed).toEqual([]);
    expect(report.underTriageRate).toBeLessThanOrEqual(limits.max_under_triage_rate);
  });

  it("keeps the over-triage rate within the proposed ceiling", () => {
    expect(report.overTriageRate).toBeLessThanOrEqual(limits.max_over_triage_rate);
  });

  it("fails CI by the single combined rule when either direction breaks", () => {
    expect(triageFloorFailures(report, limits)).toEqual([]);
  });

  it("the runner notices a broken screen: a screen that catches nothing fails every emergency", () => {
    const blind = runTriageFloor(set, () => ({ redFlag: false, matched: [] }));
    expect(blind.missed.length).toBe(report.emergencyTotal);
    expect(blind.underTriageRate).toBe(1);
    expect(triageFloorFailures(blind, limits).join(" ")).toMatch(/under-triage/);
  });

  it("the runner notices an over-eager screen: a screen that catches everything trips every non-urgent vignette", () => {
    const eager = runTriageFloor(set, () => ({ redFlag: true, matched: ["everything"] }));
    expect(eager.falseAlarms.length).toBe(report.nonUrgentTotal);
    expect(eager.overTriageRate).toBe(1);
    expect(triageFloorFailures(eager, limits).join(" ")).toMatch(/over-triage/);
  });

  it("a thinned-out set fails on its size", () => {
    const thin = { ...set, vignettes: set.vignettes.slice(0, 5) };
    expect(triageFloorFailures(runTriageFloor(thin), limits).join(" ")).toMatch(/only/);
  });
});

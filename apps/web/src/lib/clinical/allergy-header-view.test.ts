import { describe, expect, it } from "@jest/globals";
import { ageInYears, ageSexLine, allergyHeaderView, provenanceLabel } from "./allergy-header-view";

type Row = Parameters<typeof allergyHeaderView>[0] extends infer R
  ? R extends { status: "ok"; rows: (infer X)[] }
    ? X
    : never
  : never;

const row = (over: Partial<Row>): Row => ({
  created_at: null,
  id: "a1",
  noted_at: null,
  organisation_id: null,
  patient_id: null,
  reaction: null,
  recorded_by: null,
  severity: null,
  source: "patient",
  substance: "Penicillin",
  verification_status: "unverified",
  ...over,
});

describe("allergyHeaderView", () => {
  it("a refused read is 'denied', never 'none'", () => {
    expect(allergyHeaderView({ status: "denied" })).toEqual({ kind: "denied" });
  });
  it("a failed read is 'error', never 'none'", () => {
    expect(allergyHeaderView({ status: "error", message: "x" })).toEqual({ kind: "error" });
  });
  it("an empty successful read is 'none'", () => {
    expect(allergyHeaderView({ status: "ok", rows: [] })).toEqual({ kind: "none" });
  });
  it("a refuted entry is shown last, labelled, never silently dropped", () => {
    const view = allergyHeaderView({
      status: "ok",
      rows: [row({ id: "r", substance: "Aspirin", severity: "severe", verification_status: "refuted" }), row({ id: "p", substance: "Latex" })],
    });
    expect(view).toEqual({
      kind: "list",
      items: [
        { id: "p", substance: "Latex", severity: null, provenance: "patient" },
        { id: "r", substance: "Aspirin", severity: "severe", provenance: "ruled_out" },
      ],
    });
    expect(provenanceLabel("ruled_out")).toBe("Marked as not an allergy by a clinician");
  });
  it("orders severe first, then by name, with the same provenance as the doctor summary PDF", () => {
    const view = allergyHeaderView({
      status: "ok",
      rows: [
        row({ id: "1", substance: "Latex", severity: "mild", source: "clinician" }),
        row({ id: "2", substance: "Sulfa", severity: "severe", verification_status: "confirmed" }),
        row({ id: "3", substance: "Aspirin", severity: null, source: "fhir_import" }),
        row({ id: "4", substance: "Codeine", severity: "severe" }),
      ],
    });
    expect(view).toEqual({
      kind: "list",
      items: [
        { id: "4", substance: "Codeine", severity: "severe", provenance: "patient" },
        { id: "2", substance: "Sulfa", severity: "severe", provenance: "clinician" },
        { id: "1", substance: "Latex", severity: "mild", provenance: "clinician" },
        { id: "3", substance: "Aspirin", severity: null, provenance: "imported" },
      ],
    });
  });
  it("skips rows with no id or substance rather than drawing a blank chip", () => {
    expect(allergyHeaderView({ status: "ok", rows: [row({ substance: null }), row({ id: null })] })).toEqual({ kind: "none" });
  });
});

describe("ageSexLine", () => {
  it("joins what is known", () => {
    expect(ageSexLine(54, "female")).toBe("54 years, female");
    expect(ageSexLine(1, null)).toBe("1 year");
    expect(ageSexLine(null, "male")).toBe("male");
    expect(ageSexLine(null, null)).toBeNull();
  });
  it("drops an impossible age", () => {
    expect(ageSexLine(-2, "male")).toBe("male");
    expect(ageSexLine(Number.NaN, null)).toBeNull();
  });
});

describe("ageInYears", () => {
  it("does not count a birthday that is tomorrow in Lagos", () => {
    expect(ageInYears("2008-11-07", new Date("2026-11-06T12:00:00Z"))).toBe(17);
    expect(ageInYears("2008-11-07", new Date("2026-11-06T23:30:00Z"))).toBe(18);
  });
  it("is null for a missing or impossible date", () => {
    expect(ageInYears(null, new Date())).toBeNull();
    expect(ageInYears("not-a-date", new Date())).toBeNull();
    expect(ageInYears("2030-01-01", new Date("2026-01-01T00:00:00Z"))).toBeNull();
  });
});

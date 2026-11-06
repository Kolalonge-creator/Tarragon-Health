import { describe, expect, it } from "@jest/globals";
import { ageSexLine, allergyHeaderView } from "./allergy-header-view";

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
  it("refuted entries are left out; if only refuted remain it is 'none'", () => {
    expect(allergyHeaderView({ status: "ok", rows: [row({ verification_status: "refuted" })] })).toEqual({ kind: "none" });
  });
  it("orders severe first, then by name, and labels provenance", () => {
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
        { id: "4", substance: "Codeine", severity: "severe", provenance: "patient_reported" },
        { id: "2", substance: "Sulfa", severity: "severe", provenance: "confirmed" },
        { id: "1", substance: "Latex", severity: "mild", provenance: "recorded_by_clinician" },
        { id: "3", substance: "Aspirin", severity: null, provenance: "imported_unchecked" },
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

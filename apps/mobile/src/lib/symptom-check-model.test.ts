import { describe, expect, it } from "@jest/globals";
import type { SymptomCapture } from "@tarragon/symptom-triage-engine";
import { categoryMessageKey, keepMoreUrgent, offlineResult, viewFor } from "./symptom-check-model";

const capture = (p: Partial<SymptomCapture>): SymptomCapture => ({
  presentingComplaintKey: "chest_pain",
  onset: "gradual",
  severity: 7,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...p,
});

describe("mobile symptom checker model (S59b)", () => {
  it("fails closed: no server answer, a closed guard or an unreadable eligibility all read as closed", () => {
    expect(viewFor(null)).toEqual({ kind: "closed" });
    expect(viewFor({ open: false, eligibility: "ok" })).toEqual({ kind: "closed" });
    expect(viewFor({ open: true, eligibility: "error" })).toEqual({ kind: "closed" });
    expect(viewFor(undefined)).toEqual({ kind: "loading" });
  });
  it("blocks under 18 and a missing date of birth, and only opens for an eligible adult", () => {
    expect(viewFor({ open: true, eligibility: "under_18" })).toEqual({ kind: "blocked", reason: "under_18" });
    expect(viewFor({ open: true, eligibility: "dob_required" })).toEqual({ kind: "blocked", reason: "dob_required" });
    expect(viewFor({ open: true, eligibility: "ok" })).toEqual({ kind: "ready" });
  });
  it("with no server the result is never all clear: chest pain with sweating stays an emergency, anything else is urgent", () => {
    expect(offlineResult(capture({ associatedSymptoms: ["sweating"] })).category).toBe("emergency");
    expect(offlineResult(capture({ severity: 2 })).category).toBe("urgent");
  });
  it("a later softer answer never replaces an emergency already shown", () => {
    expect(keepMoreUrgent(true, "self_management")).toBe("emergency");
    expect(keepMoreUrgent(false, "routine")).toBe("routine");
  });
  it("an unknown category reads as urgent wording, never reassurance", () => {
    expect(categoryMessageKey("???")).toBe("symptom.mobile.category.urgent");
  });
});

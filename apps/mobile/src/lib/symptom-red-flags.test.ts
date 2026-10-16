import { describe, expect, it } from "@jest/globals";
import type { SymptomCapture } from "@tarragon/symptom-triage-engine";
import { screenRedFlagsOnDevice } from "./symptom-red-flags";

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

describe("on-device red flags (INV-06)", () => {
  it("chest pain with sweating shows emergency guidance with no network and no server", () => {
    const r = screenRedFlagsOnDevice(capture({ associatedSymptoms: ["sweating"] }));
    expect(r.showEmergencyGuidance).toBe(true);
    expect(r.category).toBe("emergency");
    expect(r.fired).toContain("chest_pain.cardiac_pattern");
  });

  it("a low oxygen reading for breathlessness fires", () => {
    const r = screenRedFlagsOnDevice(capture({ presentingComplaintKey: "breathlessness", measurements: { spo2_pct: 90 } }));
    expect(r.showEmergencyGuidance).toBe(true);
  });

  it("nothing reported fires nothing, and says nothing about safety (null, not 'ok')", () => {
    const r = screenRedFlagsOnDevice(capture({ presentingComplaintKey: "headache", severity: 2 }));
    expect(r).toEqual({ category: null, fired: [], showEmergencyGuidance: false });
  });
});

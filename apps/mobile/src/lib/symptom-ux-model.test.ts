import { describe, expect, it } from "@jest/globals";
import { DESCRIBE_DRAFT, EXPLAINER_DRAFT, SAFETY_NET_DRAFT, type SymptomCapture } from "@tarragon/symptom-triage-engine";
import { bundledUx, describeOnDevice, lagosDateLabel, newDescribeSessionKey, NO_UX, phoneExtras, uxFromState, type MobileUx, type PhoneResult } from "./symptom-ux-model";
import { followUpIsEmergencyOnDevice, followUpResultView, keepEmergency } from "./symptom-checkback-model";

const sign = <T extends object>(c: T) => ({ ...c, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } });
const signedUx = (): { describe: unknown; explainer: unknown; safetyNet: unknown } => ({ describe: sign(DESCRIBE_DRAFT), explainer: sign(EXPLAINER_DRAFT), safetyNet: sign(SAFETY_NET_DRAFT) });
const AVAILABLE = ["headache", "chest_pain", "breathlessness"];

describe("the describe-box session key (OQ-S59c-05)", () => {
  it("is a uuid, different each time, and carries nothing about the person", () => {
    const a = newDescribeSessionKey();
    const b = newDescribeSessionKey();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe("which configs are in force on the phone", () => {
  it("while every bundled config is an unsigned draft, nothing is in force (the offline default)", () => {
    expect(bundledUx()).toEqual(NO_UX);
    expect(uxFromState(null)).toEqual(NO_UX);
    expect(uxFromState({})).toEqual(NO_UX);
  });

  it("uses exactly what the server sent, re-validated: a signed copy is used, a draft or garbage is not", () => {
    const ux = uxFromState({ ux: signedUx() });
    expect(ux.describe?.entries.length).toBeGreaterThan(0);
    expect(ux.explainer?.entries.length).toBeGreaterThan(0);
    expect(ux.safetyNet?.entries.length).toBeGreaterThan(0);
    expect(uxFromState({ ux: { describe: DESCRIBE_DRAFT, explainer: { junk: true }, safetyNet: null } })).toEqual(NO_UX);
  });

  it("a null from the server is never replaced by the bundled copy (null means unsigned or drifted)", () => {
    expect(uxFromState({ ux: { describe: null, explainer: null, safetyNet: null } })).toEqual(NO_UX);
  });
});

describe("describe it, on the phone", () => {
  const ux: MobileUx = uxFromState({ ux: signedUx() });

  it("the shared danger-phrase screen runs first: danger wins over an exact synonym", () => {
    expect(describeOnDevice("I have a headache and I fainted", ux, AVAILABLE)).toMatchObject({ kind: "danger" });
    expect(describeOnDevice("I cannot breathe", ux, AVAILABLE)).toMatchObject({ kind: "danger" });
    expect(describeOnDevice("I want to kill myself", ux, AVAILABLE)).toMatchObject({ kind: "danger", selfHarm: true });
  });
  it("an unsigned table still screens for danger and otherwise matches nothing", () => {
    expect(describeOnDevice("I cannot breathe", NO_UX, AVAILABLE)).toMatchObject({ kind: "danger" });
    expect(describeOnDevice("I have a headache", NO_UX, AVAILABLE)).toEqual({ kind: "no_match" });
  });
  it("a clear description routes to a signed pathway; an unavailable one is never routed to", () => {
    expect(describeOnDevice("my head is paining me", ux, AVAILABLE)).toMatchObject({ kind: "match", pathwayKey: "headache" });
    expect(describeOnDevice("I have a fever", ux, AVAILABLE)).toEqual({ kind: "no_match" });
  });
  it("ordinary words about a BP cuff are not danger (word boundaries)", () => {
    expect(describeOnDevice("my numbers on my left arm look high, headache too", ux, AVAILABLE).kind).not.toBe("danger");
  });
  it("nothing returned contains the typed text", () => {
    expect(JSON.stringify(describeOnDevice("xyzzy-private headache", ux, AVAILABLE))).not.toContain("xyzzy");
  });
});

describe("the result extras", () => {
  const capture: SymptomCapture = { presentingComplaintKey: "headache", onset: "sudden", severity: 9, associatedSymptoms: [], triggers: [], relevantHistory: ["pregnant"], measurements: {} };
  const base: PhoneResult = {
    category: "emergency",
    complaintKey: "headache",
    complaintLabel: "Headache",
    headline: "Emergency: go now",
    nextStep: "Please go to the nearest emergency department now.",
    checkedAt: "2026-10-22T10:00:00Z",
    capture,
    firedRuleKeys: ["headache.thunderclap_onset"],
    safetyNetMessageKey: "redflag.headache.thunderclap_onset",
    tightenedBy: [],
    questionsAsked: [],
    bundledPathway: true,
  };

  it("with nothing signed: no explanation, the generic safety net, and a card", () => {
    const x = phoneExtras(base, NO_UX);
    expect(x.explanation).toBeNull();
    expect(x.net.specific).toEqual([]);
    expect(x.card).toContain("Emergency: go now");
    expect(x.card).toContain("you are getting worse quickly");
    expect(x.card).toContain("Not a diagnosis");
  });
  it("with signed configs: the reason beside the person's own answers, and the pathway's lines in the card, never the pregnancy answer", () => {
    const x = phoneExtras(base, uxFromState({ ux: signedUx() }));
    expect(x.explanation?.items[0]?.id).toBe("rule:headache.thunderclap_onset");
    expect(JSON.stringify(x.explanation)).not.toContain("pregnant");
    expect(x.card).toContain("- you lose some of your vision");
    expect(x.card).not.toMatch(/pregnan/i);
  });
  it("the card has a Lagos date and no clock reads in the model", () => {
    expect(phoneExtras(base, NO_UX).card).toContain("22 October 2026");
    expect(lagosDateLabel("2026-10-22T23:30:00Z")).toBe("23 October 2026"); // 00:30 in Lagos
    expect(lagosDateLabel("nonsense")).toBeNull();
  });
});

describe("the follow-up, on the phone", () => {
  const headache: SymptomCapture = { presentingComplaintKey: "headache", onset: "gradual", severity: 4, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} };
  it("a newly ticked warning sign that fires an emergency rule shows the emergency route on the device", () => {
    expect(followUpIsEmergencyOnDevice(headache, ["confusion"])).toBe(true);
    expect(followUpIsEmergencyOnDevice(headache, ["fever"])).toBe(false);
    expect(followUpIsEmergencyOnDevice(headache, [])).toBe(false);
  });
  it("an emergency already shown is never replaced by a softer answer", () => {
    expect(keepEmergency(true, "close")).toBe("emergency");
    expect(keepEmergency(true, null)).toBe("emergency");
    expect(keepEmergency(false, "book")).toBe("book");
  });
  it("what each action shows", () => {
    expect(followUpResultView("close", null, false)).toMatchObject({ showDoors: false, showSafetyNet: false, told: false });
    expect(followUpResultView("escalate", true, true)).toMatchObject({ messageKey: "symptom.checkback.result.escalate", told: true, showDoors: true, doorCategory: "urgent", showSafetyNet: true });
    expect(followUpResultView("escalate", false, false)).toMatchObject({ messageKey: "symptom.checkback.result.no_doctor", told: false });
    expect(followUpResultView("emergency", true, true)).toMatchObject({ messageKey: "symptom.emergency.go_now", told: false, doorCategory: "emergency", showSafetyNet: false });
    expect(followUpResultView("book", null, false)).toMatchObject({ doorCategory: "routine" });
  });
});

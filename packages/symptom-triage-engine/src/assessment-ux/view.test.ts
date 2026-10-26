import { describe, it, expect } from "@jest/globals";
import { CHECKBACK_ACTIONS } from "./checkback";
import { EXPLAINER_DRAFT, SAFETY_NET_DRAFT } from "./drafts";
import { outcomeKeyFromSafetyNetKey } from "./explainer";
import { buildResultCard, buildResultExtras, checkbackDoorCategory, checkbackResultKey, explainerFactText, safetyNetLines, type ResultExtrasInput, type Translate } from "./view";

/** A fake translator that makes the key and params visible, so the tests pin wiring rather than wording. */
const tr: Translate = (key, params) => (params ? `${key}(${JSON.stringify(params)})` : key);
const label = (k: string) => `label:${k}`;

describe("explainerFactText", () => {
  it("turns each kind of fact into a line", () => {
    expect(explainerFactText({ kind: "onset", value: "sudden" }, tr, label)).toBe("symptom.why.fact.onset.sudden");
    expect(explainerFactText({ kind: "severity", value: 9 }, tr, label)).toBe('symptom.why.fact.severity({"n":9})');
    expect(explainerFactText({ kind: "symptom", key: "confusion" }, tr, label)).toBe("label:confusion");
    expect(explainerFactText({ kind: "measurement", key: "spo2_pct", value: 90 }, tr, label)).toBe('symptom.why.fact.spo2({"value":"90%"})');
    expect(explainerFactText({ kind: "answer", key: "q", prompt: "Is it worse?", value: "yes" }, tr, label)).toContain("symptom.mobile.yes");
  });
});

describe("safety net lines", () => {
  it("always has the generic lines and the nearest hospital sentence, whatever the config says", () => {
    const { lines, closing } = safetyNetLines({ specific: [], emergencyNumber: null }, tr);
    expect(lines).toEqual(["symptom.net.generic.worse", "symptom.net.generic.wrong"]);
    expect(closing).toEqual(["symptom.net.nearest"]);
  });
  it("adds the pathway lines after the generic ones, and the number only when given", () => {
    const { lines, closing } = safetyNetLines({ specific: ["you faint"], emergencyNumber: "112" }, tr);
    expect(lines[lines.length - 1]).toBe("you faint");
    expect(lines[0]).toBe("symptom.net.generic.worse");
    expect(closing).toHaveLength(2);
    expect(closing[1]).toContain("112");
  });
});

describe("the result card", () => {
  const base = { complaintLabel: "Headache", headline: "Be seen within a few days", nextStep: "Book or message", dateLabel: "22 October 2026", net: { specific: ["you faint"], emergencyNumber: null } };
  it("carries the result, the safety net with its closing sentence, the shared label and nothing else", () => {
    const card = buildResultCard(base, tr);
    expect(card).toContain("symptom.card.title");
    expect(card).toContain("Be seen within a few days");
    expect(card).toContain("- symptom.net.generic.worse");
    expect(card).toContain("- you faint");
    expect(card).toContain("symptom.net.nearest");
    expect(card).toContain("symptom.not_a_diagnosis.short");
  });
  it("never contains the typed text, a pregnancy answer or an id (it has no field for them)", () => {
    const card = buildResultCard(base, tr);
    expect(card).not.toMatch(/pregnan|[0-9a-f]{8}-[0-9a-f]{4}/i);
  });
  it("leaves out an unknown date and complaint without blank runs", () => {
    const card = buildResultCard({ ...base, complaintLabel: null, dateLabel: null }, tr);
    expect(card).not.toContain("null");
    expect(card).not.toMatch(/\n\n\n/);
  });
});

describe("follow-up result wording", () => {
  it("every action has wording, an emergency uses the existing guidance, and a plan without doctor time is told the truth", () => {
    for (const a of CHECKBACK_ACTIONS) expect(checkbackResultKey(a, true)).toMatch(/^symptom\./);
    expect(checkbackResultKey("emergency", true)).toBe("symptom.emergency.go_now");
    expect(checkbackResultKey("escalate", true)).toBe("symptom.checkback.result.escalate");
    expect(checkbackResultKey("escalate", false)).toBe("symptom.checkback.result.no_doctor");
  });
  it("the doors offered after a follow-up are never lower than the action implies", () => {
    expect(checkbackDoorCategory("emergency")).toBe("emergency");
    expect(checkbackDoorCategory("escalate")).toBe("urgent");
    expect(checkbackDoorCategory("book")).toBe("routine");
    expect(checkbackDoorCategory("close")).toBe("self_management");
  });
});

describe("outcomeKeyFromSafetyNetKey", () => {
  it("passes a question-tree outcome key and refuses red-flag, fallback, degraded and describe keys", () => {
    expect(outcomeKeyFromSafetyNetKey("headache.self_mild")).toBe("headache.self_mild");
    for (const k of ["", "redflag.headache.thunderclap_onset", "generic.fallback_review", "degraded.engine_unavailable", "describe.danger"]) expect(outcomeKeyFromSafetyNetKey(k)).toBeNull();
  });
});

describe("buildResultExtras", () => {
  const signed = <T extends object>(c: T) => ({ ...c, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } });
  const input: ResultExtrasInput = {
    category: "routine",
    complaintKey: "headache",
    complaintLabel: "Headache",
    headline: "Be seen within a few days",
    nextStep: "Book or message",
    dateLabel: "22 October 2026",
    capture: { presentingComplaintKey: "headache", onset: "gradual", severity: 5, associatedSymptoms: [], triggers: [], relevantHistory: [], measurements: {} },
    firedRuleKeys: [],
    safetyNetMessageKey: "headache.routine_moderate",
    tightenedBy: [],
    questionsAsked: [{ questionKey: "severity_check", prompt: "How is the pain?", answer: "moderate", answeredAt: "2026-10-22T10:00:00Z" }],
    useBundledConditions: true,
  };

  it("with unsigned configs: no explanation, no specific safety lines, and a card with the generic safety net", () => {
    const x = buildResultExtras(input, { explainer: EXPLAINER_DRAFT, safetyNet: SAFETY_NET_DRAFT }, tr);
    expect(x.explanation).toBeNull();
    expect(x.net).toEqual({ specific: [], emergencyNumber: null });
    expect(x.card).toContain("Be seen within a few days");
    expect(x.card).toContain("symptom.net.generic.worse");
  });

  it("with signed configs: the explanation of the outcome that applied, the pathway's lines, and a card that carries both the lines and the label", () => {
    const x = buildResultExtras(input, { explainer: signed(EXPLAINER_DRAFT), safetyNet: signed(SAFETY_NET_DRAFT) }, tr);
    expect(x.explanation?.items.map((i) => i.id)).toEqual(["outcome:headache.routine_moderate"]);
    expect(x.net.specific).toContain("you lose some of your vision");
    expect(x.card).toContain("- you lose some of your vision");
    expect(x.card).toContain("symptom.not_a_diagnosis.short");
    // the card carries the safety net, not the explanation (it stays a short, safe-to-share page)
    expect(x.card).not.toContain("Your answers show");
  });

  it("derives the explanation only from this result: no capture means no explanation", () => {
    expect(buildResultExtras({ ...input, capture: null }, { explainer: signed(EXPLAINER_DRAFT), safetyNet: null }, tr).explanation).toBeNull();
  });
});

/**
 * S59c "Why this result": derived only from the rules that fired, empty unless the config is signed, never a diagnosis.
 */
import { describe, it, expect } from "@jest/globals";
import { SEED_PATHWAYS } from "../protocols/index";
import type { RedFlagCondition, SymptomCapture } from "../types/index";
import { EXPLAINER_DRAFT } from "./drafts";
import { explainResult, explainerConfigSchema } from "./explainer";

const SIGNED = { ...EXPLAINER_DRAFT, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } };

const capture = (over: Partial<SymptomCapture> = {}): SymptomCapture => ({
  presentingComplaintKey: "headache",
  onset: "sudden",
  severity: 9,
  associatedSymptoms: [],
  triggers: [],
  relevantHistory: [],
  measurements: {},
  ...over,
});

const CONDITIONS: Record<string, RedFlagCondition> = Object.fromEntries(
  SEED_PATHWAYS.flatMap((p) => p.redFlagScreen.map((r) => [r.key, r.rule] as const)),
);

const base = { outcomeKey: null, tightenedBy: [], questionsAsked: [], capture: capture(), ruleConditions: CONDITIONS };

describe("the shipped draft", () => {
  it("parses and is an unsigned draft", () => {
    const parsed = explainerConfigSchema.parse(EXPLAINER_DRAFT);
    expect(parsed.status).toBe("draft");
    expect(parsed.clinical_sign_off).toBeNull();
  });

  it("explains nothing while unsigned, even for a rule it has text for", () => {
    expect(explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset"] }, EXPLAINER_DRAFT)).toBeNull();
  });

  it("explains nothing when marked signed with no signer, or when malformed", () => {
    expect(explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset"] }, { ...SIGNED, clinical_sign_off: null })).toBeNull();
    expect(explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset"] }, { nope: 1 })).toBeNull();
  });

  it("has text for every rule and every outcome of the signed pathways, and for nothing else", () => {
    const ruleIds = SEED_PATHWAYS.flatMap((p) => p.redFlagScreen.map((r) => `rule:${r.key}`));
    const outcomeIds = SEED_PATHWAYS.flatMap((p) =>
      Object.values(p.nodes)
        .filter((n) => n.type === "outcome")
        .map((n) => `outcome:${(n as { safetyNetMessageKey: string }).safetyNetMessageKey}`),
    );
    const have = EXPLAINER_DRAFT.entries.map((e) => e.id).sort();
    expect(have).toEqual([...ruleIds, ...outcomeIds].sort());
  });

  it("reads as plain words: no diagnosis wording, no ranking, no em dash", () => {
    const text = EXPLAINER_DRAFT.entries.flatMap((e) => [e.reason, ...(("tell_us_sooner_if" in e ? e.tell_us_sooner_if : []) as string[])]).join("\n");
    expect(text).not.toMatch(/you have (a|an) [a-z]+(itis|osis|emia|oma)\b/i);
    expect(text).not.toMatch(/\b(probably|likely|most likely|might be|could be|caused by|diagnos|differential|chance|percent|%)\b/i);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/pregnan|hiv|cancer|immuno/i);
  });
});

describe("explaining a result (signed fixture)", () => {
  it("gives the reason of the rule that fired and the person's own answers beside it", () => {
    const out = explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset"] }, SIGNED);
    expect(out).not.toBeNull();
    expect(out!.items).toHaveLength(1);
    expect(out!.items[0]!.id).toBe("rule:headache.thunderclap_onset");
    expect(out!.items[0]!.youTold).toEqual([
      { kind: "onset", value: "sudden" },
      { kind: "severity", value: 9 },
    ]);
  });

  it("lists every rule that fired, once each, in firing order", () => {
    const out = explainResult(
      { ...base, firedRuleKeys: ["headache.vision_loss", "headache.thunderclap_onset", "headache.vision_loss"], capture: capture({ associatedSymptoms: ["vision_loss"] }) },
      SIGNED,
    );
    expect(out!.items.map((i) => i.id)).toEqual(["rule:headache.vision_loss", "rule:headache.thunderclap_onset"]);
  });

  it("does not repeat a pregnancy answer", () => {
    const out = explainResult(
      { ...base, firedRuleKeys: ["headache.pregnancy_severe"], capture: capture({ relevantHistory: ["pregnant"], severity: 7 }) },
      SIGNED,
    );
    const facts = out!.items[0]!.youTold;
    expect(JSON.stringify(facts)).not.toContain("pregnant");
  });

  it("an outcome carries the questions answered and the lines for 'tell your care team sooner'", () => {
    const out = explainResult(
      {
        ...base,
        firedRuleKeys: [],
        outcomeKey: "headache.self_mild",
        questionsAsked: [{ questionKey: "severity_check", prompt: "How would you describe the pain right now?", answer: "mild", answeredAt: "2026-10-22T10:00:00Z" }],
      },
      SIGNED,
    );
    expect(out!.items[0]!.id).toBe("outcome:headache.self_mild");
    expect(out!.items[0]!.youTold).toEqual([{ kind: "answer", key: "severity_check", prompt: "How would you describe the pain right now?", value: "mild" }]);
    expect(out!.tellUsSooner.length).toBeGreaterThan(0);
  });

  it("a rule with no entry produces nothing, and when nothing is produced there is no explanation at all", () => {
    expect(explainResult({ ...base, firedRuleKeys: ["headache.no_such_rule"] }, SIGNED)).toBeNull();
    expect(explainResult({ ...base, firedRuleKeys: [], outcomeKey: "generic.fallback_review" }, SIGNED)).toBeNull();
    // a rule WITH text and one without: only the one with text appears, nothing is made up for the other
    const out = explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset", "headache.no_such_rule"] }, SIGNED);
    expect(out!.items.map((i) => i.id)).toEqual(["rule:headache.thunderclap_onset"]);
  });

  it("has no field that could carry a ranking or a diagnosis", () => {
    const out = explainResult({ ...base, firedRuleKeys: ["headache.thunderclap_onset"] }, SIGNED)!;
    expect(Object.keys(out).sort()).toEqual(["items", "tellUsSooner"]);
    expect(Object.keys(out.items[0]!).sort()).toEqual(["id", "reason", "youTold"]);
  });
});

describe("property: derived only from the rules that fired", () => {
  const ids = SIGNED.entries.map((e) => e.id);
  it("for any subset that fired, every item is one of those rules (or the outcome or a tightening entry named), and adding entries for other rules changes nothing", () => {
    let seed = 11;
    const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
    const ruleKeys = ids.filter((i) => i.startsWith("rule:")).map((i) => i.slice(5));
    for (let n = 0; n < 300; n++) {
      const fired = ruleKeys.filter(() => rnd() < 0.25);
      const out = explainResult({ ...base, firedRuleKeys: fired }, SIGNED);
      const got = (out?.items ?? []).map((i) => i.id);
      expect(got.sort()).toEqual(fired.map((k) => `rule:${k}`).sort());
      // extra entries for rules that did NOT fire never leak in
      const extra = { ...SIGNED, entries: [...SIGNED.entries, { id: "rule:headache.zzz_extra", reason: "This should never be shown for a rule that did not fire." }] };
      const out2 = explainResult({ ...base, firedRuleKeys: fired }, extra);
      expect(JSON.stringify(out2)).toBe(JSON.stringify(out));
      expect(JSON.stringify(out2)).not.toContain("zzz_extra");
    }
  });

  it("with an unsigned config the answer is always null, whatever fired", () => {
    const ruleKeys = ids.filter((i) => i.startsWith("rule:")).map((i) => i.slice(5));
    for (const k of ruleKeys) expect(explainResult({ ...base, firedRuleKeys: [k] }, EXPLAINER_DRAFT)).toBeNull();
  });
});

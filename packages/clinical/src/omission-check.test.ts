import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { getProposedConfig } from "@tarragon/shared";
import { checkOmissions, hasFollowUpInterval, mentions, type OmissionInput, type OmissionRules } from "./omission-check";

// The test rules are small and local on purpose: the real lists live in the PROPOSED config and are CMO-owned.
const RULES: OmissionRules = {
  allergyClasses: { penicillin: ["penicillin", "amoxicillin", "augmentin"], nsaid: ["nsaid", "ibuprofen", "diclofenac"] },
  followUpRequiredConditions: ["hypertension", "diabetes"],
};
const META = { version: 1, status: "proposed" } as const;

const base: OmissionInput = { draftText: "", allergies: [], medications: [], conditions: [], awaitingResults: [] };
const run = (over: Partial<OmissionInput>) => checkOmissions({ ...base, ...over }, RULES, META);
const kinds = (r: ReturnType<typeof run>) => r.flags.map((f) => f.kind);

describe("checkOmissions: the contract", () => {
  it("never blocks signing, on any input, and every flag is informational", () => {
    const r = run({
      draftText: "Start amoxicillin 500 mg.",
      allergies: [{ id: "a1", allergen: "Penicillin" }],
      medications: [{ id: "m1", name: "Metformin" }],
      conditions: [{ id: "c1", name: "Type 2 diabetes" }],
      awaitingResults: [{ id: "r1", label: "HbA1c" }],
    });
    expect(r.blocksSigning).toBe(false);
    expect(r.flags.length).toBeGreaterThan(0);
    expect(r.flags.every((f) => f.severity === "info")).toBe(true);
  });

  it("returns no flags and no unused items for an empty record, whatever the draft says", () => {
    const r = run({ draftText: "Anything at all, in 2 weeks." });
    expect(r.flags).toEqual([]);
    expect(r.sourceItemsNotUsed).toEqual([]);
  });

  it("carries the rules version and status so a screen can say the lists are unsigned", () => {
    expect(run({}).rulesVersion).toBe(1);
    expect(run({}).rulesStatus).toBe("proposed");
  });
});

describe("drug named in the draft versus the allergy list", () => {
  it("flags the allergen itself", () => {
    const r = run({ draftText: "Give penicillin V.", allergies: [{ id: "a1", allergen: "Penicillin" }] });
    expect(kinds(r)).toContain("drug_vs_allergy");
    expect(r.flags.find((f) => f.kind === "drug_vs_allergy")?.sourceId).toBe("a1");
  });

  it("flags a member of the allergy's class by its own name", () => {
    const r = run({ draftText: "Plan: amoxicillin 500 mg three times daily.", allergies: [{ id: "a1", allergen: "Penicillin allergy" }] });
    expect(r.flags.some((f) => f.kind === "drug_vs_allergy" && f.detail.startsWith("amoxicillin"))).toBe(true);
  });

  it("does not flag a drug from a different class", () => {
    const r = run({ draftText: "Plan: ibuprofen for pain.", allergies: [{ id: "a1", allergen: "Penicillin" }] });
    expect(kinds(r)).not.toContain("drug_vs_allergy");
  });

  it("matches whole words only: 'amoxicillins' style substrings and unrelated words do not match", () => {
    expect(mentions("the penicillinase test", "penicillin")).toBe(false);
    expect(mentions("Penicillin.", "penicillin")).toBe(true);
  });

  it("an allergy not in any class still flags its own name when the draft names it", () => {
    const r = run({ draftText: "Avoid latex gloves; give codeine.", allergies: [{ id: "a2", allergen: "codeine" }] });
    expect(kinds(r)).toContain("drug_vs_allergy");
  });
});

describe("abnormal result awaiting action", () => {
  it("flags a result the draft does not mention and lists it as an unused source item", () => {
    const r = run({ draftText: "Blood pressure reviewed.", awaitingResults: [{ id: "r1", label: "Creatinine" }] });
    expect(kinds(r)).toContain("result_not_mentioned");
    expect(r.sourceItemsNotUsed).toContainEqual({ kind: "result", id: "r1", label: "Creatinine" });
  });

  it("does not flag when the draft names the result by its label or an extra term", () => {
    expect(kinds(run({ draftText: "Creatinine is up; repeat.", awaitingResults: [{ id: "r1", label: "Creatinine" }] }))).not.toContain("result_not_mentioned");
    expect(kinds(run({ draftText: "eGFR to be rechecked.", awaitingResults: [{ id: "r1", label: "Kidney panel", terms: ["egfr"] }] }))).not.toContain("result_not_mentioned");
  });
});

describe("follow-up interval", () => {
  it("flags a required condition with no interval stated", () => {
    const r = run({ draftText: "Continue current treatment.", conditions: [{ id: "c1", name: "Essential hypertension" }] });
    expect(kinds(r)).toContain("no_follow_up_interval");
  });

  it("is satisfied by a stated interval", () => {
    for (const text of ["Review in 2 weeks.", "See again next month.", "Follow up in two weeks", "Recheck in a week", "Return tomorrow"]) {
      expect(kinds(run({ draftText: text, conditions: [{ id: "c1", name: "Hypertension" }] }))).not.toContain("no_follow_up_interval");
    }
  });

  it("does not require an interval for a condition the rule does not name", () => {
    expect(kinds(run({ draftText: "Rest.", conditions: [{ id: "c1", name: "Seasonal rhinitis" }] }))).not.toContain("no_follow_up_interval");
  });

  it("recognises intervals in text but not unrelated numbers", () => {
    expect(hasFollowUpInterval("BP 150/90")).toBe(false);
    expect(hasFollowUpInterval("in 3 months")).toBe(true);
  });
});

describe("medication in the record not mentioned", () => {
  it("flags each unmentioned medication and lists it as unused", () => {
    const r = run({ draftText: "Continue amlodipine.", medications: [{ id: "m1", name: "Amlodipine" }, { id: "m2", name: "Metformin" }] });
    expect(r.flags.filter((f) => f.kind === "medication_not_mentioned").map((f) => f.sourceId)).toEqual(["m2"]);
    expect(r.sourceItemsNotUsed.filter((s) => s.kind === "medication").map((s) => s.id)).toEqual(["m2"]);
  });
});

describe("the real PROPOSED config drives the checker, and the code holds no clinical list", () => {
  const cfg = getProposedConfig<OmissionRules & Record<string, never>>("copilot.omission_rules");

  it("is unsigned (proposed) and the panel flag is OFF", () => {
    expect(cfg.status).toBe("proposed");
    expect(getProposedConfig("copilot.omission_panel_enabled").value).toBe(false);
  });

  it("flags an amoxicillin draft for a penicillin-allergic patient using only the config's lists", () => {
    const r = checkOmissions(
      { ...base, draftText: "Amoxicillin 500 mg", allergies: [{ id: "a1", allergen: "Penicillin" }] },
      cfg.value as unknown as OmissionRules,
      { version: cfg.version, status: cfg.status },
    );
    expect(kinds(r)).toContain("drug_vs_allergy");
    expect(r.rulesStatus).toBe("proposed");
  });

  it("sabotage: with the class lists emptied, the same draft is no longer flagged by class (the config is what flags it)", () => {
    const emptied: OmissionRules = { ...(cfg.value as unknown as OmissionRules), allergyClasses: {} };
    const r = checkOmissions({ ...base, draftText: "Amoxicillin 500 mg", allergies: [{ id: "a1", allergen: "Penicillin" }] }, emptied, META);
    expect(kinds(r)).not.toContain("drug_vs_allergy");
  });

  it("the source holds no drug class list of its own", () => {
    const src = readFileSync(new URL("./omission-check.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/amoxicillin|ibuprofen|diclofenac|metformin|hypertension"/i);
  });
});

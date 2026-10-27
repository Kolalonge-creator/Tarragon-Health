import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { getProposedConfig } from "@tarragon/shared";
import { checkOmissions, hasFollowUpInterval, mentions, type OmissionInput, type OmissionRules } from "./omission-check";

// The test rules are small and local on purpose: the real lists live in the PROPOSED config and are CMO-owned.
const RULES: OmissionRules = {
  allergyClasses: { penicillin: ["penicillin", "amoxicillin", "augmentin"], nsaid: ["nsaid", "ibuprofen", "diclofenac"] },
  followUpRequiredConditions: ["hypertension", "diabetes"],
  followUpContextTerms: ["review*", "follow up", "followup", "recheck*", "see you", "return*", "come back", "appointment*", "repeat*"],
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
    for (const text of ["Review in 2 weeks.", "Review next month.", "Follow up in two weeks", "Recheck in a week", "Return tomorrow"]) {
      expect(kinds(run({ draftText: text, conditions: [{ id: "c1", name: "Hypertension" }] }))).not.toContain("no_follow_up_interval");
    }
  });

  it("does not require an interval for a condition the rule does not name", () => {
    expect(kinds(run({ draftText: "Rest.", conditions: [{ id: "c1", name: "Seasonal rhinitis" }] }))).not.toContain("no_follow_up_interval");
  });

  const CTX = RULES.followUpContextTerms ?? [];

  it("recognises intervals in text but not unrelated numbers", () => {
    expect(hasFollowUpInterval("BP 150/90", CTX)).toBe(false);
    expect(hasFollowUpInterval("Review in 3 months", CTX)).toBe(true);
  });

  it("dosing frequency and symptom duration are not follow-up intervals (S89 review item 5)", () => {
    const flagged = (draftText: string) => kinds(run({ draftText, conditions: [{ id: "c1", name: "Hypertension" }] })).includes("no_follow_up_interval");
    expect(flagged("Metformin 500 mg twice a day. Cough for 3 days.")).toBe(true);
    expect(flagged("Take one tablet a day.")).toBe(true);
    expect(flagged("Amlodipine 5 mg once a day, review if dizzy.")).toBe(true);
    expect(flagged("Cough for 3 days, review if worse.")).toBe(true);
    expect(flagged("Fever since 2 days; will return if worse.")).toBe(true);
    expect(flagged("Paracetamol 3 times a day for 5 days.")).toBe(true);
  });

  it("an interval counts only in the same clause as a follow-up word", () => {
    expect(hasFollowUpInterval("Metformin 500 mg twice a day. Review in 2 weeks.", CTX)).toBe(true);
    expect(hasFollowUpInterval("Cough for 3 days, review in 2 weeks", CTX)).toBe(true);
    expect(hasFollowUpInterval("Review. Pain for 2 weeks.", CTX)).toBe(false);
    expect(hasFollowUpInterval("Seen 2 weeks ago", CTX)).toBe(false);
    expect(hasFollowUpInterval("Review in 2.5 weeks", CTX)).toBe(true);
    // sabotage: with no context terms configured nothing qualifies, so the flag shows rather than hiding
    expect(hasFollowUpInterval("Review in 2 weeks", [])).toBe(false);
  });

  it("'see you tomorrow', 'come back next week' and 'appointment in a month' count", () => {
    for (const t of ["See you tomorrow.", "Come back next week.", "Appointment in a month.", "Repeat BP in 3 days."]) expect(hasFollowUpInterval(t, CTX)).toBe(true);
  });
});

describe("medication in the record not mentioned", () => {
  it("flags each unmentioned medication and lists it as unused", () => {
    const r = run({ draftText: "Continue amlodipine.", medications: [{ id: "m1", name: "Amlodipine" }, { id: "m2", name: "Metformin" }] });
    expect(r.flags.filter((f) => f.kind === "medication_not_mentioned").map((f) => f.sourceId)).toEqual(["m2"]);
    expect(r.sourceItemsNotUsed.filter((s) => s.kind === "medication").map((s) => s.id)).toEqual(["m2"]);
  });
});

describe("allergy matching (S89 review item 6)", () => {
  const FULL_RULES: OmissionRules = {
    ...RULES,
    allergyClasses: {
      penicillin: ["penicillin", "amoxicillin", "augmentin", "clavulin", "amoxil", "co-amoxiclav"],
      sulfonamide: ["sulfa", "sulfonamide", "co-trimoxazole", "cotrimoxazole", "bactrim", "septrin"],
    },
    drugSynonyms: [["paracetamol", "acetaminophen", "panadol"]],
    nonDrugAllergens: ["peanut", "latex", "nkda"],
    allergenNoiseWords: ["allergy", "allergic", "rash", "to"],
    spellingAliases: { sulpha: "sulfa", sulphonamide: "sulfonamide" },
  };
  const go = (draftText: string, allergen: string) => checkOmissions({ ...base, draftText, allergies: [{ id: "a1", allergen }] }, FULL_RULES, META);
  const clash = (draftText: string, allergen: string) => go(draftText, allergen).flags.some((f) => f.kind === "drug_vs_allergy");

  it("understands case, diacritics and British or Nigerian spellings: sulpha is sulfa", () => {
    expect(clash("Start Septrin.", "Sulpha drugs")).toBe(true);
    expect(clash("Start co-trimoxazole.", "SULFA")).toBe(true);
    expect(clash("Start Bactrim.", "Sulphonamides")).toBe(true);
    expect(clash("Start AMOXICILLIN.", "penicillín")).toBe(true);
  });

  it("matches brand names to the generic allergen in both directions", () => {
    expect(clash("Give Augmentin 625.", "Amoxicillin")).toBe(true);
    expect(clash("Give Clavulin.", "Penicillin allergy")).toBe(true);
    expect(clash("Give Amoxil.", "Augmentin")).toBe(true);
    expect(clash("Give Panadol.", "Acetaminophen")).toBe(true);
  });

  it("tolerates one typo in a word of six letters or more, and no more", () => {
    expect(clash("Give amoxicilin.", "Penicillin")).toBe(true);
    expect(clash("Give amoxicillin.", "Penicilin")).toBe(true);
    expect(clash("Give amoxxcilin.", "Penicillin")).toBe(false);
    // short words must match exactly: 'sulfo' is not 'sulfa'
    expect(clash("Give sulfo.", "Sulfa")).toBe(false);
  });

  it("matches on word boundaries: a word that merely contains a drug name does not match", () => {
    expect(clash("Review penicillinase result.", "Penicillin")).toBe(false);
    expect(clash("Review the bactrimate note.", "Sulfa")).toBe(false);
  });

  it("an allergen the lists cannot place produces an 'allergy not checked' flag rather than silence", () => {
    const r = go("Start tazocin.", "Piperacillin rash");
    const f = r.flags.find((x) => x.kind === "allergy_not_checked");
    expect(f?.sourceId).toBe("a1");
    expect(f?.message).toMatch(/unrecognised allergen/);
    expect(f?.severity).toBe("info");
  });

  it("an unplaced allergen is still checked by its own words in the draft", () => {
    expect(clash("Start piperacillin.", "Allergic to piperacillin")).toBe(true);
    expect(clash("Allergy to be discussed.", "Allergic to piperacillin")).toBe(false);
  });

  it("allergens placed in a class or known to be non-drug do not raise 'not checked'", () => {
    const has = (allergen: string) => go("Rest.", allergen).flags.some((f) => f.kind === "allergy_not_checked");
    expect(has("Penicillin")).toBe(false);
    expect(has("Peanuts")).toBe(false);
    expect(has("Latex")).toBe(false);
    expect(has("NKDA")).toBe(false);
    expect(has("Tenofovir")).toBe(true);
  });

  it("sabotage: without the spelling alias, 'sulpha' is no longer placed (the alias is what makes it work)", () => {
    const r = checkOmissions({ ...base, draftText: "Start Septrin.", allergies: [{ id: "a1", allergen: "Sulpha" }] }, { ...FULL_RULES, spellingAliases: {} }, META);
    expect(r.flags.some((f) => f.kind === "drug_vs_allergy")).toBe(false);
    expect(r.flags.some((f) => f.kind === "allergy_not_checked")).toBe(true);
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

  it("the real lists carry the brands the review named and stay unsigned", () => {
    const r = cfg.value as unknown as OmissionRules;
    const all = Object.values(r.allergyClasses).flat();
    for (const brand of ["co-trimoxazole", "bactrim", "septrin", "amoxil", "augmentin", "clavulin"]) expect(all).toContain(brand);
    expect(cfg.status).toBe("proposed");
  });

  it("real config: 'Metformin 500 mg twice a day. Cough for 3 days.' states no follow-up interval", () => {
    const r = checkOmissions(
      { ...base, draftText: "Metformin 500 mg twice a day. Cough for 3 days.", conditions: [{ id: "c1", name: "Diabetes" }] },
      cfg.value as unknown as OmissionRules,
      { version: cfg.version, status: cfg.status },
    );
    expect(kinds(r)).toContain("no_follow_up_interval");
  });

  it("the source holds no drug class list of its own", () => {
    const src = readFileSync(new URL("./omission-check.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/amoxicillin|ibuprofen|diclofenac|metformin|hypertension"/i);
  });
});

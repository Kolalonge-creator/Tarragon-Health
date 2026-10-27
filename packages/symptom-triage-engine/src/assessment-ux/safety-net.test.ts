/**
 * S59c safety-net advice and the save-this-card text.
 */
import { describe, it, expect } from "@jest/globals";
import { SEED_PATHWAYS } from "../protocols/index";
import { TRIAGE_CATEGORIES } from "../types/index";
import { SAFETY_NET_DRAFT } from "./drafts";
import { buildSafetyNet, buildSaveCard, safetyNetConfigSchema } from "./safety-net";

const SIGNED = { ...SAFETY_NET_DRAFT, status: "signed_off", clinical_sign_off: { by: "Test CMO", at: "2026-10-22" } };
const SIGNED_WITH_NUMBER = { ...SIGNED, emergency_number: { value: "112", confirmed: true } };

describe("the shipped draft", () => {
  it("parses, is an unsigned draft, and confirms no phone number", () => {
    const parsed = safetyNetConfigSchema.parse(SAFETY_NET_DRAFT);
    expect(parsed.status).toBe("draft");
    expect(parsed.clinical_sign_off).toBeNull();
    expect(parsed.emergency_number?.confirmed).toBe(false);
  });

  it("adds no specific lines and no number while unsigned (only the generic block shows)", () => {
    for (const p of SEED_PATHWAYS) for (const c of TRIAGE_CATEGORIES) {
      expect(buildSafetyNet({ pathwayKey: p.key, category: c }, SAFETY_NET_DRAFT)).toEqual({ specific: [], emergencyNumber: null });
    }
  });

  it("only names signed pathways", () => {
    const known = new Set(SEED_PATHWAYS.map((p) => p.key));
    for (const e of SAFETY_NET_DRAFT.entries) expect(known.has(e.pathway_key)).toBe(true);
  });

  it("has no phone number inside any trigger line and no em dash", () => {
    const text = SAFETY_NET_DRAFT.entries.flatMap((e) => e.triggers).join("\n");
    expect(text).not.toMatch(/\d{3}/);
    expect(text).not.toContain("—");
  });
});

describe("signed config", () => {
  it("returns the triggers of the pathway asked about, in order, for any category the entry covers", () => {
    const out = buildSafetyNet({ pathwayKey: "chest_pain", category: "routine" }, SIGNED);
    expect(out.specific).toEqual(SAFETY_NET_DRAFT.entries.find((e) => e.pathway_key === "chest_pain")!.triggers);
    expect(buildSafetyNet({ pathwayKey: "headache", category: "self_management" }, SIGNED).specific.length).toBeGreaterThan(0);
  });

  it("returns nothing for a pathway it has no entry for", () => {
    expect(buildSafetyNet({ pathwayKey: "fever", category: "routine" }, SIGNED).specific).toEqual([]);
  });

  it("filters by category when an entry names one, and by wildcard otherwise, without repeats", () => {
    const cfg = {
      ...SIGNED,
      entries: [
        { id: "a", pathway_key: "headache", category: "urgent", triggers: ["line only for urgent"] },
        { id: "b", pathway_key: "*", category: "*", triggers: ["line for everything", "line for everything"] },
      ],
    };
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, cfg).specific).toEqual(["line for everything"]);
    expect(buildSafetyNet({ pathwayKey: "headache", category: "urgent" }, cfg).specific).toEqual(["line only for urgent", "line for everything"]);
  });

  it("shows the emergency number only when signed AND confirmed", () => {
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, SIGNED).emergencyNumber).toBeNull();
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, SIGNED_WITH_NUMBER).emergencyNumber).toBe("112");
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, { ...SAFETY_NET_DRAFT, emergency_number: { value: "112", confirmed: true } }).emergencyNumber).toBeNull();
  });

  it("refuses a number that is not a short digit string (no invented helplines)", () => {
    expect(safetyNetConfigSchema.safeParse({ ...SIGNED, emergency_number: { value: "0800-HELP", confirmed: true } }).success).toBe(false);
    expect(safetyNetConfigSchema.safeParse({ ...SIGNED, emergency_number: { value: "08031234567", confirmed: true } }).success).toBe(false);
  });

  it("malformed or unsigned config leaves only the generic block", () => {
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, { ...SIGNED, entries: [] })).toEqual({ specific: [], emergencyNumber: null });
    expect(buildSafetyNet({ pathwayKey: "headache", category: "routine" }, { ...SIGNED, clinical_sign_off: null })).toEqual({ specific: [], emergencyNumber: null });
  });
});

describe("the save card", () => {
  const parts = {
    title: "My symptom check",
    dateLine: "22 October 2026",
    complaint: "Headache",
    resultLine: "Be seen within a few days",
    nextStep: "Book a consultation or message your care team in the app.",
    safetyHeading: "Go to a hospital or call for help straight away if:",
    safetyLines: ["it gets worse quickly", "you faint"],
    notADiagnosis: "This is not a diagnosis.",
    footer: "Tarragon Health",
  };

  it("is plain text with the result, the next step and the safety lines", () => {
    const card = buildSaveCard(parts);
    expect(card.split("\n")[0]).toBe("My symptom check");
    expect(card).toContain("Be seen within a few days");
    expect(card).toContain("- it gets worse quickly");
    expect(card).toContain("This is not a diagnosis.");
    expect(card).not.toMatch(/<|>|\[|\]\(/);
  });

  it("drops empty parts without leaving blank runs", () => {
    const card = buildSaveCard({ ...parts, dateLine: null, complaint: null, nextStep: null, safetyLines: [] });
    expect(card).not.toMatch(/\n\n\n/);
    expect(card).not.toContain("null");
    expect(card).not.toContain("straight away");
  });

  it("adds nothing of its own (every line comes from the parts)", () => {
    const card = buildSaveCard(parts);
    const allowed = new Set(["", parts.title, parts.dateLine, parts.complaint, parts.resultLine, parts.nextStep, parts.safetyHeading, ...parts.safetyLines.map((l) => `- ${l}`), parts.notADiagnosis, parts.footer]);
    for (const line of card.split("\n")) expect(allowed.has(line)).toBe(true);
  });
});

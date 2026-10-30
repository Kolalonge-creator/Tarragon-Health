import { getProposedConfig } from "@tarragon/shared";
import type { OmissionRules } from "@tarragon/clinical/omission-check";
import { NO_SENSITIVE_ACCESS, type BriefRules } from "@/lib/previsit/brief";
import { RESTRICTED_CLASH_MESSAGE, RESTRICTED_UNCHECKED_MESSAGE, runOmissionCheck, type OmissionRecord } from "./run-omission-check";

const entry = getProposedConfig("copilot.omission_rules");
const omissionRules = entry.value as unknown as OmissionRules;
const briefRules = getProposedConfig("copilot.previsit_brief_rules").value as unknown as BriefRules;
const meta = { version: entry.version, status: entry.status };

const rec = (over: Partial<OmissionRecord>): OmissionRecord => ({ allergies: [], medications: [], carePlans: [], gaps: [], ...over });
const run = (draftText: string, record: OmissionRecord, access = NO_SENSITIVE_ACCESS) => runOmissionCheck({ draftText, record, access, briefRules, omissionRules, meta });
const FULL = { reproductive_health: true, mental_health: true, sensitive_positive: true };

describe("runOmissionCheck: the safety check runs on the full record (S89 review item 7)", () => {
  const hiddenAllergy = rec({ allergies: [{ id: "a1", allergen: "Tenofovir" }] });

  it("a clash with a restricted allergy shows one generic line and never names the item", () => {
    const r = run("Start tenofovir 300 mg.", hiddenAllergy);
    const f = r.flags.filter((x) => x.kind === "restricted_item");
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toBe(RESTRICTED_CLASH_MESSAGE);
    expect(JSON.stringify(r)).not.toMatch(/tenofovir/i);
    expect(r.flags.some((x) => x.kind === "drug_vs_allergy")).toBe(false);
  });

  it("sabotage: with access to that category the same draft shows the specific flag and no generic one", () => {
    const r = run("Start tenofovir 300 mg.", hiddenAllergy, FULL);
    expect(r.flags.some((x) => x.kind === "drug_vs_allergy")).toBe(true);
    expect(r.flags.some((x) => x.kind === "restricted_item")).toBe(false);
  });

  it("no clash, no generic line: a restricted allergy the draft does not touch leaves no trace", () => {
    const r = run("Continue amlodipine.", rec({ allergies: [{ id: "a1", allergen: "Sulpha" }, { id: "a2", allergen: "Hepatitis B vaccine" }] }));
    expect(r.flags.some((x) => x.kind === "restricted_item" && x.message === RESTRICTED_CLASH_MESSAGE)).toBe(false);
  });

  it("a restricted allergen the lists cannot place gets a neutral 'could not be checked' line, once", () => {
    const r = run("Rest.", rec({ allergies: [{ id: "a1", allergen: "Dolutegravir" }, { id: "a2", allergen: "Efavirenz" }] }));
    const f = r.flags.filter((x) => x.kind === "restricted_item");
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toBe(RESTRICTED_UNCHECKED_MESSAGE);
    expect(JSON.stringify(r)).not.toMatch(/dolutegravir|efavirenz/i);
  });

  it("completeness prompts about restricted items are left out of what is shown", () => {
    const r = run("Rest.", rec({
      medications: [{ id: "m1", drug_name: "Microgynon" }, { id: "m2", drug_name: "Amlodipine" }],
      gaps: [{ gap_type: "unactioned_abnormal", condition_or_type: "HIV viral load", opened_at: "2026-10-01" }],
    }));
    expect(JSON.stringify(r)).not.toMatch(/microgynon|hiv/i);
    expect(r.flags.some((f) => f.kind === "medication_not_mentioned" && f.sourceId === "m2")).toBe(true);
  });

  it("a visible allergy clash is unchanged", () => {
    const r = run("Give amoxicillin.", rec({ allergies: [{ id: "a1", allergen: "Penicillin" }] }));
    expect(r.flags.some((x) => x.kind === "drug_vs_allergy" && x.sourceId === "a1")).toBe(true);
  });

  it("never blocks signing", () => {
    expect(run("Start tenofovir.", hiddenAllergy).blocksSigning).toBe(false);
  });
});

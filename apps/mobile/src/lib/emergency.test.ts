/**
 * The emergency card is the one screen in the app that must render with zero
 * signal (MOBILE_APP_SPEC.md §6), which it does by caching the facts on every
 * successful online load. These tests cover that cache — that it is actually
 * written, that a corrupted one degrades to "no card" rather than crashing
 * the screen — and the small amount of shaping loadEmergencyFacts does.
 */
import * as SecureStore from "expo-secure-store";
import { applyEmergencyFieldChoices, loadCachedEmergencyFacts, loadEmergencyFacts } from "./emergency";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));

const CACHE_KEY = "emergency-card-cache-v1";
const mockFrom = supabase.from as unknown as jest.Mock;

/**
 * loadEmergencyFacts uses two shapes of Supabase call: some end in
 * .maybeSingle(), others are awaited directly off the builder. One thenable
 * chainable stub covers both.
 */
function table(data: unknown) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown }) => unknown) => Promise.resolve({ data }).then(resolve),
    maybeSingle: () => Promise.resolve({ data }),
  };
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function seed(overrides: Partial<Record<string, unknown>> = {}) {
  const tables: Record<string, unknown> = {
    profiles: {
      full_name: "Ada Obi",
      emergency_contact_name: "Chidi Obi",
      emergency_contact_phone: "+2348012345678",
      emergency_contact_relationship: "Brother",
    },
    patient_allergies: [{ allergen: "Penicillin", reaction: "Rash", severity: "severe" }],
    care_plans: [{ condition: "hypertension" }, { condition: "type_2_diabetes" }, { condition: "hypertension" }],
    patient_blood_profile: { blood_group: "O+", genotype: "AA" },
    ...overrides,
  };
  mockFrom.mockImplementation((name: string) => table(tables[name]));
}

describe("loadEmergencyFacts", () => {
  it("shapes the record for the card and de-duplicates conditions", async () => {
    // conditions are off by default (S47), so the person has chosen to show them here
    seed({ emergency_card_fields: { show_allergies: true, show_medications: true, show_conditions: true, show_blood: true, show_emergency_contact: true, show_reproductive: false, show_mental_health: false } });
    const facts = await loadEmergencyFacts("patient-1");

    expect(facts).toMatchObject({
      fullName: "Ada Obi",
      bloodGroup: "O+",
      genotype: "AA",
      conditions: ["hypertension", "type_2_diabetes"],
      emergencyContact: { name: "Chidi Obi", phone: "+2348012345678", relationship: "Brother" },
    });
    expect(facts.allergies).toEqual([{ allergen: "Penicillin", reaction: "Rash", severity: "severe" }]);
  });

  it("caches the facts so the card still renders with no signal", async () => {
    seed();
    const facts = await loadEmergencyFacts("patient-1");

    // The cache write is fire-and-forget inside loadEmergencyFacts.
    await Promise.resolve();
    expect(JSON.parse((await SecureStore.getItemAsync(CACHE_KEY)) ?? "null")).toEqual(facts);
    await expect(loadCachedEmergencyFacts()).resolves.toEqual(facts);
  });

  it("returns a null contact rather than a half-filled one when no name is on file", async () => {
    seed({ profiles: { full_name: "Ada Obi", emergency_contact_phone: "+2348012345678" } });
    await expect(loadEmergencyFacts("patient-1")).resolves.toMatchObject({ emergencyContact: null });
  });

  it("copes with a patient who has no allergies, conditions or blood profile recorded", async () => {
    seed({ patient_allergies: null, care_plans: null, patient_blood_profile: null });
    await expect(loadEmergencyFacts("patient-1")).resolves.toMatchObject({
      allergies: [],
      conditions: [],
      bloodGroup: null,
      genotype: null,
    });
  });
});

describe("loadCachedEmergencyFacts", () => {
  it("returns null before anything has ever been cached", async () => {
    await expect(loadCachedEmergencyFacts()).resolves.toBeNull();
  });

  it("degrades to null on a corrupted cache instead of throwing on the emergency screen", async () => {
    await SecureStore.setItemAsync(CACHE_KEY, "{ truncated");
    await expect(loadCachedEmergencyFacts()).resolves.toBeNull();
  });
});

describe("the person's chosen card fields (S43)", () => {
  const CHOICES = { show_allergies: true, show_medications: false, show_conditions: false, show_blood: true, show_emergency_contact: false };

  it("hides what was not chosen, on the screen and in the offline cache", async () => {
    seed({ emergency_card_fields: CHOICES });
    const facts = await loadEmergencyFacts("patient-1");
    expect(facts.allergies).toHaveLength(1);
    expect(facts.bloodGroup).toBe("O+");
    expect(facts.conditions).toEqual([]);
    expect(facts.medications).toEqual([]);
    expect(facts.emergencyContact).toBeNull();
    const cached = JSON.parse((await SecureStore.getItemAsync(CACHE_KEY)) ?? "null");
    expect(cached.conditions).toEqual([]);
    expect(cached.emergencyContact).toBeNull();
  });

  it("with no choice made the DEFAULTS apply: blood, allergies, medicines and the contact shown; conditions, reproductive and mental health not shared (S47)", async () => {
    seed();
    const facts = await loadEmergencyFacts("patient-1");
    expect(facts.conditions).toEqual([]);
    expect(facts.emergencyContact).not.toBeNull();
    expect(facts.bloodGroup).toBe("O+");
    expect(facts.allergies).toHaveLength(1);
    expect(facts.medications).toEqual([]);   // this fixture has none; the field is shown, not hidden
    expect(facts.hidden).not.toContain("medications");
    expect(facts.hidden).toEqual(["conditions", "reproductive", "mental_health"]);
    const cached = JSON.parse((await SecureStore.getItemAsync(CACHE_KEY)) ?? "null");
    expect(cached.conditions).toEqual([]);
    expect(cached.hidden).toEqual(["conditions", "reproductive", "mental_health"]);
  });

  it("a shown conditions list still drops a reproductive or mental health entry unless its own switch is on", () => {
    const facts = { fullName: "Ada", bloodGroup: null, genotype: null, allergies: [], conditions: ["hypertension", "major depression", "pregnancy"], medications: [], emergencyContact: null, cachedAt: "t" };
    const shown = { ...CHOICES, show_conditions: true };
    expect(applyEmergencyFieldChoices(facts, shown).conditions).toEqual(["hypertension"]);
    expect(applyEmergencyFieldChoices(facts, { ...shown, show_reproductive: true }).conditions).toEqual(["hypertension", "pregnancy"]);
    expect(applyEmergencyFieldChoices(facts, { ...shown, show_mental_health: true }).conditions).toEqual(["hypertension", "major depression"]);
  });

  it("records which details were hidden so the card can say not shared instead of none", async () => {
    seed({ emergency_card_fields: CHOICES });
    const facts = await loadEmergencyFacts("patient-1");
    expect(facts.hidden).toEqual(["medications", "conditions", "emergency_contact", "reproductive", "mental_health"]);
    const cached = JSON.parse((await SecureStore.getItemAsync(CACHE_KEY)) ?? "null");
    expect(cached.hidden).toEqual(["medications", "conditions", "emergency_contact", "reproductive", "mental_health"]);
  });

  it("applyEmergencyFieldChoices keeps the name and never mutates its input", () => {
    const facts = { fullName: "Ada", bloodGroup: "O+", genotype: "AA", allergies: [], conditions: ["x"], medications: [], emergencyContact: null, cachedAt: "t" };
    const out = applyEmergencyFieldChoices(facts, { ...CHOICES, show_blood: false });
    expect(out.fullName).toBe("Ada");
    expect(out.bloodGroup).toBeNull();
    expect(out.genotype).toBeNull();
    expect(facts.bloodGroup).toBe("O+");
  });
});

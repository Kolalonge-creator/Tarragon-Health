/**
 * The emergency card is the one screen in the app that must render with zero
 * signal (MOBILE_APP_SPEC.md §6), which it does by caching the facts on every
 * successful online load. These tests cover that cache — that it is actually
 * written, that a corrupted one degrades to "no card" rather than crashing
 * the screen — and the small amount of shaping loadEmergencyFacts does.
 */
import * as SecureStore from "expo-secure-store";
import { loadCachedEmergencyFacts, loadEmergencyFacts } from "./emergency";
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
    seed();
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

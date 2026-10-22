import { EMERGENCY_DEFAULT_CHOICES, EMERGENCY_MINIMAL_CHOICES } from "@tarragon/shared";
import { loadCardChoices, saveCardChoices } from "./emergency-card-choices";
import { DEFAULT_EMERGENCY_FIELD_CHOICES } from "./emergency";

let mockRow: Record<string, unknown> | null = null;
let mockError: { code?: string; message: string } | null = null;
const mockUpserts: { row: Record<string, unknown>; opts: unknown }[] = [];
let mockCols = "";

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: () => ({
      select: (cols: string) => {
        mockCols = cols;
        const q: Record<string, unknown> = { eq: () => q, maybeSingle: async () => (mockError ? { data: null, error: mockError } : { data: mockRow, error: null }) };
        return q;
      },
      upsert: async (row: Record<string, unknown>, opts: unknown) => {
        mockUpserts.push({ row, opts });
        return { error: mockError };
      },
    }),
  },
}));

beforeEach(() => {
  mockRow = null;
  mockError = null;
  mockUpserts.length = 0;
});

describe("emergency card choices on the phone (S43m)", () => {
  it("no row means the defaults, not an error", async () => {
    expect(await loadCardChoices("user-1")).toEqual({ ok: true, choices: EMERGENCY_DEFAULT_CHOICES });
  });

  it("reads all eleven columns and maps them", async () => {
    mockRow = { show_date_of_birth: false, show_sex: false, show_patient_number: false, show_allergies: true, show_medications: false, show_conditions: false, show_blood: true, show_emergency_contact: true, show_reproductive: false, show_mental_health: false, lock_screen_opt_in: false };
    expect(await loadCardChoices("user-1")).toEqual({ ok: true, choices: EMERGENCY_MINIMAL_CHOICES });
    expect(mockCols.split(", ")).toHaveLength(11);
  });

  it("a failed read is a failure, never a card with the defaults silently applied", async () => {
    mockError = { message: "Network request failed" };
    expect(await loadCardChoices("user-1")).toEqual({ ok: false, reason: "offline" });
    mockError = { code: "500", message: "boom" };
    expect(await loadCardChoices("user-1")).toEqual({ ok: false, reason: "failed" });
  });

  it("saves one row keyed on the person, with their organisation", async () => {
    expect(await saveCardChoices("user-1", "org-1", EMERGENCY_MINIMAL_CHOICES)).toEqual({ ok: true });
    expect(mockUpserts[0].opts).toEqual({ onConflict: "patient_id" });
    expect(mockUpserts[0].row).toMatchObject({ patient_id: "user-1", organisation_id: "org-1", show_blood: true, show_conditions: false, show_mental_health: false, lock_screen_opt_in: false });
  });

  it("a failed save says so", async () => {
    mockError = { message: "Network request failed" };
    expect(await saveCardChoices("user-1", "org-1", EMERGENCY_DEFAULT_CHOICES)).toEqual({ ok: false, reason: "offline" });
  });

  it("the phone card's own defaults match the shared ones (so the card and the chooser start from the same place)", () => {
    expect(DEFAULT_EMERGENCY_FIELD_CHOICES).toEqual({
      show_allergies: EMERGENCY_DEFAULT_CHOICES.allergies,
      show_medications: EMERGENCY_DEFAULT_CHOICES.medications,
      show_conditions: EMERGENCY_DEFAULT_CHOICES.conditions,
      show_blood: EMERGENCY_DEFAULT_CHOICES.blood,
      show_emergency_contact: EMERGENCY_DEFAULT_CHOICES.emergency_contact,
      show_reproductive: EMERGENCY_DEFAULT_CHOICES.reproductive,
      show_mental_health: EMERGENCY_DEFAULT_CHOICES.mental_health,
    });
  });
});

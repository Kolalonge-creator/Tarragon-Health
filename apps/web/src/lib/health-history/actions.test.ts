jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getCurrentUser = jest.fn();
const insert = jest.fn();
const rpc = jest.fn();
const tables: string[] = [];
jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: () => getCurrentUser(),
  createClient: async () => ({
    from: (table: string) => {
      tables.push(table);
      if (table === "profiles") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { organisation_id: "org-1" } }) }) }) };
      return { insert: (row: unknown) => insert(table, row) };
    },
    rpc: (...args: unknown[]) => rpc(...args),
  }),
}));

import { addFamilyHistoryAction, addProcedureAction, removeHistoryItemAction } from "./actions";
import { familyHistoryInputSchema, procedureInputSchema } from "./schemas";

beforeEach(() => {
  tables.length = 0;
  getCurrentUser.mockReset().mockResolvedValue({ id: "p1" });
  insert.mockReset().mockResolvedValue({ error: null });
  rpc.mockReset().mockResolvedValue({ data: { removed: true }, error: null });
});

describe("addProcedureAction", () => {
  it("inserts for the signed-in person only, and sends no source or verification of its own", async () => {
    expect(await addProcedureAction({ name: " Appendicectomy ", year: "2012", facility: "Lagos hospital" })).toEqual({ success: true });
    const [table, row] = insert.mock.calls[0] as [string, Record<string, unknown>];
    expect(table).toBe("procedures");
    expect(row).toEqual({ organisation_id: "org-1", patient_id: "p1", name: "Appendicectomy", approximate_year: 2012, facility: "Lagos hospital" });
    expect(row).not.toHaveProperty("source");
    expect(row).not.toHaveProperty("verified_by_clinician");
    expect(row).not.toHaveProperty("recorded_by");
  });

  it("refuses an empty name, a future year and a signed-out caller", async () => {
    expect(await addProcedureAction({ name: "  " })).toMatchObject({ error: expect.any(String) });
    expect(await addProcedureAction({ name: "x", year: String(new Date().getFullYear() + 1) })).toMatchObject({ error: expect.any(String) });
    getCurrentUser.mockResolvedValue(null);
    expect(await addProcedureAction({ name: "x" })).toEqual({ error: "Not signed in" });
    expect(insert).not.toHaveBeenCalled();
  });

  it("shows a plain message when the database refuses", async () => {
    insert.mockResolvedValue({ error: { message: "rls" } });
    expect(await addProcedureAction({ name: "x" })).toEqual({ error: "That could not be saved. Please try again." });
  });
});

describe("addFamilyHistoryAction", () => {
  it("inserts a family history row for the signed-in person", async () => {
    expect(await addFamilyHistoryAction({ condition: "Diabetes", relationship: "mother", onsetAge: "50" })).toEqual({ success: true });
    expect(insert).toHaveBeenCalledWith("family_history", { organisation_id: "org-1", patient_id: "p1", condition_name: "Diabetes", relationship: "mother", age_of_onset_years: 50 });
  });
  it("refuses an unknown relative and an impossible age", async () => {
    expect(await addFamilyHistoryAction({ condition: "x", relationship: "neighbour" })).toMatchObject({ error: expect.any(String) });
    expect(await addFamilyHistoryAction({ condition: "x", relationship: "father", onsetAge: "200" })).toMatchObject({ error: expect.any(String) });
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("removeHistoryItemAction", () => {
  it("goes through the tombstoning function, never a delete", async () => {
    const id = "22222222-2222-4222-8222-222222222222";
    expect(await removeHistoryItemAction({ kind: "procedure", id })).toEqual({ success: true });
    expect(rpc).toHaveBeenCalledWith("remove_history_item", { p_kind: "procedure", p_id: id });
    expect(tables).not.toContain("procedures");
  });
  it("refuses a bad kind or id before the database", async () => {
    expect(await removeHistoryItemAction({ kind: "medication", id: "x" })).toEqual({ error: "That could not be removed." });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("schemas", () => {
  it("coerce form strings and keep optional fields optional", () => {
    expect(procedureInputSchema.parse({ name: "x" })).toEqual({ name: "x" });
    expect(familyHistoryInputSchema.parse({ condition: "x", relationship: "other" })).toEqual({ condition: "x", relationship: "other" });
  });
});

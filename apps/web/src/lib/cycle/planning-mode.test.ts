import { readPlanningMode } from "./planning-mode";

type Result = { data: { planning_pregnancy_mode?: boolean | null } | null; error: { message: string } | null };

/** The minimal slice of the Supabase client the reader uses. */
function clientReturning(result: Result | Error) {
  const maybeSingle = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { client: { from } as unknown as Parameters<typeof readPlanningMode>[0], from, select, eq };
}

describe("readPlanningMode: off is the safe state (S85 D2)", () => {
  it("reads only the one column, for only this patient, on its own", async () => {
    const { client, from, select, eq } = clientReturning({ data: { planning_pregnancy_mode: true }, error: null });
    await readPlanningMode(client, "p1");
    expect(from).toHaveBeenCalledWith("reproductive_health_profiles");
    expect(select).toHaveBeenCalledWith("planning_pregnancy_mode");
    expect(eq).toHaveBeenCalledWith("patient_id", "p1");
  });

  it("is on only for a real true", async () => {
    expect(await readPlanningMode(clientReturning({ data: { planning_pregnancy_mode: true }, error: null }).client, "p")).toBe(true);
  });

  it.each([
    ["no profile row yet", { data: null, error: null }],
    ["a false", { data: { planning_pregnancy_mode: false }, error: null }],
    ["a null", { data: { planning_pregnancy_mode: null }, error: null }],
    ["a missing column (the migration is not applied yet)", { data: null, error: { message: "column does not exist" } }],
    ["a column absent from the row", { data: {}, error: null }],
  ] satisfies [string, Result][])("is off for %s", async (_name, result) => {
    expect(await readPlanningMode(clientReturning(result).client, "p")).toBe(false);
  });

  it("is off when the read throws", async () => {
    expect(await readPlanningMode(clientReturning(new Error("network")).client, "p")).toBe(false);
  });
});

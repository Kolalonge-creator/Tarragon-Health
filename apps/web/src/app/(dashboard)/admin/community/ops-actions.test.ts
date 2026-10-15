const mockRpc = jest.fn();
const mockRevalidate = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc: mockRpc })) }));
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => mockRevalidate(p) }));

import { cancelQaAction, createQaAction, setGroupImagesAction, setShiftsAction } from "./ops-actions";

const G = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const D1 = "44444444-4444-4444-8444-444444444444";
const D2 = "55555555-5555-4555-8555-555555555555";
const GENERIC = "That could not be done. Please try again.";

function form(entries: Array<[string, string]>): FormData {
  const f = new FormData();
  for (const [k, v] of entries) f.append(k, v);
  return f;
}
/** A Lagos time `hours` from now, as the datetime-local input would send it (Lagos is UTC+1 all year). */
function lagos(hours: number): string {
  return new Date(Date.now() + hours * 3600_000 + 3600_000).toISOString().slice(0, 16);
}

beforeEach(() => {
  mockRpc.mockReset();
  mockRevalidate.mockReset();
});

describe("setGroupImagesAction", () => {
  it("turns pictures on and says they wait for a moderator", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", images_allowed: true }, error: null });
    const r = await setGroupImagesAction(undefined, form([["id", G], ["on", "on"]]));
    expect(r?.ok).toBe(true);
    expect(r?.message).toMatch(/waits for a moderator/);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_set_group_images", { p_id: G, p_on: true });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/groups");
  });
  it("turns pictures off", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", images_allowed: false }, error: null });
    await setGroupImagesAction(undefined, form([["id", G], ["on", "off"]]));
    expect(mockRpc).toHaveBeenCalledWith("community_admin_set_group_images", { p_id: G, p_on: false });
  });
  it("gives the plain refusal for a weight-loss group", async () => {
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "not_for_this_topic" }, error: null });
    const r = await setGroupImagesAction(undefined, form([["id", G], ["on", "on"]]));
    expect(r).toEqual({ ok: false, message: "Pictures cannot be turned on for a weight-loss group." });
    expect(mockRevalidate).not.toHaveBeenCalled();
  });
  it("rejects bad input before any call", async () => {
    expect((await setGroupImagesAction(undefined, form([["id", "x"], ["on", "on"]])))?.ok).toBe(false);
    expect((await setGroupImagesAction(undefined, form([["id", G], ["on", "maybe"]])))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("never shows database text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "XX000", message: "permission denied for table community_groups" } });
    expect(await setGroupImagesAction(undefined, form([["id", G], ["on", "on"]]))).toEqual({ ok: false, message: GENERIC });
  });
});

describe("setShiftsAction", () => {
  const shifts = JSON.stringify([{ weekday: 0, start_hour: 22, end_hour: 24 }, { weekday: 1, start_hour: 0, end_hour: 6 }]);
  it("saves the shifts as given", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", shifts: 2 }, error: null });
    const r = await setShiftsAction(undefined, form([["staff_id", S], ["shifts", shifts]]));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_set_shifts", {
      p_staff_id: S,
      p_shifts: [{ weekday: 0, start_hour: 22, end_hour: 24 }, { weekday: 1, start_hour: 0, end_hour: 6 }],
    });
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/rota");
  });
  it("allows an empty list to clear a person's shifts", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", shifts: 0 }, error: null });
    const r = await setShiftsAction(undefined, form([["staff_id", S], ["shifts", "[]"]]));
    expect(r?.message).toMatch(/cleared/);
  });
  it.each([
    ["a day above Sunday", [{ weekday: 7, start_hour: 0, end_hour: 8 }]],
    ["a start of 24", [{ weekday: 0, start_hour: 24, end_hour: 24 }]],
    ["an end of 0", [{ weekday: 0, start_hour: 0, end_hour: 0 }]],
    ["an end above 24", [{ weekday: 0, start_hour: 0, end_hour: 25 }]],
    ["an end that is not after the start", [{ weekday: 0, start_hour: 10, end_hour: 10 }]],
    ["a shift that crosses midnight", [{ weekday: 0, start_hour: 22, end_hour: 6 }]],
    ["part hours", [{ weekday: 0, start_hour: 8.5, end_hour: 12 }]],
  ])("rejects %s before any call", async (_name, rows) => {
    const r = await setShiftsAction(undefined, form([["staff_id", S], ["shifts", JSON.stringify(rows)]]));
    expect(r?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("rejects more than 100 shifts, a bad id, and text that is not a list", async () => {
    const many = JSON.stringify(Array.from({ length: 101 }, () => ({ weekday: 0, start_hour: 0, end_hour: 1 })));
    expect((await setShiftsAction(undefined, form([["staff_id", S], ["shifts", many]])))?.ok).toBe(false);
    expect((await setShiftsAction(undefined, form([["staff_id", "x"], ["shifts", "[]"]])))?.ok).toBe(false);
    expect((await setShiftsAction(undefined, form([["staff_id", S], ["shifts", "{nope"]])))?.ok).toBe(false);
    expect((await setShiftsAction(undefined, form([["staff_id", S], ["shifts", "{}"]])))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("turns the database's refusal into plain English", async () => {
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "bad_shifts" }, error: null });
    const r = await setShiftsAction(undefined, form([["staff_id", S], ["shifts", shifts]]));
    expect(r?.message).toMatch(/overnight shift add two rows/);
  });
  it("says a permission problem calmly, without database text", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: "42501", message: "admins and the Chief Medical Officer only" } });
    const r = await setShiftsAction(undefined, form([["staff_id", S], ["shifts", shifts]]));
    expect(r).toEqual({ ok: false, message: "Only an admin can do that." });
  });
});

describe("createQaAction", () => {
  const good = (): Array<[string, string]> => [
    ["title", "  Ask a doctor about blood pressure "],
    ["intro", "Text only."],
    ["opens_at", lagos(1)],
    ["closes_at", lagos(3)],
    ["doctor_ids", D1],
    ["group_ids", G],
  ];
  it("creates the session from ticked doctors and groups, converting Lagos time to UTC", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok", series_id: S }, error: null });
    const entries = good();
    const r = await createQaAction(undefined, form(entries));
    expect(r?.ok).toBe(true);
    const [fn, args] = mockRpc.mock.calls[0] as [string, Record<string, unknown>];
    expect(fn).toBe("community_admin_create_qa");
    expect(args.p_title).toBe("Ask a doctor about blood pressure");
    expect(args.p_doctor_ids).toEqual([D1]);
    expect(args.p_group_ids).toEqual([G]);
    expect(new Date(args.p_opens_at as string).toISOString()).toBe(new Date(`${entries[2][1]}:00+01:00`).toISOString());
    expect(mockRevalidate).toHaveBeenCalledWith("/admin/community/sessions");
  });
  it("joins ticked and pasted doctor ids without duplicates", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    await createQaAction(undefined, form([...good(), ["doctor_ids_pasted", `${D1}, ${D2}\\n`.replace("\\n", "\n")]]));
    expect((mockRpc.mock.calls[0][1] as Record<string, unknown>).p_doctor_ids).toEqual([D1, D2]);
  });
  it("rejects a window over 12 hours, an end before the start, and a start in the past", async () => {
    const swap = (k: string, v: string) => good().map(([a, b]): [string, string] => (a === k ? [a, v] : [a, b]));
    expect((await createQaAction(undefined, form(swap("closes_at", lagos(14)))))?.message).toMatch(/up to 12 hours/);
    expect((await createQaAction(undefined, form(swap("closes_at", lagos(0)))))?.ok).toBe(false);
    expect((await createQaAction(undefined, form(swap("opens_at", lagos(-3)))))?.message).toMatch(/past/);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("rejects a short title, a long intro, no doctors, no groups and bad ids", async () => {
    const without = (k: string) => good().filter(([a]) => a !== k);
    const swap = (k: string, v: string) => good().map(([a, b]): [string, string] => (a === k ? [a, v] : [a, b]));
    expect((await createQaAction(undefined, form(swap("title", "ab"))))?.ok).toBe(false);
    expect((await createQaAction(undefined, form(swap("title", "x".repeat(81)))))?.ok).toBe(false);
    expect((await createQaAction(undefined, form(swap("intro", "x".repeat(301)))))?.ok).toBe(false);
    expect((await createQaAction(undefined, form(without("doctor_ids"))))?.message).toBe("Pick at least one doctor.");
    expect((await createQaAction(undefined, form(without("group_ids"))))?.message).toBe("Pick at least one group.");
    expect((await createQaAction(undefined, form(swap("doctor_ids", "not-an-id"))))?.ok).toBe(false);
    expect((await createQaAction(undefined, form(swap("opens_at", ""))))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("turns each database refusal into plain English", async () => {
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "not_a_doctor" }, error: null });
    expect((await createQaAction(undefined, form(good())))?.message).toBe("Only active doctors can be named on a question session.");
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "something_new" }, error: null });
    expect((await createQaAction(undefined, form(good())))?.message).toBe(GENERIC);
  });
});

describe("cancelQaAction", () => {
  it("cancels one session", async () => {
    mockRpc.mockResolvedValue({ data: { status: "ok" }, error: null });
    const r = await cancelQaAction(undefined, form([["series_id", S]]));
    expect(r?.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("community_admin_cancel_qa", { p_series_id: S });
  });
  it("rejects a bad id and reports not found calmly", async () => {
    expect((await cancelQaAction(undefined, form([["series_id", "x"]])))?.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
    mockRpc.mockResolvedValue({ data: { status: "refused", reason: "not_found" }, error: null });
    expect((await cancelQaAction(undefined, form([["series_id", S]])))?.message).toMatch(/could not be found/);
  });
});

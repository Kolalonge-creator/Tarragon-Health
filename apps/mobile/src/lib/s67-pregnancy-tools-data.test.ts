/** S67 follow-up (OQ-346): the phone's guard check, birth plan, week card and schedule. Logic only; screens are not rendered here. */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { loadBirthPlanState, loadSchedule, loadWeekCard, maternalGuardOpen, saveBirthPlan, readCachedBirthPlan } from "./pregnancy-tools-data";
import type { BirthPlanFields } from "./pregnancy-payloads";

const mockEnqueue = jest.fn(async (input: unknown) => {
  void input;
  return {};
});
jest.mock("./outbox", () => ({ enqueue: (input: unknown) => mockEnqueue(input) }));

const mockStore = new Map<string, string>();
jest.mock("./secure-db", () => ({
  __resetStoreForTests: () => {},
  getStoreWithSchema: async () => ({
    getFirstAsync: async (_sql: string, params: string[]) => (mockStore.has(params[0]!) ? { value: mockStore.get(params[0]!), v: mockStore.get(params[0]!) } : null),
    runAsync: async (sql: string, params: string[]) => {
      if (/^\s*delete/i.test(sql)) mockStore.delete(params[0]!);
      else mockStore.set(params[0]!, params[1]!);
    },
  }),
}));

interface Reply { data: unknown; error: { message?: string } | null }
let mockTables: Record<string, Reply> = {};
let mockRpc: Reply | "throw" = { data: true, error: null };
jest.mock("./supabase", () => {
  const chain = (table: string) => {
    const reply = () => mockTables[table] ?? { data: null, error: { message: "offline" } };
    const c: Record<string, unknown> = {
      select: () => c,
      eq: () => c,
      order: () => c,
      maybeSingle: async () => reply(),
      then: (resolve: (v: Reply) => unknown) => resolve(reply()),
    };
    return c;
  };
  return {
    supabase: {
      from: (table: string) => chain(table),
      rpc: async () => {
        if (mockRpc === "throw") throw new Error("offline");
        return mockRpc;
      },
    },
  };
});

const PLAN: BirthPlanFields = {
  place_of_birth: "General Hospital", transport_plan: null, money_plan_kobo: 5_000_000, money_plan_note: null, blood_donor_name: null,
  blood_donor_phone: null, escort_name: "Ada", escort_phone: "+2348031234567", long_journey: true, previous_fast_labour: false, previous_births: 1,
};

beforeEach(async () => {
  mockEnqueue.mockClear();
  mockStore.clear();
  mockTables = {};
  mockRpc = { data: true, error: null };
  // jest.setup.ts resets AsyncStorage between tests.
});

describe("maternal_enabled guard on the phone", () => {
  it("is open when the server says so, and remembers it", async () => {
    expect(await maternalGuardOpen("p1")).toBe(true);
    mockRpc = "throw";
    expect(await maternalGuardOpen("p1")).toBe(true);
  });
  it("is closed when the server says no, and a 'no' replaces the remembered 'yes'", async () => {
    expect(await maternalGuardOpen("p1")).toBe(true);
    mockRpc = { data: false, error: null };
    expect(await maternalGuardOpen("p1")).toBe(false);
    mockRpc = "throw";
    expect(await maternalGuardOpen("p1")).toBe(false);
  });
  it("keeps the remembered answer in the encrypted store, never in plain AsyncStorage, and moves an old plain copy across", async () => {
    await maternalGuardOpen("p1");
    expect(await AsyncStorage.getItem("@tarragon/maternal-guard/v1:p1")).toBeNull();
    expect(mockStore.get("maternal-guard:p1")).toBe("1");
    mockStore.clear();
    await AsyncStorage.setItem("@tarragon/maternal-guard/v1:legacy", "1");
    mockRpc = "throw";
    expect(await maternalGuardOpen("legacy")).toBe(true);
    expect(await AsyncStorage.getItem("@tarragon/maternal-guard/v1:legacy")).toBeNull();
    expect(mockStore.get("maternal-guard:legacy")).toBe("1");
  });

  it("fails closed with no earlier answer and no signal", async () => {
    mockRpc = "throw";
    expect(await maternalGuardOpen("never-seen")).toBe(false);
    mockRpc = { data: null, error: { message: "boom" } };
    expect(await maternalGuardOpen("never-seen")).toBe(false);
  });
});

describe("birth plan on the phone", () => {
  it("saves to the phone first, then queues one outbox row (not danger); money stays a kobo note", async () => {
    await saveBirthPlan({ subjectId: "p1", organisationId: "o1", pregnancyId: "preg-1", plan: PLAN, nowMs: 1000 });
    expect((await readCachedBirthPlan("p1"))?.plan).toEqual(PLAN);
    expect(mockEnqueue).toHaveBeenCalledTimes(1);
    const arg = mockEnqueue.mock.calls[0]![0] as { kind: string; danger: boolean; payload: { pregnancy_id: string; plan: Record<string, unknown> } };
    expect(arg).toMatchObject({ kind: "birth_plan", danger: false, payload: { pregnancy_id: "preg-1" } });
    expect(Object.keys(arg.payload.plan).some((k) => /balance|wallet|topup/i.test(k))).toBe(false);
  });

  it("reads the server copy and refreshes the phone's copy when online", async () => {
    mockTables = { pregnancies: { data: { id: "preg-1" }, error: null }, birth_plans: { data: PLAN, error: null } };
    const s = await loadBirthPlanState("p1", "o1", 5, false);
    expect(s).toEqual({ pregnancyId: "preg-1", plan: PLAN, fromCache: false });
    expect((await readCachedBirthPlan("p1"))?.pregnancyId).toBe("preg-1");
  });

  it("opens from the phone's copy with no signal", async () => {
    await saveBirthPlan({ subjectId: "p1", organisationId: "o1", pregnancyId: "preg-1", plan: PLAN, nowMs: 1 });
    mockTables = {}; // every table now errors
    expect(await loadBirthPlanState("p1", "o1", 9, false)).toEqual({ pregnancyId: "preg-1", plan: PLAN, fromCache: true, loadFailed: false });
  });

  it("keeps the newer plan saved offline while the outbox still holds it", async () => {
    await saveBirthPlan({ subjectId: "p1", organisationId: "o1", pregnancyId: "preg-1", plan: PLAN, nowMs: 1 });
    mockTables = { pregnancies: { data: { id: "preg-1" }, error: null }, birth_plans: { data: { ...PLAN, place_of_birth: "Older value" }, error: null } };
    const s = await loadBirthPlanState("p1", "o1", 9, true);
    expect(s.plan?.place_of_birth).toBe("General Hospital");
  });

  it("has no plan and no pregnancy id when nothing is recorded and nothing is cached", async () => {
    mockTables = { pregnancies: { data: null, error: null } };
    expect(await loadBirthPlanState("p1", "o1", 9, false)).toEqual({ pregnancyId: null, plan: null, fromCache: false });
  });

  it("does not return the cached pregnancy or plan as live when the server says there is no active pregnancy, and clears them", async () => {
    await saveBirthPlan({ subjectId: "p1", organisationId: "o1", pregnancyId: "preg-1", plan: PLAN, nowMs: 1 });
    mockTables = { pregnancies: { data: null, error: null } };
    expect(await loadBirthPlanState("p1", "o1", 9, false)).toEqual({ pregnancyId: null, plan: null, fromCache: false });
    expect(await readCachedBirthPlan("p1")).toBeNull();
  });

  it("says the plan could not be loaded when there is no signal and nothing on the phone (the standard guide is in use)", async () => {
    mockTables = {};
    expect(await loadBirthPlanState("p1", "o1", 9, false)).toEqual({ pregnancyId: null, plan: null, fromCache: false, loadFailed: true });
  });
});

describe("week card and schedule", () => {
  it("is coming-soon with no signal or no row, and never shows a draft", async () => {
    expect(await loadWeekCard(30)).toEqual({ kind: "coming_soon", week: 30 });
    mockTables = { pregnancy_content: { data: [{ kind: "week", week: 30, title: "t", body_text: "invented", review_state: "draft_pending_cmo", version: 1 }], error: null } };
    expect(await loadWeekCard(30)).toEqual({ kind: "coming_soon", week: 30 });
  });
  it("shows a reviewed row, and asks for dating when the week is unknown", async () => {
    mockTables = { pregnancy_content: { data: [{ kind: "week", week: 30, title: "Hello", body_text: "Body", review_state: "cmo_reviewed", version: 1 }], error: null } };
    expect(await loadWeekCard(30)).toEqual({ kind: "content", week: 30, title: "Hello", body: "Body" });
    expect(await loadWeekCard(null)).toEqual({ kind: "unknown_week" });
  });
  it("lists the generated visits, empty with no signal", async () => {
    expect(await loadSchedule("p1")).toEqual([]);
    mockTables = { antenatal_visits: { data: [{ id: "a", visit_number: 1, target_week: 12, gestational_week_at_visit: null, status: "scheduled", appointment_id: "appt-1" }], error: null } };
    const entry = (await loadSchedule("p1"))[0]!;
    expect(entry).toMatchObject({ id: "a", status: "scheduled", booked: true });
    expect("overdue" in entry).toBe(false); // no invented lateness rule
  });
});

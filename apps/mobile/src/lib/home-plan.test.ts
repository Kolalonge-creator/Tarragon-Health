import { getProposedConfig } from "@tarragon/shared";
import { loadHomePlan } from "./home-plan";

const VALUE = getProposedConfig("today.home_cards").value as Record<string, unknown>;
let mockRpc: { data: unknown; error: { message: string } | null } | "throw" = { data: null, error: null };
let mockStore: Record<string, string> = {};
let mockServerAnswer: unknown = null;

const query = (data: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ["select", "eq", "gte", "in", "is", "order", "limit"]) q[m] = () => q;
  q["then"] = (resolve: (r: unknown) => void) => resolve({ data, error: null });
  return q;
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  __esModule: true,
  default: {
    getItem: async (k: string) => mockStore[k] ?? null,
    setItem: async (k: string, v: string) => {
      mockStore[k] = v;
    },
  },
}));
jest.mock("./supabase", () => ({
  supabase: {
    rpc: async () => {
      if (mockRpc === "throw") throw new Error("offline");
      return mockRpc;
    },
    from: (table: string) => query(table === "wearable_connections" ? [] : table === "vitals_readings" ? [{ taken_at: "2026-10-21T08:00:00Z" }] : []),
  },
}));
jest.mock("./api", () => ({
  getWeeklyCards: async () => null,
  postTodayBuild: async () => mockServerAnswer,
}));
jest.mock("./today", () => ({
  loadToday: async () => ({
    list: { open: [], shownOpen: [], moreCount: 0, done: [], total: 0 },
    partial: false,
    fromPhone: false,
    bpLoggedToday: false,
    bpHistory: true,
  }),
}));
jest.mock("./lifestyle-trackers", () => ({ loadActivityState: async () => ({ ok: true, data: { week: { activeMinutes: 10, goalMinutes: 150, daysStepGoalMet: 0 } } }) }));
jest.mock("./learning-centre", () => ({ loadWeeklyLesson: async () => ({ code: "L1" }) }));
jest.mock("./vitals", () => ({ loadRecentBpReadings: async () => [] }));

beforeEach(() => {
  mockRpc = { data: null, error: null };
  mockStore = {};
  mockServerAnswer = null;
});

describe("loadHomePlan", () => {
  it("keeps the ordinary list for another person's account", async () => {
    mockRpc = { data: { version: 1, config: VALUE }, error: null };
    expect(await loadHomePlan("a", "b")).toBeNull();
  });

  it("keeps the ordinary list while the configuration is unsigned", async () => {
    expect(await loadHomePlan("a", "a")).toBeNull();
  });

  it("asks the server when this build cannot read the signed configuration, and keeps the ordinary list if that fails too", async () => {
    mockRpc = { data: { version: 1, config: { max_primary_actions: 9 } }, error: null };
    expect(await loadHomePlan("a", "a")).toBeNull();
    const plan = { configVersion: 2, primary: [{ code: "readings", state: "action", urgent: false }], secondary: [], hidden: [] };
    mockServerAnswer = { state: "ready", plan };
    const viaServer = await loadHomePlan("a", "a");
    expect(viaServer?.plan).toEqual(plan);
    mockServerAnswer = { state: "hidden" };
    expect(await loadHomePlan("a", "a")).toBeNull();
  });

  it("builds a plan once signed, never with more than two main actions", async () => {
    mockRpc = { data: { version: 1, config: VALUE }, error: null };
    const plan = await loadHomePlan("a", "a", Date.parse("2026-10-21T10:00:00Z"));
    expect(plan).not.toBeNull();
    expect(plan!.plan.primary.length).toBeLessThanOrEqual(2);
    expect(plan!.plan.primary.map((p) => p.code)).toEqual(["readings", "goal"]);
    expect(plan!.streak?.todayDone).toBe(true);
    expect(plan!.readiness).toEqual({ kind: "none", reason: "no_device" });
  });

  it("remembers the last signed configuration for a phone with no signal, and forgets a withdrawn one", async () => {
    mockRpc = { data: { version: 1, config: VALUE }, error: null };
    await loadHomePlan("a", "a");
    mockRpc = "throw";
    expect(await loadHomePlan("a", "a")).not.toBeNull();
    mockRpc = { data: null, error: null };
    expect(await loadHomePlan("a", "a")).toBeNull();
    mockRpc = "throw";
    expect(await loadHomePlan("a", "a")).toBeNull();
  });

  it("a phone that never learned the configuration shows the ordinary list", async () => {
    mockRpc = "throw";
    expect(await loadHomePlan("fresh", "fresh")).toBeNull();
  });

  it("keeps a copy of the signed configuration on the phone", async () => {
    mockRpc = { data: { version: 1, config: VALUE }, error: null };
    await loadHomePlan("a", "a", Date.parse("2026-10-21T10:00:00Z"));
    expect(typeof mockStore["@tarragon/home-card-config/v1:a"]).toBe("string");
  });
});

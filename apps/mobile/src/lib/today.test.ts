import type { DoseChecklistItem } from "./medications";
import { lagosTimeToUtcMs } from "./lagos-date";
import { loadToday } from "./today";

const TODAY = "2026-10-04";
const NOW = lagosTimeToUtcMs(TODAY, "10:00") as number;
const at = (date: string, time = "15:00") => new Date(lagosTimeToUtcMs(date, time) as number).toISOString();

let mockRemote: { data: unknown[] | null; error: { code?: string; message: string } | null } | "throw" = { data: [], error: null };
let mockMirror: unknown[] | "throw" = [];
let mockDoses: { ok: true; data: DoseChecklistItem[] } | { ok: false; error: string } | "throw" = { ok: true, data: [] };
let mockBp: { takenAt: string }[] | "throw" = [];
const pulls: string[] = [];

jest.mock("./supabase", () => ({
  supabase: {
    from: () => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: async () => {
          if (mockRemote === "throw") throw new Error("Network request failed");
          return mockRemote;
        },
      };
      return q;
    },
  },
}));
jest.mock("./offline-store", () => ({
  pullChangesThrottled: (id: string) => pulls.push(id),
  readLocalTasks: async () => {
    if (mockMirror === "throw") throw new Error("db closed");
    return mockMirror;
  },
}));
jest.mock("./medications", () => ({
  loadTodaysDoses: async () => {
    if (mockDoses === "throw") throw new Error("boom");
    return mockDoses;
  },
}));
jest.mock("./vitals", () => ({
  loadRecentBpReadings: async () => {
    if (mockBp === "throw") throw new Error("boom");
    return mockBp;
  },
}));

const row = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  kind: "book_test",
  title: `Task ${id}`,
  priority: 2,
  due_at: at(TODAY),
  recurrence: null,
  state: "open",
  updated_at: at("2026-10-01"),
  ...over,
});

beforeEach(() => {
  mockRemote = { data: [row("t1")], error: null };
  mockMirror = [];
  mockDoses = { ok: true, data: [] };
  mockBp = [];
  pulls.length = 0;
});

describe("loadToday", () => {
  it("builds the list from tasks, dose slots and today's reading, and keeps the mirror fresh", async () => {
    mockRemote = { data: [row("t1"), row("t2", { kind: "log_bp" })], error: null };
    mockDoses = { ok: true, data: [{ medicationId: "m1", drugName: "Amlodipine", time: "20:00", status: "pending" }] };
    mockBp = [{ takenAt: at(TODAY, "07:30") }];
    const out = await loadToday("p1", NOW);
    expect(out.partial).toBe(false);
    expect(out.list.open.map((i) => i.id).sort()).toEqual(["dose:m1:20:00", "task:t1"]);
    expect(out.list.done.map((i) => i.id)).toEqual(["task:t2"]); // the BP task is satisfied by today's reading
    expect(pulls).toEqual(["p1"]);
  });

  it("uses the mirrored copy when the connection fails, without calling it partial", async () => {
    mockRemote = "throw";
    mockMirror = [row("m1")];
    const out = await loadToday("p1", NOW);
    expect(out.list.open.map((i) => i.id)).toEqual(["task:m1"]);
    expect(out.partial).toBe(false);
  });

  it("also uses the mirror when the server answers with an error", async () => {
    mockRemote = { data: null, error: { code: "PGRST301", message: "JWT expired" } };
    mockMirror = [row("m1")];
    expect((await loadToday("p1", NOW)).list.open).toHaveLength(1);
  });

  it("says partial, not 'nothing today', when the tasks failed and nothing was mirrored", async () => {
    mockRemote = "throw";
    const out = await loadToday("p1", NOW);
    expect(out.list.open).toEqual([]);
    expect(out.partial).toBe(true);
  });

  it("stays silent when the view does not exist yet (before the migration is applied): doses only, not partial", async () => {
    for (const code of ["PGRST205", "42P01"]) {
      mockRemote = { data: null, error: { code, message: "relation does not exist" } };
      mockDoses = { ok: true, data: [{ medicationId: "m1", drugName: "Amlodipine", time: "20:00", status: "pending" }] };
      const out = await loadToday("p1", NOW);
      expect(out.partial).toBe(false);
      expect(out.list.open.map((i) => i.id)).toEqual(["dose:m1:20:00"]);
    }
  });

  it("keeps the tasks when the dose slots cannot be read, and says partial", async () => {
    mockDoses = { ok: false, error: "offline" };
    const out = await loadToday("p1", NOW);
    expect(out.list.open.map((i) => i.id)).toEqual(["task:t1"]);
    expect(out.partial).toBe(true);
  });

  it("does not fail when the reading check fails: the blood pressure task just stays open", async () => {
    mockRemote = { data: [row("t2", { kind: "log_bp" })], error: null };
    mockBp = "throw";
    const out = await loadToday("p1", NOW);
    expect(out.list.open.map((i) => i.id)).toEqual(["task:t2"]);
  });

  it("never throws, whatever fails", async () => {
    mockRemote = "throw";
    mockMirror = "throw";
    mockDoses = "throw";
    mockBp = "throw";
    const out = await loadToday("p1", NOW);
    expect(out.list.total).toBe(0);
    expect(out.partial).toBe(true);
  });

  it("decides 'logged today' by the Lagos day", async () => {
    mockRemote = { data: [row("t2", { kind: "log_bp" })], error: null };
    mockBp = [{ takenAt: "2026-10-03T23:30:00.000Z" }]; // 00:30 on the 4th in Lagos
    expect((await loadToday("p1", NOW)).list.done.map((i) => i.id)).toEqual(["task:t2"]);
    mockBp = [{ takenAt: "2026-10-03T22:30:00.000Z" }]; // 23:30 on the 3rd in Lagos
    expect((await loadToday("p1", NOW)).list.open.map((i) => i.id)).toEqual(["task:t2"]);
  });
});

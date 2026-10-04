/**
 * S06 pull and read mirror. A small in-memory fake stands in for the Supabase
 * query builder and applies the same filters the real one would (eq, gte,
 * keyset or, order, limit) so the cursor rules are exercised for real.
 */
import { OFFLINE_BUDGET } from "./offline-budget";
import { clearLocalMirror, pullChanges, purgeMirror, readLocalMedications, readLocalRecords, readLocalTasks } from "./offline-store";

type Row = { id: string; created_at: string; patient_id: string; [k: string]: unknown };

const mockTables: Record<string, Row[]> = {};
let mockUser: string | null = "user-1";
let mockFail: { message: string; code?: string } | null = null;
const mockCalls: { table: string; gte?: string }[] = [];

jest.mock("./supabase", () => {
  function builder(table: string) {
    const state: { eq: [string, unknown][]; gte?: string; or?: string; limit?: number } = { eq: [] };
    const run = async () => {
      if (mockFail) return { data: null, error: mockFail };
      let rows = [...(mockTables[table] ?? [])];
      for (const [k, v] of state.eq) rows = rows.filter((r) => r[k] === v);
      if (state.gte) rows = rows.filter((r) => r.created_at >= state.gte!);
      if (state.or) {
        const m = /created_at\.gt\.(.+?),and\(created_at\.eq\.(.+?),id\.gt\.(.+?)\)/.exec(state.or)!;
        rows = rows.filter((r) => r.created_at > m[1] || (r.created_at === m[2] && r.id > m[3]));
      }
      rows.sort((a, b) => (a.created_at === b.created_at ? a.id.localeCompare(b.id) : a.created_at.localeCompare(b.created_at)));
      if (state.limit) rows = rows.slice(0, state.limit);
      return { data: rows, error: null };
    };
    const q: Record<string, unknown> = {
      select: () => q,
      eq: (k: string, v: unknown) => (state.eq.push([k, v]), q),
      gte: (_k: string, v: string) => ((state.gte = v), mockCalls.push({ table, gte: v }), q),
      or: (v: string) => ((state.or = v), q),
      order: () => q,
      limit: (n: number) => ((state.limit = n), q),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => run().then(res, rej),
    };
    return q;
  }
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: mockUser ? { user: { id: mockUser } } : null } }) },
      from: (table: string) => builder(table),
    },
  };
});

const iso = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60_000).toISOString();
const row = (id: string, minutesAgo: number, extra: Record<string, unknown> = {}): Row => ({
  id,
  created_at: iso(minutesAgo),
  patient_id: "p1",
  ...extra,
});

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockTables.vitals_readings = [];
  mockTables.symptoms = [];
  mockTables.medication_logs = [];
  mockTables.medications = [];
  mockUser = "user-1";
  mockFail = null;
  mockCalls.length = 0;
  await clearLocalMirror();
});

describe("pullChanges", () => {
  it("mirrors the patient's own rows and reads them back newest first", async () => {
    mockTables.vitals_readings = [row("v1", 30), row("v2", 10)];
    mockTables.symptoms = [row("s1", 20)];
    const result = await pullChanges("p1");
    expect(result.pulled).toBe(3);
    const vitals = await readLocalRecords<Row>("vital", "p1");
    expect(vitals.map((v) => v.id)).toEqual(["v2", "v1"]);
  });

  it("a repeat pull re-reads the overlap and upserts by id, never duplicating", async () => {
    mockTables.vitals_readings = [row("v1", 30)];
    await pullChanges("p1");
    await pullChanges("p1");
    expect(await readLocalRecords<Row>("vital", "p1")).toHaveLength(1);
  });

  it("catches a row that committed late with an older created_at inside the overlap", async () => {
    mockTables.vitals_readings = [row("v1", 30), row("v3", 2)];
    await pullChanges("p1");
    // v2 was inserted at minute 5 but only became visible after the pull
    mockTables.vitals_readings.push(row("v2", 5));
    await pullChanges("p1");
    const ids = (await readLocalRecords<Row>("vital", "p1")).map((v) => v.id).sort();
    expect(ids).toEqual(["v1", "v2", "v3"]);
  });

  it("misses a late row older than the overlap (the documented limit of the window)", async () => {
    mockTables.vitals_readings = [row("v1", 2)];
    await pullChanges("p1");
    mockTables.vitals_readings.push(row("v0", 60));
    await pullChanges("p1");
    expect((await readLocalRecords<Row>("vital", "p1")).map((v) => v.id)).toEqual(["v1"]);
  });

  it("pages with an id tiebreak when many rows share one created_at", async () => {
    const same = iso(5);
    const total = OFFLINE_BUDGET.pullPageSize + 50;
    mockTables.vitals_readings = Array.from({ length: total }, (_, i) => ({
      id: `id-${String(i).padStart(4, "0")}`,
      created_at: same,
      patient_id: "p1",
    }));
    const result = await pullChanges("p1");
    expect(result.pulled).toBeGreaterThanOrEqual(total);
    expect(await readLocalRecords("vital", "p1", 1000)).toHaveLength(total);
  });

  it("the first pull reads only the initial window, not all history", async () => {
    await pullChanges("p1");
    const floor = new Date(mockCalls[0].gte!).getTime();
    const days = (Date.now() - floor) / 86_400_000;
    expect(Math.round(days)).toBe(OFFLINE_BUDGET.initialPullDays);
  });

  it("a network failure stops cleanly, keeps what is there, and never throws", async () => {
    mockTables.vitals_readings = [row("v1", 30)];
    await pullChanges("p1");
    mockFail = { message: "Network request failed" };
    const result = await pullChanges("p1");
    expect(result.stoppedOffline).toBe(true);
    expect(await readLocalRecords("vital", "p1")).toHaveLength(1);
  });

  it("replaces the medication list whole, so a stopped medicine disappears", async () => {
    mockTables.medications = [{ id: "m1", created_at: iso(1), patient_id: "p1", is_active: true } as Row];
    await pullChanges("p1");
    expect(await readLocalMedications("p1")).toHaveLength(1);
    mockTables.medications = [];
    await pullChanges("p1");
    expect(await readLocalMedications("p1")).toHaveLength(0);
  });

  it("does nothing with nobody signed in", async () => {
    mockUser = null;
    expect(await pullChanges("p1")).toMatchObject({ pulled: 0, pages: 0 });
  });
});

describe("account isolation", () => {
  it("a second account on the same phone cannot read the first account's mirror", async () => {
    mockTables.vitals_readings = [row("v1", 30)];
    await pullChanges("p1");
    mockUser = "user-2";
    expect(await readLocalRecords("vital", "p1")).toEqual([]);
  });

  it("clearLocalMirror empties records, medications and cursors", async () => {
    mockTables.vitals_readings = [row("v1", 30)];
    await pullChanges("p1");
    await clearLocalMirror();
    expect(await readLocalRecords("vital", "p1")).toEqual([]);
  });
});

describe("purgeMirror", () => {
  const daysAgoIso = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
  const aged = (id: string, days: number, patient = "p1"): Row => ({ id, created_at: daysAgoIso(days), patient_id: patient });

  it("deletes mirror rows older than the retention window, automatically after a pull, and keeps the rest", async () => {
    mockTables.vitals_readings = [aged("new", 1), aged("mid", 60), aged("edge", 85)];
    await pullChanges("p1");
    // all three are within 90 days of the newest row, so none is purged yet
    expect((await readLocalRecords<Row>("vital", "p1")).map((r) => r.id).sort()).toEqual(["edge", "mid", "new"]);
    // a much newer row arrives (40 days on): the pull stores it and purges what fell outside the window
    mockTables.vitals_readings.push({ id: "fresh", created_at: new Date(Date.now() + 40 * 86_400_000).toISOString(), patient_id: "p1" });
    await pullChanges("p1");
    expect((await readLocalRecords<Row>("vital", "p1")).map((r) => r.id).sort()).toEqual(["fresh", "new"]);
    expect(await purgeMirror("user-1")).toBe(0); // idempotent
  });

  it("measures from the newest mirrored row, so a phone clock jump cannot wipe the mirror", async () => {
    mockTables.vitals_readings = [aged("a", 5), aged("b", 2)];
    await pullChanges("p1");
    const realNow = Date.now;
    Date.now = () => realNow() + 400 * 86_400_000; // phone clock leaps a year ahead
    try {
      expect(await purgeMirror("user-1")).toBe(0);
    } finally {
      Date.now = realNow;
    }
    expect(await readLocalRecords("vital", "p1")).toHaveLength(2);
  });

  it("keeps kinds and subjects apart, and never touches medications or the outbox", async () => {
    mockTables.vitals_readings = [aged("v", 3)];
    mockTables.symptoms = [aged("s", 3)];
    mockTables.medications = [{ id: "m1", created_at: daysAgoIso(1), patient_id: "p1", is_active: true } as Row];
    await pullChanges("p1");
    await purgeMirror("user-1");
    expect(await readLocalRecords("vital", "p1")).toHaveLength(1);
    expect(await readLocalRecords("symptom", "p1")).toHaveLength(1);
    expect(await readLocalMedications("p1")).toHaveLength(1);
  });

  it("a purge failure never fails the pull", async () => {
    mockTables.vitals_readings = [aged("v", 3)];
    const result = await pullChanges("p1");
    expect(result.pulled).toBe(1);
  });

  it("never purges another account's rows or another subject's rows", async () => {
    // a second account on the same phone, and a second subject for the first
    mockTables.vitals_readings = [aged("u2-old", 80), aged("u2-new", 1)];
    mockUser = "user-2";
    await pullChanges("p1");
    mockUser = "user-1";
    mockTables.vitals_readings = [aged("p2-old", 80, "p2"), aged("p2-new", 1, "p2")];
    await pullChanges("p2");
    // user-1 / p1 gets a far newer row, so ITS old rows fall outside the window
    mockTables.vitals_readings = [aged("p1-old", 80), { id: "p1-fresh", created_at: new Date(Date.now() + 40 * 86_400_000).toISOString(), patient_id: "p1" }];
    await pullChanges("p1");
    expect((await readLocalRecords<Row>("vital", "p1")).map((r) => r.id)).toEqual(["p1-fresh"]);
    expect((await readLocalRecords<Row>("vital", "p2")).map((r) => r.id).sort()).toEqual(["p2-new", "p2-old"]);
    mockUser = "user-2";
    expect((await readLocalRecords<Row>("vital", "p1")).map((r) => r.id).sort()).toEqual(["u2-new", "u2-old"]);
  });
});

describe("task mirror (S07)", () => {
  const task = (id: string, extra: Record<string, unknown> = {}): Row =>
    row(id, 5, { kind: "log_bp", title: `Task ${id}`, state: "open", status: "not_started", updated_at: iso(5), ...extra });

  it("mirrors the patient's own tasks and not another patient's", async () => {
    mockTables.patient_tasks = [task("t1"), task("t2"), { ...task("t3"), patient_id: "someone-else" }];
    await pullChanges("p1");
    const local = await readLocalTasks<{ id: string }>("p1");
    expect(local.map((t) => t.id).sort()).toEqual(["t1", "t2"]);
    expect(await readLocalTasks("someone-else")).toEqual([]);
  });

  it("replaces the whole set: a task that changed is updated and one that is gone disappears", async () => {
    mockTables.patient_tasks = [task("t1"), task("t2")];
    await pullChanges("p1");
    mockTables.patient_tasks = [task("t1", { state: "done", status: "completed" })];
    await pullChanges("p1");
    const local = await readLocalTasks<{ id: string; state: string }>("p1");
    expect(local).toEqual([expect.objectContaining({ id: "t1", state: "done" })]);
  });

  it("keeps the last good copy when a later pull fails, so a missing view or a dropped connection never empties the list", async () => {
    mockTables.patient_tasks = [task("t1"), task("t2")];
    await pullChanges("p1");
    mockFail = { message: 'relation "public.patient_tasks" does not exist', code: "42P01" };
    await pullChanges("p1");
    mockFail = null;
    expect((await readLocalTasks<{ id: string }>("p1")).map((t) => t.id).sort()).toEqual(["t1", "t2"]);
  });

  it("does not show one account's tasks to another account on the same phone", async () => {
    mockTables.patient_tasks = [task("t1")];
    await pullChanges("p1");
    mockUser = "user-2";
    expect(await readLocalTasks("p1")).toEqual([]);
    mockUser = "user-1";
    expect(await readLocalTasks("p1")).toHaveLength(1);
  });

  it("is cleared on sign-out with the rest of the mirror", async () => {
    mockTables.patient_tasks = [task("t1")];
    await pullChanges("p1");
    await clearLocalMirror();
    expect(await readLocalTasks("p1")).toEqual([]);
  });

  it("an empty server list clears the mirror (the care team closed everything)", async () => {
    mockTables.patient_tasks = [task("t1")];
    await pullChanges("p1");
    mockTables.patient_tasks = [];
    await pullChanges("p1");
    expect(await readLocalTasks("p1")).toEqual([]);
  });
});

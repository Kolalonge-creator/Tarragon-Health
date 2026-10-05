/**
 * S08d: a failed catch-up read is its own answer. It is recorded for support and reported to
 * the caller (which retries a few times), never treated as "nothing to catch up", and it does not
 * use up the offer gap, so the next open tries again.
 */
import { loadLastOffered, mayOfferCatchUp, retryDelayMs, runCatchUpCheck, saveLastOffered } from "./catch-up";
import { getRecentSyncDiagnostics } from "./sync-diagnostics";
import { clearLocalMirror } from "./offline-store";

type Row = Record<string, unknown>;
const mockTables: Record<string, Row[]> = {};
let mockFailTable: string | null = null;

jest.mock("./api", () => ({
  ...(jest.requireActual("./api") as object),
  postVitalReading: jest.fn().mockResolvedValue({ success: true }),
}));

jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: (table: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        is: () => q,
        gte: () => q,
        in: () => q,
        then: (res: (v: unknown) => unknown) =>
          Promise.resolve(
            mockFailTable === table
              ? { data: null, error: { message: "Network request failed" } }
              : { data: mockTables[table] ?? [], error: null }
          ).then(res),
      };
      return q;
    },
  },
}));

// Monday 5 October 2026, 11:00 in Lagos: today's 08:00 dose has closed.
const NOW = Date.parse("2026-10-05T10:00:00Z");
const med = { id: "m1", drug_name: "A", schedule_times: ["08:00"], schedule_spec: null, source: "patient", dose: null, created_at: "2026-09-01T00:00:00Z" };

beforeEach(async () => {
  for (const k of Object.keys(mockTables)) delete mockTables[k];
  mockFailTable = null;
  await clearLocalMirror();
});

describe("runCatchUpCheck", () => {
  it("shows the unanswered closed doses", async () => {
    mockTables.medications = [med];
    const res = await runCatchUpCheck("p1", NOW);
    expect(res.status).toBe("show");
    if (res.status === "show") expect(res.items.map((i) => `${i.date} ${i.time}`)).toEqual(["2026-10-04 08:00", "2026-10-05 08:00"]);
  });

  it("says nothing to ask about only when the read worked and found nothing", async () => {
    mockTables.medications = [];
    expect(await runCatchUpCheck("p1", NOW)).toEqual({ status: "none" });
  });

  it("reports a failed read as failed, records it for support, and does not use up the offer gap", async () => {
    mockTables.medications = [med];
    mockFailTable = "medications";
    const res = await runCatchUpCheck("p1", NOW);
    expect(res).toEqual({ status: "failed", error: "Network request failed" });
    expect(getRecentSyncDiagnostics().some((e) => e.source === "catch_up" && e.message === "Network request failed")).toBe(true);
    expect(await loadLastOffered()).toBeNull();
    expect(mayOfferCatchUp(await loadLastOffered(), NOW)).toBe(true);
  });

  it("records only the first failure of a run of retries, so an offline phone cannot fill the diagnostics", async () => {
    mockTables.medications = [med];
    mockFailTable = "medications";
    const before = getRecentSyncDiagnostics().filter((e) => e.source === "catch_up").length;
    expect((await runCatchUpCheck("p1", NOW, false)).status).toBe("failed");
    expect((await runCatchUpCheck("p1", NOW, false)).status).toBe("failed");
    expect(getRecentSyncDiagnostics().filter((e) => e.source === "catch_up").length).toBe(before);
    await runCatchUpCheck("p1", NOW, true);
    expect(getRecentSyncDiagnostics().filter((e) => e.source === "catch_up").length).toBe(before + 1);
  });

  it("also fails when the dose log read fails, not just the medicines", async () => {
    mockTables.medications = [med];
    mockFailTable = "medication_logs_latest_per_slot";
    expect((await runCatchUpCheck("p1", NOW)).status).toBe("failed");
  });

  it("skips while the sheet was offered recently", async () => {
    mockTables.medications = [med];
    await saveLastOffered(NOW - 60_000);
    expect(await runCatchUpCheck("p1", NOW)).toEqual({ status: "skipped" });
    mockFailTable = "medications";
    expect((await runCatchUpCheck("p1", NOW)).status).toBe("skipped"); // no read at all, so no false failure
  });
});

describe("retryDelayMs", () => {
  it("retries after each configured delay and then stops until the next open", () => {
    expect(retryDelayMs(0)).toBe(30_000);
    expect(retryDelayMs(1)).toBe(120_000);
    expect(retryDelayMs(2)).toBeNull();
    expect(retryDelayMs(99)).toBeNull();
  });
});

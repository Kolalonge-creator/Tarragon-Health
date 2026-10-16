import { describe, expect, it, jest } from "@jest/globals";
import { buildAdherenceReport } from "@tarragon/medicines";
import { loadAdherenceReport, reportWeeksConfig, toAdherenceMedicines } from "./adherence-report-data";

/**
 * Drift test against the database. The same week is built in packages/db/tests/s08x_prn_limits.sql (section 9b) and
 * `private.weekly_adherence` must give the same numbers: a daily 08:00 medicine, 8 to 14 October 2026 (Lagos), taken 8 to 11,
 * skipped 12, taken late 13, "could not get it" 14. If either side changes, change both.
 */
const WEEK_EXPECTED = { due: 7, markedTaken: 5, late: 1, skipped: 1, noRecord: 0, couldNotGet: 1, percent: 71 };

const meds = [{ id: "m1", schedule_times: ["08:00"], schedule_spec: null, created_at: "2026-09-01T00:00:00+01:00", schedule_effective_from: null }];
const logs = [
  { medication_id: "m1", scheduled_for_date: "2026-10-08", scheduled_time: "08:00", status: "taken", source: "patient", logged_at: "2026-10-08T08:05:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-09", scheduled_time: "08:00", status: "taken", source: "patient", logged_at: "2026-10-09T08:05:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-10", scheduled_time: "08:00", status: "taken", source: "patient", logged_at: "2026-10-10T08:05:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-11", scheduled_time: "08:00", status: "taken", source: "patient", logged_at: "2026-10-11T08:05:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-12", scheduled_time: "08:00", status: "skipped", source: "patient", logged_at: "2026-10-12T08:05:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-13", scheduled_time: "08:00", status: "delayed", source: "patient", logged_at: "2026-10-13T13:00:00+01:00" },
  { medication_id: "m1", scheduled_for_date: "2026-10-14", scheduled_time: "08:00", status: "not_available", source: "patient", logged_at: "2026-10-14T08:05:00+01:00" },
];
const NOW = Date.parse("2026-10-15T12:00:00+01:00");
const CFG = { windowDays: 7, minDoses: 3, missedAfterMinutes: 120, thresholdPercent: 80 };

describe("adherence report data", () => {
  it("gives the week the database proof expects", () => {
    const [week] = buildAdherenceReport(toAdherenceMedicines(meds, logs), NOW, CFG, 1);
    expect(week).toMatchObject({ weekStart: "2026-10-08", weekEnd: "2026-10-14", ...WEEK_EXPECTED });
  });
  it("reads the number of weeks from the versioned config", () => {
    expect(reportWeeksConfig()).toBe(8);
  });
  it("ignores log rows with no slot (as-needed doses) and a malformed schedule falls back to the plain times", () => {
    const m = toAdherenceMedicines(
      [{ ...meds[0]!, schedule_spec: { kind: "nonsense" } }],
      [...logs, { medication_id: "m1", scheduled_for_date: "2026-10-14", scheduled_time: null, status: "taken", source: "patient", logged_at: "2026-10-14T09:00:00+01:00" }],
    );
    const [week] = buildAdherenceReport(m, NOW, CFG, 1);
    expect(week).toMatchObject(WEEK_EXPECTED);
  });

  function client(opts: { cfg?: unknown; medsErr?: boolean; pages?: unknown[][] }) {
    const pages = [...(opts.pages ?? [logs])];
    const logQuery = {
      select: () => logQuery, eq: () => logQuery, gte: () => logQuery, order: () => logQuery,
      range: async () => ({ data: pages.shift() ?? [], error: null }),
    };
    const from = (table: string) => {
      if (table === "medicine_config") {
        const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: opts.cfg === undefined ? { missed_after_minutes: 120, adherence_min_doses: 3, adherence_threshold_percent: 80 } : opts.cfg, error: null }) };
        return q;
      }
      if (table === "medications") {
        const q = { select: () => q, eq: () => q, is: async () => (opts.medsErr ? { data: null, error: { message: "boom" } } : { data: meds, error: null }) };
        return q;
      }
      return logQuery;
    };
    return { from } as never;
  }

  it("loads a report", async () => {
    const r = await loadAdherenceReport(client({}), "p1", NOW);
    expect(r.ok && r.data.weeks[0]).toMatchObject(WEEK_EXPECTED);
    expect(r.ok && r.data.hasScheduledMedicines).toBe(true);
  });
  it("fails loudly, never a report of zeros, when a read fails or the rules are missing", async () => {
    expect((await loadAdherenceReport(client({ medsErr: true }), "p1", NOW)).ok).toBe(false);
    expect((await loadAdherenceReport(client({ cfg: null }), "p1", NOW)).ok).toBe(false);
  });
  it("pages through more than one page of dose rows rather than cutting the list", async () => {
    const full = Array.from({ length: 1000 }, () => ({ ...logs[0]! }));
    const spy = jest.fn();
    spy();
    const r = await loadAdherenceReport(client({ pages: [full, logs] }), "p1", NOW);
    expect(r.ok).toBe(true);
  });
});

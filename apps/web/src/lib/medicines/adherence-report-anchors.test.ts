import { describe, expect, it } from "@jest/globals";
import { loadAdherenceReport } from "./adherence-report-data";

/**
 * S08z: the patient's printed report works out doses tied to the day from their own anchor times and shifts, as they were on each
 * date, and refuses to print when those times could not be read (it would put the wrong times on a document handed to a clinic).
 */
const NOW = Date.parse("2026-10-15T12:00:00+01:00");
const anchoredMed = {
  id: "m1",
  schedule_times: ["08:15"],
  schedule_spec: { kind: "daily", times: [], startDate: null, endDate: null, foodNote: null, anchored: [{ anchor: "breakfast", offsetMinutes: 0 }] },
  created_at: "2026-09-01T00:00:00+01:00",
  schedule_effective_from: null,
};
// Taken on every day of the week 8 to 14 October at the time breakfast was that day: 08:15 from the start, then 09:00 from the 12th.
const days = ["2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14"];
const logs = days.map((d) => ({
  medication_id: "m1",
  scheduled_for_date: d,
  scheduled_time: d >= "2026-10-12" ? "09:00" : "08:15",
  status: "taken",
  source: "patient",
  logged_at: `${d}T09:30:00+01:00`,
}));

function client(opts: { anchorsError?: boolean; times?: unknown[] }) {
  const q = (data: unknown, error: unknown = null) => {
    const o: Record<string, unknown> = {
      select: () => o, eq: () => o, gte: () => o, order: () => o,
      is: async () => ({ data, error }),
      maybeSingle: async () => ({ data, error }),
      range: async () => ({ data, error }),
      then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(res),
    };
    return o;
  };
  return {
    from: (table: string) => {
      if (table === "medicine_config") return q({ missed_after_minutes: 120, adherence_min_doses: 3, adherence_threshold_percent: 80 });
      if (table === "medications") return q([anchoredMed]);
      if (table === "patient_dose_anchors") return opts.anchorsError ? q(null, { message: "boom" }) : q(opts.times ?? []);
      if (table === "patient_day_shifts") return q([]);
      return q(logs);
    },
  } as never;
}

describe("the printed report with anchored doses", () => {
  it("counts each dose at the time it was on that day, so a changed anchor time never turns taken doses into 'no record'", async () => {
    const res = await loadAdherenceReport(
      client({ times: [{ anchor: "breakfast", effective_from: "2000-01-01", local_time: "08:15" }, { anchor: "breakfast", effective_from: "2026-10-12", local_time: "09:00" }] }),
      "p1",
      NOW
    );
    if (!res.ok) throw new Error(res.error);
    const week = res.data.weeks[0];
    expect(week).toMatchObject({ weekStart: "2026-10-08", weekEnd: "2026-10-14", due: 7, markedTaken: 7, noRecord: 0, percent: 100 });
  });

  it("a read that cannot get the patient's own times gives no report, never one worked out from the wrong times", async () => {
    const res = await loadAdherenceReport(client({ anchorsError: true }), "p1", NOW);
    expect(res.ok).toBe(false);
  });
});

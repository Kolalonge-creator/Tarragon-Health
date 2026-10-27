/**
 * Saving confirmed paper diary rows (S07y). Proves, against the real saveDiaryReadings with a recording client:
 *  - every saved reading is an ordinary manual insert labelled paper_diary, carrying the person's stated time in client_recorded_at and NEVER a taken_at of its own
 *    (the database decides what time to keep, inside its bounded window);
 *  - a row that was not confirmed, or is not valid, is never inserted, and comes back with its reasons;
 *  - the pulse is its own reading (so the pulse red-flag engine sees it) with a derived id, so a retry never doubles anything;
 *  - the same post-insert safety assessments run as for a typed reading, and a failed one is reported, never swallowed;
 *  - a closed guard (55000) saves nothing and tries nothing else; a held (impossible) value is not reported as saved.
 */
jest.mock("server-only", () => ({}));
jest.mock("@/lib/ml/assess-bp-control", () => ({ assessBpControlBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-glucose", () => ({ assessGlucoseBestEffort: jest.fn() }));
jest.mock("@/lib/vitals/assess-heart-rate", () => ({ assessHeartRateBestEffort: jest.fn() }));
jest.mock("@/lib/health-score/assess-health-score", () => ({ assessHealthScoreBestEffort: jest.fn() }));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));

import { diaryLimits, emptyDiaryRow, type DiaryDraftRow } from "@tarragon/shared";
import { derivedDiaryClientId, diaryRowSchema, diarySaveRequestSchema, saveDiaryReadings } from "./save-diary-readings";

const NOW = Date.UTC(2026, 9, 20, 13, 0); // 14:00 in Lagos
const K1 = "11111111-1111-4111-8111-111111111111";
const K2 = "22222222-2222-4222-8222-222222222222";
const CTX = { subjectId: "p1", organisationId: "o1", route: "test" };

const bp = (key = K1, over: Partial<DiaryDraftRow> = {}): DiaryDraftRow => emptyDiaryRow(key, "blood_pressure", { date: "2026-10-18", time: "08:30", systolic: "132", diastolic: "84", ...over });
const glu = (key = K2, over: Partial<DiaryDraftRow> = {}): DiaryDraftRow => emptyDiaryRow(key, "glucose", { date: "2026-10-18", time: "07:00", glucose: "6.1", glucoseUnit: "mmol_l", glucoseContext: "fasting", ...over });

interface Plan {
  insertError?: (row: Record<string, unknown>) => { code: string } | null;
  /** what became of an insert that returned no error: stored by default; held or merged stores nothing (the insert answers with no row) */
  outcome?: (clientId: string) => "saved" | "held" | "merged" | "unknown";
}

function makeClient(plan: Plan = {}) {
  const inserted: Record<string, unknown>[] = [];
  const tables: string[] = [];
  let roundTrips = 0;
  const client = {
    from: (table: string) => {
      tables.push(table);
      if (table === "vitals_readings") {
        return {
          // insert(...).select("id"): the answer carries the stored row, or nothing when a trigger held or linked it
          insert: (row: Record<string, unknown>) => ({
            select: async () => {
              roundTrips += 1;
              const error = plan.insertError?.(row) ?? null;
              if (error) return { data: null, error };
              inserted.push(row);
              const kind = plan.outcome?.(String(row.client_reading_id)) ?? "saved";
              return { data: kind === "saved" ? [{ id: `id-${row.client_reading_id}` }] : [], error: null };
            },
          }),
          // readOutcome (only reached after an empty answer): select("id").eq(...).is(...).eq(client_reading_id).limit(1).maybeSingle()
          select: () => {
            roundTrips += 1;
            const chain: Record<string, unknown> = {};
            let clientId = "";
            chain.eq = (col: string, val: string) => {
              if (col === "client_reading_id") clientId = val;
              return chain;
            };
            chain.is = () => chain;
            chain.limit = () => chain;
            chain.maybeSingle = async () => {
              const kind = plan.outcome?.(clientId) ?? "saved";
              if (kind === "unknown") throw new Error("the look-back could not be made");
              return kind === "saved" ? { data: { id: `id-${clientId}` } } : { data: null };
            };
            return chain;
          },
        };
      }
      if (table === "vitals_readings_held") {
        return {
          select: () => {
            roundTrips += 1;
            const chain: Record<string, unknown> = {};
            let clientId = "";
            chain.eq = (col: string, val: string) => {
              if (col === "payload->>client_reading_id") clientId = val;
              return chain;
            };
            chain.order = () => chain;
            chain.limit = () => chain;
            chain.maybeSingle = async () => ((plan.outcome?.(clientId) ?? "saved") === "held" ? { data: { id: "held-1", reasons: ["systolic_range"] } } : { data: null });
            return chain;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { client: client as never, inserted, tables, trips: () => roundTrips };
}

function deps() {
  return {
    assessBp: jest.fn(async () => undefined),
    assessPulse: jest.fn(async () => undefined),
    assessGlucose: jest.fn(async () => undefined),
    assessScore: jest.fn(async () => undefined),
    now: () => NOW,
  };
}

describe("saveDiaryReadings", () => {
  it("inserts an ordinary manual reading labelled paper_diary with the stated time and no taken_at of its own", async () => {
    const { client, inserted } = makeClient();
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp()], d);
    expect(out.results).toEqual([{ key: K1, status: "saved" }]);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      patient_id: "p1",
      organisation_id: "o1",
      source: "manual",
      entry_origin: "paper_diary",
      vital_type: "blood_pressure",
      systolic: 132,
      diastolic: 84,
      client_recorded_at: "2026-10-18T07:30:00.000Z",
      client_reading_id: K1,
    });
    expect(inserted[0]).not.toHaveProperty("taken_at");
    // a typed reading's source is manual too: no new vital_source value can slip past a trigger that keys on source
    expect(inserted[0]?.source).toBe("manual");
  });

  it("only touches the vitals tables (and reads back what became of the insert)", async () => {
    const { client, tables } = makeClient();
    await saveDiaryReadings(client, CTX, [bp(), glu()], deps());
    expect(new Set(tables)).toEqual(new Set(["vitals_readings"]));
  });

  it("a pulse is its own reading with an id derived from the row's, so a retry is a no-op", async () => {
    const { client, inserted } = makeClient();
    await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "72" })], deps());
    expect(inserted).toHaveLength(2);
    expect(inserted[1]).toMatchObject({ vital_type: "pulse", pulse_bpm: 72, entry_origin: "paper_diary", client_reading_id: derivedDiaryClientId(K1, "pulse") });
    expect(derivedDiaryClientId(K1, "pulse")).toBe(derivedDiaryClientId(K1, "pulse"));
    expect(derivedDiaryClientId(K1, "pulse")).not.toBe(derivedDiaryClientId(K2, "pulse"));
    expect(derivedDiaryClientId(K1, "pulse")).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("a glucose row stores mmol/L with its context", async () => {
    const { client, inserted } = makeClient();
    await saveDiaryReadings(client, CTX, [glu(K2, { glucose: "110", glucoseUnit: "mg_dl", glucoseContext: "post_meal" })], deps());
    expect(inserted[0]).toMatchObject({ vital_type: "glucose", glucose_context: "post_meal", entry_origin: "paper_diary" });
    expect(inserted[0]?.glucose_mmol_l).toBeCloseTo(6.1, 1);
  });

  it("never inserts a row that is unconfirmed or not valid, and says why", async () => {
    const { client, inserted } = makeClient();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { confirmed: false }), bp(K2, { systolic: "80", diastolic: "130" })], deps());
    expect(inserted).toHaveLength(0);
    expect(out.results).toEqual([
      { key: K1, status: "refused", problems: ["not_confirmed"] },
      { key: K2, status: "refused", problems: ["systolic_not_above_diastolic"] },
    ]);
  });

  it("refuses a date outside the window before the database is asked", async () => {
    const { client, inserted } = makeClient();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { date: "2026-08-01" })], deps());
    expect(inserted).toHaveLength(0);
    expect(out.results[0]).toMatchObject({ status: "refused", problems: ["date_too_old"] });
  });

  it("a sheet longer than one save may carry is refused whole", async () => {
    const { client, inserted } = makeClient();
    const many = Array.from({ length: 21 }, (_, i) => bp(`aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, "0")}`));
    const out = await saveDiaryReadings(client, CTX, many, deps());
    expect(out.tooMany).toBe(true);
    expect(inserted).toHaveLength(0);
  });

  it("runs the same safety assessments as a typed reading, once per kind saved", async () => {
    const { client } = makeClient();
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "72" }), glu()], d);
    expect(d.assessBp).toHaveBeenCalledTimes(1);
    expect(d.assessPulse).toHaveBeenCalledTimes(1);
    expect(d.assessGlucose).toHaveBeenCalledTimes(1);
    expect(d.assessScore).toHaveBeenCalledTimes(1);
    expect(out.safetyAssessmentFailed).toBe(false);
  });

  it("a safety assessment that fails is REPORTED, never swallowed, and the band is then unknown (no false reassurance)", async () => {
    const { client } = makeClient();
    const d = deps();
    d.assessBp.mockRejectedValueOnce(new Error("network"));
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { systolic: "118", diastolic: "76" })], d);
    expect(out.results[0]?.status).toBe("saved");
    expect(out.safetyAssessmentFailed).toBe(true);
    expect(out.bpAckLevel).toBe("unknown");
  });

  it("reports the worst blood pressure band so the same signed wording a typed reading gets is shown", async () => {
    const { client } = makeClient();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { systolic: "118", diastolic: "76" }), bp(K2, { systolic: "205", diastolic: "128" })], deps());
    expect(out.bpAckLevel).toBe("emergency");
  });

  it("a closed guard (55000) saves nothing and stops", async () => {
    const { client, inserted } = makeClient({ insertError: () => ({ code: "55000", message: "this kind of reading is not switched on yet (paper_diary_entry)" }) });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp(K1), bp(K2)], d);
    expect(inserted).toHaveLength(0);
    expect(out.results.every((r) => r.status === "refused" && r.closed === true)).toBe(true);
    expect(d.assessBp).not.toHaveBeenCalled();
  });

  it("a 55000 that is not the guard's refusal is an ordinary failure, not 'not switched on'", async () => {
    const { client } = makeClient({ insertError: () => ({ code: "55000", message: "event bus has no active config" }) });
    const out = await saveDiaryReadings(client, CTX, [bp(K1), bp(K2)], deps());
    expect(out.results.map((r) => r.status)).toEqual(["failed", "failed"]);
    expect(out.results.some((r) => r.closed)).toBe(false);
  });

  it("a retry of the same row (23505) counts as already saved, not as a failure", async () => {
    const { client } = makeClient({ insertError: () => ({ code: "23505" }) });
    const out = await saveDiaryReadings(client, CTX, [bp()], deps());
    expect(out.results).toEqual([{ key: K1, status: "duplicate" }]);
  });

  it("a RETRY still gets the safety assessments and the signed wording: when the first answer was lost, this is where a dangerous value is explained", async () => {
    const { client, inserted } = makeClient({ insertError: () => ({ code: "23505" }) });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { systolic: "205", diastolic: "128", pulse: "72" })], d);
    expect(inserted).toHaveLength(0); // nothing is stored twice
    expect(out.results).toEqual([{ key: K1, status: "duplicate" }]);
    expect(out.bpAckLevel).toBe("emergency");
    expect(d.assessBp).toHaveBeenCalledTimes(1);
    expect(d.assessPulse).toHaveBeenCalledTimes(1);
  });

  it("a date the database refuses after our own check (its window is narrower than the configured one) is said in words, not as a generic failure", async () => {
    const { client } = makeClient({ insertError: () => ({ code: "22023" }) });
    const out = await saveDiaryReadings(client, CTX, [bp()], deps());
    expect(out.results[0]).toMatchObject({ key: K1, status: "refused", problems: ["date_invalid"] });
  });

  it("judges the rows by the limits it is given (the database's own window)", async () => {
    const { client, inserted } = makeClient();
    const narrow = { ...diaryLimits(), windowDays: 1 };
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { date: "2026-10-10" })], { ...deps(), limits: narrow });
    expect(inserted).toHaveLength(0);
    expect(out.results[0]).toMatchObject({ status: "refused", problems: ["date_too_old"] });
  });

  it("an impossible value the database held is not reported as saved, and is not assessed", async () => {
    const { client } = makeClient({ outcome: () => "held" });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp()], d);
    expect(out.results[0]?.status).toBe("held");
    expect(d.assessBp).not.toHaveBeenCalled();
  });

  it("a blood pressure that was linked to a reading already there does NOT stop the pulse beside it from being saved and checked", async () => {
    const { client, inserted } = makeClient({ outcome: (id) => (id === K1 ? "merged" : "saved") });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "150" })], d);
    expect(inserted.map((r) => r.vital_type)).toEqual(["blood_pressure", "pulse"]);
    expect(out.results[0]?.status).toBe("saved");
    expect(d.assessPulse).toHaveBeenCalledTimes(1);
    expect(d.assessBp).not.toHaveBeenCalled();
  });

  it("when BOTH parts matched a reading already there, the row is 'merged'", async () => {
    const { client } = makeClient({ outcome: () => "merged" });
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "72" })], deps());
    expect(out.results[0]?.status).toBe("merged");
  });

  it("a held pulse keeps the row on the sheet, and the blood pressure beside it is still saved and assessed", async () => {
    const { client } = makeClient({ outcome: (id) => (id === K1 ? "saved" : "held") });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "72" })], d);
    expect(out.results[0]?.status).toBe("held");
    expect(d.assessBp).toHaveBeenCalledTimes(1);
  });

  it("an answer it cannot account for is not reported as saved: the row stays to be tried again", async () => {
    const { client } = makeClient({ outcome: () => "unknown" });
    const d = deps();
    const out = await saveDiaryReadings(client, CTX, [bp()], d);
    expect(out.results[0]?.status).toBe("failed");
    expect(d.assessBp).not.toHaveBeenCalled();
  });

  it("the usual save is one round trip per reading (the extra look is only for an empty answer)", async () => {
    const { client, trips } = makeClient();
    await saveDiaryReadings(client, CTX, [bp(K1, { pulse: "72" }), glu()], deps());
    expect(trips()).toBe(3);
  });

  it("a database error that is nobody's fault leaves the row to retry", async () => {
    const { client } = makeClient({ insertError: () => ({ code: "08006" }) });
    const out = await saveDiaryReadings(client, CTX, [bp()], deps());
    expect(out.results[0]?.status).toBe("failed");
  });

  it("the request schema accepts only confirmed rows with a UUID key", () => {
    const row = { ...bp(), confirmed: true };
    expect(diaryRowSchema.safeParse(row).success).toBe(true);
    expect(diaryRowSchema.safeParse({ ...row, confirmed: false }).success).toBe(false);
    expect(diaryRowSchema.safeParse({ ...row, key: "not-a-uuid" }).success).toBe(false);
    expect(diarySaveRequestSchema.safeParse({ rows: [] }).success).toBe(false);
  });
});

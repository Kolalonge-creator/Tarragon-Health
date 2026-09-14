import { describe, expect, it, jest } from "@jest/globals";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@tarragon/shared";
import { fakeSupabaseFrom } from "../ai-coach/test-support";
import { recordWeeklyPlanProgress } from "./weekly-plan-progress";

/**
 * `from` dispatches `lpe_enrollments` / `lpe_programme_instances` /
 * `lpe_goal_instances` reads through the shared table-keyed mock, but
 * `lpe_measurements` gets its own `insert` spy so a test can assert on the
 * exact rows the function tried to write — `chainable`'s canned-result
 * dispatch can't distinguish one `.insert()` call's payload from another.
 */
function buildSupabase(opts: {
  enrollments?: unknown;
  programmeInstances?: unknown;
  goalInstances?: unknown;
  insertResult?: unknown;
  throwFrom?: string;
}) {
  const insertMock = jest.fn<(rows: Array<Record<string, unknown>>) => Promise<unknown>>(() =>
    Promise.resolve(opts.insertResult ?? { data: null, error: null })
  );
  const readFrom = fakeSupabaseFrom({
    lpe_enrollments: opts.enrollments ?? { data: [], error: null },
    lpe_programme_instances: opts.programmeInstances ?? { data: [], error: null },
    lpe_goal_instances: opts.goalInstances ?? { data: [], error: null },
  });
  const from = jest.fn((table: string) => {
    if (opts.throwFrom === table) {
      throw new Error(`boom from ${table}`);
    }
    if (table === "lpe_measurements") {
      return { insert: insertMock };
    }
    return readFrom(table);
  });
  const db = { from } as unknown as SupabaseClient<Database>;
  return { db, insertMock };
}

const BASE_PARAMS = {
  patientId: "patient-1",
  organisationId: "org-1",
  unit: "check",
} as const;

describe("recordWeeklyPlanProgress", () => {
  it("writes one lpe_measurements row when the patient has one active enrolment with a matching goal", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: { data: [{ id: "enr-1" }], error: null },
      programmeInstances: { data: [{ id: "pi-1", enrollment_id: "enr-1" }], error: null },
      goalInstances: { data: [{ programme_instance_id: "pi-1" }], error: null },
    });

    await recordWeeklyPlanProgress(db, {
      ...BASE_PARAMS,
      metric: "food_log",
      valueJson: { meal_type: "lunch" },
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertMock.mock.calls[0][0];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organisation_id: "org-1",
      patient_id: "patient-1",
      enrollment_id: "enr-1",
      type: "food_log",
      value_num: null,
      value_json: { meal_type: "lunch" },
      unit: "check",
      source: "web",
    });
    expect(typeof rows[0].taken_at).toBe("string");
  });

  it("writes one row per matching enrolment when the patient has more than one active programme", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: {
        data: [{ id: "enr-1" }, { id: "enr-2" }],
        error: null,
      },
      programmeInstances: {
        data: [
          { id: "pi-1", enrollment_id: "enr-1" },
          { id: "pi-2", enrollment_id: "enr-2" },
        ],
        error: null,
      },
      goalInstances: {
        data: [{ programme_instance_id: "pi-1" }, { programme_instance_id: "pi-2" }],
        error: null,
      },
    });

    await recordWeeklyPlanProgress(db, {
      ...BASE_PARAMS,
      metric: "weight",
      valueNum: 79.4,
      unit: "kg",
    });

    expect(insertMock).toHaveBeenCalledTimes(1);
    const rows = insertMock.mock.calls[0][0];
    expect(rows.map((r) => r.enrollment_id).sort()).toEqual(["enr-1", "enr-2"]);
    expect(rows.every((r) => r.value_num === 79.4)).toBe(true);
  });

  it("is a no-op when the patient has no active LPE enrolment", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: { data: [], error: null },
    });

    await recordWeeklyPlanProgress(db, { ...BASE_PARAMS, metric: "food_log" });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("is a no-op when the enrolment has no programme instance", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: { data: [{ id: "enr-1" }], error: null },
      programmeInstances: { data: [], error: null },
    });

    await recordWeeklyPlanProgress(db, { ...BASE_PARAMS, metric: "activity_minutes" });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("is a no-op when no active goal instance matches this metric — most calls, since most patients have no active goal for it", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: { data: [{ id: "enr-1" }], error: null },
      programmeInstances: { data: [{ id: "pi-1", enrollment_id: "enr-1" }], error: null },
      goalInstances: { data: [], error: null },
    });

    await recordWeeklyPlanProgress(db, { ...BASE_PARAMS, metric: "glucose" });

    expect(insertMock).not.toHaveBeenCalled();
  });

  it("never throws when the insert itself fails — best-effort, must not break the caller's own action", async () => {
    const { db, insertMock } = buildSupabase({
      enrollments: { data: [{ id: "enr-1" }], error: null },
      programmeInstances: { data: [{ id: "pi-1", enrollment_id: "enr-1" }], error: null },
      goalInstances: { data: [{ programme_instance_id: "pi-1" }], error: null },
      insertResult: { data: null, error: { message: "insert failed" } },
    });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(
      recordWeeklyPlanProgress(db, { ...BASE_PARAMS, metric: "bp", valueJson: { systolic: 120, diastolic: 80 } })
    ).resolves.toBeUndefined();

    expect(insertMock).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it("never throws when a read query itself throws — best-effort, must not break the caller's own action", async () => {
    const { db, insertMock } = buildSupabase({ throwFrom: "lpe_enrollments" });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await expect(recordWeeklyPlanProgress(db, { ...BASE_PARAMS, metric: "food_log" })).resolves.toBeUndefined();

    expect(insertMock).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

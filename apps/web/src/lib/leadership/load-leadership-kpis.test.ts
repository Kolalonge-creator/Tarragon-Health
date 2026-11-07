import { leadershipPeriodBounds } from "@tarragon/shared";
import { loadLeadershipKpis } from "./load-leadership-kpis";

type Result = { data?: unknown[] | null; error: unknown; count?: number | null };

/** Each from() call takes the next result for that table, in the order the loader issues them. */
function client(queue: Record<string, Result[]>) {
  const from = (table: string) => {
    const result = queue[table]!.shift()!;
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "gte", "lt", "in", "not", "or", "order", "limit"]) chain[m] = () => chain;
    chain.then = (resolve: (r: Result) => unknown) => resolve(result);
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { from } as any;
}

const n = (count: number): Result => ({ error: null, count });
const failed: Result = { error: { message: "x" }, count: null, data: null };
const bounds = leadershipPeriodBounds("30d", new Date("2026-11-07T12:00:00Z"));

describe("loadLeadershipKpis", () => {
  it("returns live counts and distinct patients with an active care plan", async () => {
    const k = await loadLeadershipKpis(
      client({
        // since, registrations now, registrations before, total patients (issued in that order)
        profiles: [{ error: null, data: [{ created_at: "2026-07-01T00:00:00Z" }] }, n(5), n(3), n(40)],
        video_consultations: [n(7), n(2)],
        escalations: [n(4), n(3)],
        care_plans: [{ error: null, data: [{ patient_id: "a" }, { patient_id: "a" }, { patient_id: "b" }] }],
      }),
      bounds,
      []
    );
    expect(k).toEqual({
      dataSince: "2026-07-01T00:00:00Z",
      registrations: { current: 5, previous: 3 },
      consultationsCompleted: { current: 7, previous: 2 },
      escalationsRaised: 4,
      escalationsResolved: 3,
      patientsTotal: 40,
      patientsWithActivePlan: 2,
    });
  });

  it("turns every failed read into null, never 0", async () => {
    const k = await loadLeadershipKpis(
      client({
        profiles: [failed, failed, failed, failed],
        video_consultations: [failed, failed],
        escalations: [failed, failed],
        care_plans: [failed],
      }),
      bounds,
      []
    );
    expect(k.dataSince).toBeNull();
    expect(k.registrations).toEqual({ current: null, previous: null });
    expect(k.escalationsRaised).toBeNull();
    expect(k.patientsWithActivePlan).toBeNull();
  });
});

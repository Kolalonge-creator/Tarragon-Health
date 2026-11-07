import { leadershipPeriodBounds } from "@tarragon/shared";
import { loadAppointmentFigures } from "./load-appointment-figures";
import { loadJourneyExceptions } from "./load-journey-exceptions";
import { loadJourneySummary } from "./load-journey-summary";

type Result = { data?: unknown; error: unknown; count?: number | null };

/** Each from(table) takes the next queued result for that table; every filter returns the same chain; awaiting it resolves. */
function client(queue: Record<string, Result[]>, rpcResult?: Result) {
  const calls: string[] = [];
  const from = (table: string) => {
    const result = queue[table]?.shift() ?? { data: [], error: null, count: 0 };
    const chain: Record<string, unknown> = {};
    for (const m of ["select", "eq", "in", "is", "gte", "lt", "not", "or", "order", "limit"]) {
      chain[m] = (...args: unknown[]) => {
        calls.push(`${table}.${m}:${JSON.stringify(args)}`);
        return chain;
      };
    }
    chain.then = (resolve: (r: Result) => unknown) => resolve(result);
    return chain;
  };
  const rpc = jest.fn().mockResolvedValue(rpcResult ?? { data: null, error: null });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { supabase: { from, rpc } as any, calls, rpc };
}

const SUMMARY = {
  generated_at: "2026-11-07T12:00:00Z",
  stages: { registered: 4, onboarded: 1, with_coordinator: 0, care_plan_approved: 0, investigation_ordered: 2, result_received: 0, result_reviewed: 0, follow_up_raised: 0, follow_up_all_closed: 0 },
  awaiting: {
    onboarding: { count: 3, oldest_days: 20 },
    care_plan_approval: { count: 0, oldest_days: null },
    investigation_result: { count: 2, oldest_days: 30 },
    doctor_review: { count: 0, oldest_days: null },
    follow_up_open: { count: 0, oldest_days: null },
    follow_up_overdue: { count: 0, oldest_days: null },
    no_coordinator: { count: 4, oldest_days: null },
  },
  median_hours: {},
};

describe("loadJourneySummary", () => {
  it("calls the CMO aggregate and parses it", async () => {
    const { supabase, rpc } = client({}, { data: SUMMARY, error: null });
    const s = await loadJourneySummary(supabase);
    expect(rpc).toHaveBeenCalledWith("cmo_patient_journey_summary");
    expect(s?.stages.registered).toBe(4);
  });

  it("is null on a refusal or a malformed answer, never zeros", async () => {
    expect(await loadJourneySummary(client({}, { data: null, error: { message: "not authorised", code: "42501" } }).supabase)).toBeNull();
    expect(await loadJourneySummary(client({}, { data: { generated_at: "x" }, error: null }).supabase)).toBeNull();
  });
});

describe("loadAppointmentFigures", () => {
  const bounds = leadershipPeriodBounds("30d", new Date("2026-11-07T12:00:00Z"));

  it("counts all, completed, no-show and cancelled in the period, excluding test patients", async () => {
    const { supabase, calls } = client({ appointments: [{ error: null, count: 9 }, { error: null, count: 5 }, { error: null, count: 1 }, { error: null, count: 2 }] });
    expect(await loadAppointmentFigures(supabase, bounds, ["t1"])).toEqual({ scheduledInPeriod: 9, completed: 5, noShow: 1, cancelled: 2 });
    expect(calls.some((c) => c.includes('appointments.in:["status",["cancelled","patient_cancelled","provider_cancelled"]]'))).toBe(true);
    expect(calls.filter((c) => c.includes("t1")).length).toBe(4);
  });

  it("turns a failed read into null", async () => {
    const { supabase } = client({ appointments: [{ error: { message: "x" }, count: null }, { error: null, count: 1 }, { error: null, count: 0 }, { error: null, count: 0 }] });
    expect((await loadAppointmentFigures(supabase, bounds, [])).scheduledInPeriod).toBeNull();
  });
});

describe("loadJourneyExceptions", () => {
  const now = new Date("2026-11-07T12:00:00Z");

  it("lists overdue follow-ups (open and acknowledged), unreviewed results and outstanding orders by patient number only", async () => {
    const { supabase } = client({
      clinical_follow_ups: [
        { data: [{ id: "f1", patient_id: "p1", kind: "follow_up", due_at: "2026-11-01T00:00:00Z" }, { id: "f2", patient_id: "p1", kind: "order", due_at: "2026-12-01T00:00:00Z" }], error: null },
        { data: [{ id: "f3", patient_id: "t1", kind: "follow_up", due_at: "2026-11-02T00:00:00Z" }], error: null },
      ],
      lab_result_documents: [{ data: [{ id: "d1", patient_id: "p2", created_at: "2026-11-04T00:00:00Z" }], error: null }],
      lab_orders: [{ data: [{ id: "o1", patient_id: "p2", status: "ordered", ordered_at: "2026-10-20T00:00:00Z", payment_confirmed_at: null, created_at: "2026-10-19T00:00:00Z" }], error: null }],
      profiles: [{ data: [{ id: "p1", patient_number: "TH-1" }, { id: "p2", patient_number: "TH-2" }], error: null }],
    });
    const e = await loadJourneyExceptions(supabase, now, ["t1"]);
    // Not yet due, and the test patient's, are left out.
    expect(e.followUpsOverdue?.map((r) => [r.key, r.patientNumber])).toEqual([["fu:f1", "TH-1"]]);
    expect(e.awaitingReview?.[0]?.patientNumber).toBe("TH-2");
    expect(e.awaitingResult?.[0]?.since).toBe("2026-10-20T00:00:00Z");
    expect(JSON.stringify(e)).not.toMatch(/full_name/);
  });

  it("marks a list unknown when its read fails", async () => {
    const { supabase } = client({
      clinical_follow_ups: [{ data: null, error: { message: "x" } }, { data: [], error: null }],
      lab_result_documents: [{ data: null, error: { message: "x" } }],
      lab_orders: [{ data: [], error: null }],
    });
    const e = await loadJourneyExceptions(supabase, now, []);
    expect(e.followUpsOverdue).toBeNull();
    expect(e.awaitingReview).toBeNull();
    expect(e.awaitingResult).toEqual([]);
  });
});

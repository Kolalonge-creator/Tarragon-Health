/**
 * @jest-environment node
 *
 * loadHomeOverview (patient dashboard 2.0, PD-03/PD-05): every read is for the patient whose dashboard is open, a failed read
 * becomes null (never zero), and the unread-reply check is skipped while a supporter is acting.
 */
jest.mock("server-only", () => ({}));
jest.mock("@sentry/nextjs", () => ({ captureException: jest.fn() }));
const resolveServiceAccess = jest.fn();
jest.mock("@/app/(dashboard)/patient/service-status-card", () => ({ resolveServiceAccess: (id: string) => resolveServiceAccess(id) }));
const resolveActionCentreItems = jest.fn();
jest.mock("@/app/(dashboard)/patient/actions/actions-data", () => ({
  resolveActionCentreItems: (id: string) => resolveActionCentreItems(id),
  bucketActionItems: (items: { bucket: string }[]) => ({
    highPriority: items.filter((i) => i.bucket === "high"),
    dueToday: items.filter((i) => i.bucket === "today"),
    dueThisWeek: [],
    upcoming: [],
  }),
}));

type Result = { data?: unknown; count?: number | null; error?: { message: string } | null };
let results: Record<string, Result | Result[]>;
const tablesQueried: string[] = [];
const patientFilters: string[] = [];

function builder(table: string) {
  tablesQueried.push(table);
  const queue = results[table];
  const next = (): Result => {
    if (Array.isArray(queue)) return queue.shift() ?? { data: null, count: 0, error: null };
    return queue ?? { data: null, count: 0, error: null };
  };
  const b: Record<string, unknown> = {};
  for (const m of ["select", "in", "gte", "lte", "order", "limit", "not", "neq", "is"]) b[m] = () => b;
  b.eq = (col: string, val: string) => {
    if (col === "patient_id") patientFilters.push(`${table}:${val}`);
    return b;
  };
  b.maybeSingle = () => Promise.resolve({ data: null, error: null, ...next() });
  b.then = (resolve: (r: Result) => unknown) => resolve({ data: null, count: 0, error: null, ...next() });
  return b;
}
let labRpc: Result = { data: [], error: null };
const rpcCalls: string[] = [];
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (t: string) => builder(t),
    rpc: (name: string) => {
      rpcCalls.push(name);
      return Promise.resolve({ data: null, error: null, ...labRpc });
    },
  }),
}));

import { loadHomeOverview } from "./home-overview";

const NOW = new Date("2026-11-10T10:00:00Z");

beforeEach(() => {
  tablesQueried.length = 0;
  rpcCalls.length = 0;
  labRpc = { data: [], error: null };
  patientFilters.length = 0;
  resolveServiceAccess.mockResolvedValue({ status: "membership_active" });
  resolveActionCentreItems.mockResolvedValue([{ bucket: "high" }, { bucket: "today" }, { bucket: "later" }]);
  results = {
    appointments: {
      data: {
        id: "a1",
        scheduled_for: "2026-11-11T09:00:00Z",
        appointment_type: "telemedicine",
        status: "confirmed",
        consultation_method: "telemedicine",
        location: null,
        clinician: { full_name: "Dr. Eze" },
      },
    },
    preventive_baselines: { data: { state: "submitted" } },
    care_plans: { count: 0 },
    lab_orders: [{ count: 2 }, { count: 1 }],
    clinical_record_items: [{ count: 3 }, { count: 4 }],
    vitals_readings: { data: { id: "v1" } },
    care_message_threads: {
      data: [
        { last_care_team_reply_at: "2026-11-09T10:00:00Z", patient_last_read_at: "2026-11-09T09:00:00Z" },
      ],
    },
  };
});

const known = { hasRiskAssessment: true, hasAnyVitals: true, acting: false };

describe("loadHomeOverview", () => {
  it("reads every table for the given patient and builds the strip and journey", async () => {
    const o = await loadHomeOverview("p-1", known, NOW);
    expect(o.actionsDue).toBe(2);
    expect(o.resultsAwaitingDoctor).toBe(3);
    expect(o.nextAppointment?.clinicianName).toBe("Dr. Eze");
    expect(o.unreadCareTeamReply).toBe(true);
    const stage = Object.fromEntries(o.journey.map((s) => [s.id, s.state]));
    expect(stage).toEqual({ assessment: "done", review: "care_team", plan: "not_started", tests: "in_progress", results: "care_team", monitoring: "in_progress" });
    expect(patientFilters.every((f) => f.endsWith(":p-1"))).toBe(true);
    expect(resolveServiceAccess).toHaveBeenCalledWith("p-1");
  });

  it("turns failed reads into null, never zero", async () => {
    results.clinical_record_items = [{ error: { message: "boom" } }, { error: { message: "boom" } }];
    results.appointments = { error: { message: "boom" } };
    results.care_message_threads = { error: { message: "boom" } };
    resolveActionCentreItems.mockRejectedValue(new Error("boom"));
    resolveServiceAccess.mockResolvedValue(null);
    const o = await loadHomeOverview("p-1", known, NOW);
    expect(o.actionsDue).toBeNull();
    expect(o.resultsAwaitingDoctor).toBeNull();
    expect(o.nextAppointment).toBeUndefined();
    expect(o.unreadCareTeamReply).toBeNull();
    const stage = Object.fromEntries(o.journey.map((s) => [s.id, s.state]));
    expect(stage.results).toBe("unknown");
    expect(stage.review).toBe("unknown");
  });

  it("does not read the patient's message read markers while a supporter is acting", async () => {
    const o = await loadHomeOverview("p-1", { ...known, acting: true }, NOW);
    expect(tablesQueried).not.toContain("care_message_threads");
    expect(rpcCalls).not.toContain("my_lab_results");
    expect(o.unreadCareTeamReply).toBeNull();
  });

  it("treats a reply already read as not new", async () => {
    results.care_message_threads = {
      data: [{ last_care_team_reply_at: "2026-11-09T10:00:00Z", patient_last_read_at: "2026-11-09T11:00:00Z" }],
    };
    const o = await loadHomeOverview("p-1", known, NOW);
    expect(o.unreadCareTeamReply).toBe(false);
  });

  it("shows Free members the doctor stages as part of Membership", async () => {
    resolveServiceAccess.mockResolvedValue({ status: "self_tracking" });
    const o = await loadHomeOverview("p-1", known, NOW);
    expect(o.journey.filter((s) => s.state === "membership").map((s) => s.id)).toEqual(["review", "plan", "results"]);
  });

  it("adds held partner results to the documents waiting for a doctor, without double-counting own uploads", async () => {
    labRpc = {
      data: [
        { status: "under_review", own_upload: false },
        { status: "under_review", own_upload: true },
        { status: "released", own_upload: false },
      ],
    };
    const o = await loadHomeOverview("p-1", known, NOW);
    expect(o.resultsAwaitingDoctor).toBe(4);
  });
});

const mockRpc = jest.fn();
const mockAppointmentsCount = jest.fn();
jest.mock("./supabase", () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ select: () => ({ eq: () => mockAppointmentsCount() }) }),
  },
}));

import { loadHiddenSections } from "./patient-page-gates";

function setup(opts: { appointmentsGuard: boolean | "error"; recordsGuard: boolean | "error"; appointments: number; records: unknown[] }) {
  mockRpc.mockImplementation(async (fn: string, args?: { p_key?: string }) => {
    if (fn === "go_live_guard_is_open") {
      const v = args?.p_key === "clinical_operations_enabled" ? opts.appointmentsGuard : opts.recordsGuard;
      return v === "error" ? { data: null, error: { message: "x" } } : { data: v, error: null };
    }
    if (fn === "my_records_requests") return { data: opts.records, error: null };
    return { data: null, error: { message: "unexpected" } };
  });
  mockAppointmentsCount.mockResolvedValue({ count: opts.appointments, error: null });
}

beforeEach(() => {
  mockRpc.mockReset();
  mockAppointmentsCount.mockReset();
});

describe("loadHiddenSections", () => {
  it("hides Appointments and Ask for your records while their guards are off and nothing is held", async () => {
    setup({ appointmentsGuard: false, recordsGuard: false, appointments: 0, records: [] });
    expect((await loadHiddenSections("p1")).sort()).toEqual(["appointments", "recordsRequests"]);
  });

  it("hides nothing when the guards are open", async () => {
    setup({ appointmentsGuard: true, recordsGuard: true, appointments: 0, records: [] });
    expect(await loadHiddenSections("p1")).toEqual([]);
  });

  it("keeps a closed section the person already holds something on", async () => {
    setup({ appointmentsGuard: false, recordsGuard: false, appointments: 1, records: [{ id: "r1", facility_name: "A", scope_codes: [], state: "sent", requested_at: null, due_at: null, received_at: null, note: null, is_overdue: false }] });
    expect(await loadHiddenSections("p1")).toEqual([]);
  });

  it("keeps a holdable section on an unreadable guard, and never hides a safety section", async () => {
    setup({ appointmentsGuard: "error", recordsGuard: "error", appointments: 0, records: [] });
    const hidden = await loadHiddenSections("p1");
    expect(hidden).toEqual([]);
    for (const safe of ["emergency", "messages", "vitals", "medications", "care"]) expect(hidden).not.toContain(safe);
  });
});

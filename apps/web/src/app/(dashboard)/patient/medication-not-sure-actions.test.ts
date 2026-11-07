const mockActing = jest.fn();
const mockFrom = jest.fn();
const mockInsert = jest.fn();
let mockCheckin: { data: unknown; error: unknown } = { data: null, error: null };
let mockInsertResult: { error: unknown } = { error: null };

jest.mock("@/lib/acting/acting-for", () => ({ getActingFor: () => mockActing() }));
jest.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "me" } } }) },
    from: (table: string) => {
      mockFrom(table);
      const single = (reply: unknown) => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => reply }), maybeSingle: async () => reply }) });
      if (table === "profiles") return { select: () => single({ data: { organisation_id: "org1" }, error: null }) };
      if (table === "medication_adherence_checkins") return { select: () => single(mockCheckin) };
      if (table === "medications") return { select: () => single({ data: { drug_name: "Amlodipine" }, error: null }) };
      return {
        insert: async (row: unknown) => {
          mockInsert(row);
          return mockInsertResult;
        },
      };
    },
  }),
}));

import { raiseMedicationNotSureTask } from "./medication-not-sure-actions";
import { NOT_SURE_NOTE_PREFIX } from "@/lib/medications/not-sure";

const CHECKIN = "11111111-1111-4111-8111-111111111111";

beforeEach(() => {
  jest.clearAllMocks();
  mockActing.mockResolvedValue(null);
  mockCheckin = { data: { checkin_type: "side_effects", medication_id: "m1" }, error: null };
  mockInsertResult = { error: null };
});

describe("raiseMedicationNotSureTask (P16, CMO decision 2026-11-07)", () => {
  it("raises a routine patient_query flag on the patient's own record for a check-in", async () => {
    expect(await raiseMedicationNotSureTask({ source: "checkin", checkinId: CHECKIN })).toEqual({ ok: true, alreadyRaisedToday: false });
    const row = mockInsert.mock.calls[0][0];
    expect(row).toMatchObject({ organisation_id: "org1", patient_id: "me", medication_id: "m1", flag_type: "patient_query" });
    expect(row.note.startsWith(NOT_SURE_NOTE_PREFIX)).toBe(true);
    expect(row.note).toContain("Amlodipine");
    expect(row.note).toMatch(/Routine/);
  });

  it("raises one for the medication list with no medicine attached", async () => {
    await raiseMedicationNotSureTask({ source: "reconciliation" });
    expect(mockInsert.mock.calls[0][0]).toMatchObject({ patient_id: "me", medication_id: null, flag_type: "patient_query" });
  });

  it("refuses while acting for someone and writes nothing", async () => {
    mockActing.mockResolvedValue({ profileId: "mum", fullName: "Mum" });
    const r = await raiseMedicationNotSureTask({ source: "reconciliation" });
    expect(r.ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("treats the once-a-day limit as already done, not as a failure", async () => {
    mockInsertResult = { error: { code: "23505", message: 'duplicate key value violates unique constraint "medication_dispense_flags_not_sure_one_per_day"' } };
    expect(await raiseMedicationNotSureTask({ source: "reconciliation" })).toEqual({ ok: true, alreadyRaisedToday: true });
  });

  it("reports any other write failure as a failure", async () => {
    mockInsertResult = { error: { code: "42501", message: "new row violates row-level security policy" } };
    expect((await raiseMedicationNotSureTask({ source: "reconciliation" })).ok).toBe(false);
  });

  it("refuses a check-in that is not the caller's own", async () => {
    mockCheckin = { data: null, error: null };
    expect((await raiseMedicationNotSureTask({ source: "checkin", checkinId: CHECKIN })).ok).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects malformed input", async () => {
    expect((await raiseMedicationNotSureTask({ source: "checkin", checkinId: "nope" })).ok).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

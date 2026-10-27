/**
 * S07y: a blood pressure the person took at a pharmacy or clinic machine is saved as an ORDINARY reading with a label. The same on-device check runs, the same
 * emergency guidance appears for a dangerous value, and the label travels with the reading (and with a copy waiting on the phone). Without the tick, nothing
 * about the payload changes.
 */
import { postVitalReading, type VitalReadingPayload } from "./api";
import { planBpLog } from "./bp-checklist";
import { logBpWithExtras } from "./bp-log";
import { discardRejectedRow, flushOutbox, listOutbox } from "./outbox";

let mockInsertError: { code?: string; message?: string } | null = null;
jest.mock("./supabase", () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1" }, error: null }) }) }),
      insert: async () => ({ error: mockInsertError }),
    }),
  },
}));
jest.mock("./api", () => ({ ...(jest.requireActual("./api") as object), postVitalReading: jest.fn() }));
const mockPost = postVitalReading as jest.MockedFunction<typeof postVitalReading>;
const posted: VitalReadingPayload[] = [];

const plan = (systolic = "150", diastolic = "95") => {
  const p = planBpLog({ systolic, diastolic, pulse: "", symptoms: [] }, 6);
  if (!p.ok) throw new Error("bad fixture");
  return p;
};

beforeEach(async () => {
  posted.length = 0;
  mockPost.mockReset();
  mockPost.mockImplementation(async (payload) => {
    posted.push(payload);
    return { success: true };
  });
  mockInsertError = { code: "42501" };
  await flushOutbox();
  for (const row of await listOutbox()) await discardRejectedRow(row.clientId);
  mockInsertError = null;
});

describe("logBpWithExtras: taken at a pharmacy or clinic machine", () => {
  it("sends the label and the place with the reading", async () => {
    await logBpWithExtras(plan(), undefined, undefined, undefined, { entryOrigin: "pharmacy_machine", placeLabel: "Corner Pharmacy" });
    expect(posted[0]).toMatchObject({ vital_type: "blood_pressure", systolic: 150, diastolic: 95, entry_origin: "pharmacy_machine", place_label: "Corner Pharmacy" });
  });

  it("sends the label without a place when none was given", async () => {
    await logBpWithExtras(plan(), undefined, undefined, undefined, { entryOrigin: "pharmacy_machine", placeLabel: null });
    expect(posted[0]).toMatchObject({ entry_origin: "pharmacy_machine" });
    expect(posted[0]).not.toHaveProperty("place_label");
  });

  it("without the tick the payload is exactly what it was", async () => {
    await logBpWithExtras(plan());
    expect(posted[0]).not.toHaveProperty("entry_origin");
    expect(posted[0]).not.toHaveProperty("place_label");
  });

  it("a dangerous value still gets the on-device emergency guidance before anything is saved, label or not", async () => {
    const seen: { labelled: boolean; severity: string | null }[] = [];
    await logBpWithExtras(plan("215", "125"), undefined, undefined, (o) => seen.push({ labelled: true, severity: o.severity }), { entryOrigin: "pharmacy_machine", placeLabel: null });
    await logBpWithExtras(plan("215", "125"), undefined, undefined, (o) => seen.push({ labelled: false, severity: o.severity }));
    expect(seen.map((s) => s.severity)).toEqual(["emergency", "emergency"]);
  });

  it("the reading is still posted as a blood pressure (so the server runs every red-flag engine for it)", async () => {
    await logBpWithExtras(plan("215", "125"), undefined, undefined, undefined, { entryOrigin: "pharmacy_machine", placeLabel: null });
    expect(posted.filter((p) => p.vital_type === "blood_pressure")).toHaveLength(1);
  });
});

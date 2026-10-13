/**
 * The server actions for testing days. What matters here: the screen sends VALUES and never a flag (the database classifies), a
 * refusal from the database becomes a plain sentence and never a raw message, and an ECG file is only stored after the caller has
 * proved they may run a station and is removed again if the database refuses the registration.
 */

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const rpc = jest.fn();
const upload = jest.fn();
const remove = jest.fn();

jest.mock("@/lib/supabase/server", () => ({
  getCurrentUser: jest.fn().mockResolvedValue({ id: "user-1" }),
  createClient: jest.fn().mockResolvedValue({ rpc: (...a: unknown[]) => rpc(...a) }),
}));
jest.mock("@/lib/supabase/service-role", () => ({
  createServiceRoleClient: () => ({ storage: { from: () => ({ upload, remove, createSignedUrl: jest.fn() }) } }),
}));

import { recordEcg, recordUrinalysis, recordMeasurements } from "./actions";

const BOOKING = "11111111-1111-4111-8111-111111111111";
const EVENT = "22222222-2222-4222-8222-222222222222";

function form(entries: Record<string, string | File>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.append(k, v);
  return f;
}

beforeEach(() => {
  rpc.mockReset();
  upload.mockReset();
  remove.mockReset();
  upload.mockResolvedValue({ error: null });
});

describe("recordUrinalysis", () => {
  it("sends the strip readings as values only: no flag, ever", async () => {
    rpc.mockResolvedValue({ data: "result-1", error: null });
    const r = await recordUrinalysis(undefined, form({ bookingId: BOOKING, eventId: EVENT, u_glucose: "2+", u_ph: "6.5", flag: "normal", u_flag: "normal" }));
    expect(r?.error).toBeUndefined();
    const [name, args] = rpc.mock.calls[0] as [string, { p_items: unknown }];
    expect(name).toBe("record_poc_urinalysis");
    expect(JSON.stringify(args.p_items)).not.toContain("flag");
    expect(args.p_items).toEqual([
      { analyte_code: "glucose", value_text: "2+" },
      { analyte_code: "ph", value_numeric: 6.5 },
    ]);
  });

  it("asks for at least one reading and does not call the database without one", async () => {
    const r = await recordUrinalysis(undefined, form({ bookingId: BOOKING, eventId: EVENT }));
    expect(r?.error).toMatch(/at least one/i);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("turns a database refusal into a sentence, not the raw code", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "booking_not_checked_in" } });
    const r = await recordUrinalysis(undefined, form({ bookingId: BOOKING, eventId: EVENT, u_glucose: "negative" }));
    expect(r?.error).toBe("Check this person in at station A first.");
  });

  it("never passes an unknown database message through", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'insert or update on table "poc_results" violates foreign key' } });
    const r = await recordUrinalysis(undefined, form({ bookingId: BOOKING, eventId: EVENT, u_glucose: "negative" }));
    expect(r?.error).toBe("Something went wrong. Please try again.");
  });
});

describe("recordMeasurements", () => {
  it("refuses a malformed blood pressure and does not guess", async () => {
    const r = await recordMeasurements(undefined, form({ bookingId: BOOKING, eventId: EVENT, bp1: "12080" }));
    expect(r?.error).toMatch(/120\/80/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends each protocol reading separately, with the equipment used", async () => {
    rpc.mockResolvedValue({ data: { vitals_rows: 3 }, error: null });
    const r = await recordMeasurements(undefined, form({ bookingId: BOOKING, eventId: EVENT, bp1: "124/80", bp2: "122/78", bpDevice: "A&D UA-651BLE" }));
    expect(r?.message).toBe("Measurements saved.");
    const [, args] = rpc.mock.calls[0] as [string, { p_data: { bp_readings: unknown[]; equipment: { bp: string } } }];
    expect(args.p_data.bp_readings).toEqual([
      { systolic: 124, diastolic: 80 },
      { systolic: 122, diastolic: 78 },
    ]);
    expect(args.p_data.equipment.bp).toBe("A&D UA-651BLE");
  });
});

describe("recordEcg", () => {
  const pdf = () => new File([new Uint8Array([1, 2, 3])], "trace.pdf", { type: "application/pdf" });

  it("stores nothing when the caller may not run a station", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "not authorised" } });
    const r = await recordEcg(undefined, form({ bookingId: BOOKING, eventId: EVENT, file: pdf() }));
    expect(r?.error).toBeTruthy();
    expect(upload).not.toHaveBeenCalled();
  });

  it("refuses a file type that is not a trace before anything is stored", async () => {
    const exe = new File([new Uint8Array([1])], "x.exe", { type: "application/x-msdownload" });
    const r = await recordEcg(undefined, form({ bookingId: BOOKING, eventId: EVENT, file: exe }));
    expect(r?.error).toMatch(/PDF, PNG, JPG or XML/);
    expect(rpc).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });

  it("removes the stored file again if the database refuses to register it", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: null, error: { message: "ecg_already_recorded" } });
    const r = await recordEcg(undefined, form({ bookingId: BOOKING, eventId: EVENT, file: pdf() }));
    expect(r?.error).toBe("An ECG was already recorded for this person.");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0]?.[0]).toEqual([upload.mock.calls[0]?.[0]]);
  });

  it("registers the file and says a doctor will read it; software never reads it", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null }).mockResolvedValueOnce({ data: "ecg-1", error: null });
    const r = await recordEcg(undefined, form({ bookingId: BOOKING, eventId: EVENT, file: pdf(), machineStatement: "Sinus rhythm" }));
    expect(r?.message).toBe("ECG saved. A doctor will read it.");
    expect(remove).not.toHaveBeenCalled();
    const [name, args] = rpc.mock.calls[1] as [string, { p_machine_statement: string }];
    expect(name).toBe("record_poc_ecg");
    expect(args.p_machine_statement).toBe("Sinus rhythm");
  });
});

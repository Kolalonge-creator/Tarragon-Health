/**
 * Guards setLastMenstrualPeriod/recordDelivery/logPostnatalCheckin against
 * writing on a supported person's behalf. patient_pregnancy/
 * postnatal_profiles/postnatal_checkins have no caregiver RLS path at all
 * (see this file's own header comment and
 * docs/archive/mobile-native-conversion/womens-health.md) — a supporter's
 * write is rejected by Postgres regardless of which patientId this file
 * passes, and before this guard that surfaced as a raw RLS
 * policy-violation string in the mobile UI's generic error handling.
 * Mirrors apps/web/src/app/(dashboard)/patient/womens-health-actions.ts's
 * assertNotActingFor guard on this exact table group.
 */
import { supabase } from "./supabase";
import { assertNotActingFor } from "./acting";
import { setLastMenstrualPeriod, recordDelivery, logPostnatalCheckin } from "./womens-health";

jest.mock("./supabase", () => ({
  supabase: { from: jest.fn() },
}));

jest.mock("./acting", () => ({
  assertNotActingFor: jest.fn(),
}));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockAssertNotActingFor = assertNotActingFor as unknown as jest.Mock;

const GUARD_MESSAGE =
  "Pregnancy and postnatal records can only be managed on your own account, not for someone you support.";

function tableStub() {
  return {
    upsert: jest.fn().mockResolvedValue({ error: null }),
    insert: jest.fn().mockResolvedValue({ error: null }),
  };
}

describe("women's health writes refuse a caregiver acting for someone else", () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockAssertNotActingFor.mockReset();
  });

  it("setLastMenstrualPeriod returns the friendly message and never touches the database", async () => {
    mockAssertNotActingFor.mockResolvedValue({ error: GUARD_MESSAGE });

    const result = await setLastMenstrualPeriod("beneficiary-id", "org-1", "2026-01-01");

    expect(result).toEqual({ ok: false, error: GUARD_MESSAGE });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("recordDelivery returns the friendly message and never touches the database", async () => {
    mockAssertNotActingFor.mockResolvedValue({ error: GUARD_MESSAGE });

    const result = await recordDelivery("beneficiary-id", "org-1", {
      delivery_date: "2026-01-01",
      delivery_mode: "vaginal",
    });

    expect(result).toEqual({ ok: false, error: GUARD_MESSAGE });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("logPostnatalCheckin returns the friendly message and never touches the database", async () => {
    mockAssertNotActingFor.mockResolvedValue({ error: GUARD_MESSAGE });

    const result = await logPostnatalCheckin("beneficiary-id", "org-1", "postnatal-profile-1", {
      checkin_window: "week_1",
      contraception_discussed: false,
    });

    expect(result).toEqual({ ok: false, error: GUARD_MESSAGE });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("setLastMenstrualPeriod still writes normally when not acting for anyone", async () => {
    mockAssertNotActingFor.mockResolvedValue(null);
    mockFrom.mockReturnValue(tableStub());

    const result = await setLastMenstrualPeriod("own-id", "org-1", "2026-01-01");

    expect(result).toEqual({ ok: true, data: null });
    expect(mockFrom).toHaveBeenCalledWith("patient_pregnancy");
  });

  it("recordDelivery still writes normally when not acting for anyone", async () => {
    mockAssertNotActingFor.mockResolvedValue(null);
    mockFrom.mockImplementation(() => tableStub());

    const result = await recordDelivery("own-id", "org-1", {
      delivery_date: "2026-01-01",
      delivery_mode: "vaginal",
    });

    expect(result).toEqual({ ok: true, data: null });
    expect(mockFrom).toHaveBeenCalledWith("patient_pregnancy");
    expect(mockFrom).toHaveBeenCalledWith("postnatal_profiles");
  });
});

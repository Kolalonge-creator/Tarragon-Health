/**
 * Regression (S56 review): the belt-and-braces crisis emergency event and the hazardous-alcohol referral discarded their errors, so a
 * failed safety step vanished. They must be reported (Sentry) and must never fail the patient's own saved screen.
 */
import { describe, expect, it, jest, beforeEach } from "@jest/globals";

const captureException = jest.fn();
jest.mock("@sentry/nextjs", () => ({ captureException: (...a: unknown[]) => captureException(...a) }));

const serviceInsert = jest.fn<(rows: unknown) => Promise<{ error: { message: string } | null }>>();
jest.mock("@/lib/supabase/service-role", () => ({ createServiceRoleClient: () => ({ from: () => ({ insert: serviceInsert }) }) }));

const flagAlcohol = jest.fn<() => Promise<void>>();
jest.mock("@/lib/alcohol/escalate", () => ({ flagHazardousAlcoholUse: () => flagAlcohol() }));

import { saveMentalHealthScreens } from "./save-screens";
import type { MentalHealthScreenInput } from "@/lib/validation/mental-health-screen";

function answers(over: Partial<Record<string, number>> = {}): MentalHealthScreenInput {
  const a: Record<string, unknown> = { is_perinatal: false };
  for (let i = 1; i <= 9; i++) a[`phq9_${i}`] = 0;
  for (let i = 1; i <= 7; i++) a[`gad7_${i}`] = 0;
  for (let i = 1; i <= 3; i++) a[`auditc_${i}`] = 0;
  return { ...a, ...over } as unknown as MentalHealthScreenInput;
}

function userClient(opts: { existingEvent: boolean; eventError: string | null; emergencyInsert: jest.Mock }) {
  return {
    from: (table: string) => {
      if (table === "profiles") return { select: () => ({ eq: () => ({ single: async () => ({ data: { organisation_id: "org-1", sex: "female" } }) }) }) };
      if (table === "emergency_events") {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ in: () => ({ gte: () => ({ limit: async () => ({ data: opts.existingEvent ? [{ id: "e1" }] : [] }) }) }) }) }) }),
          insert: (row: unknown) => { opts.emergencyInsert(row); return Promise.resolve({ error: opts.eventError ? { message: opts.eventError } : null }); },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as never;
}

beforeEach(() => {
  captureException.mockReset();
  serviceInsert.mockReset();
  serviceInsert.mockResolvedValue({ error: null });
  flagAlcohol.mockReset();
  flagAlcohol.mockResolvedValue();
});

describe("saveMentalHealthScreens", () => {
  it("reports a failed fallback crisis event to Sentry and still saves and returns crisis", async () => {
    const emergencyInsert = jest.fn();
    const res = await saveMentalHealthScreens({
      userClient: userClient({ existingEvent: false, eventError: "rls says no", emergencyInsert }),
      userId: "u1",
      answers: answers({ phq9_9: 2 }),
    });
    expect(res).toEqual({ ok: true, crisis: true, told: false });
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(String((captureException.mock.calls[0]?.[0] as Error).message)).toMatch(/rls says no/);
    // the event text names nothing (INV-07)
    expect(JSON.stringify(emergencyInsert.mock.calls[0]?.[0])).not.toMatch(/self-harm|PHQ|EPDS/i);
  });
  it("raises no second event when the database trigger already did", async () => {
    const emergencyInsert = jest.fn();
    const res = await saveMentalHealthScreens({ userClient: userClient({ existingEvent: true, eventError: null, emergencyInsert }), userId: "u1", answers: answers({ phq9_9: 1 }) });
    expect(res).toEqual({ ok: true, crisis: true, told: true });
    expect(emergencyInsert).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });
  it("reports a failed hazardous-alcohol referral and does not fail the screen", async () => {
    flagAlcohol.mockRejectedValue(new Error("alert insert failed"));
    const res = await saveMentalHealthScreens({
      userClient: userClient({ existingEvent: false, eventError: null, emergencyInsert: jest.fn() }),
      userId: "u1",
      answers: answers({ auditc_1: 4, auditc_2: 4, auditc_3: 4 }),
    });
    expect(res).toEqual({ ok: true, crisis: false, told: false });
    expect(captureException).toHaveBeenCalledTimes(1);
  });
  it("says the care team was told when the fallback event is raised", async () => {
    const res = await saveMentalHealthScreens({ userClient: userClient({ existingEvent: false, eventError: null, emergencyInsert: jest.fn() }), userId: "u1", answers: answers({ phq9_9: 3 }) });
    expect(res).toEqual({ ok: true, crisis: true, told: true });
  });
  it("returns an error when the screen itself cannot be saved", async () => {
    serviceInsert.mockResolvedValue({ error: { message: "db down" } });
    const res = await saveMentalHealthScreens({ userClient: userClient({ existingEvent: false, eventError: null, emergencyInsert: jest.fn() }), userId: "u1", answers: answers() });
    expect(res).toEqual({ ok: false, error: "db down" });
  });
});

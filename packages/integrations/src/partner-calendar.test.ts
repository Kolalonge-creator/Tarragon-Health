import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { createMockPartnerCalendar } from "../../../supabase/functions/_shared/integrations/index.ts";

const F = "facility-1";
const slot = (h: string) => ({ startsAt: `2026-10-12T${h}:00:00Z`, endsAt: `2026-10-12T${h}:30:00Z` });

describe("mock partner calendar (S65, no real adapter exists)", () => {
  it("lists, books once and refuses a taken slot", async () => {
    const c = createMockPartnerCalendar();
    c.setSlots(F, [slot("09"), slot("10")]);
    const l = await c.listSlots(F, "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z");
    expect(l.ok && l.data.length).toBe(2);
    const b = await c.book({ bookingId: "b1", facilityId: F, startsAt: slot("09").startsAt });
    expect(b.ok).toBe(true);
    const again = await c.book({ bookingId: "b2", facilityId: F, startsAt: slot("09").startsAt });
    expect(again.ok === false && again.error.code).toBe("conflict");
  });
  it("a retried booking id is not double booked", async () => {
    const c = createMockPartnerCalendar();
    c.setSlots(F, [slot("09")]);
    const a = await c.book({ bookingId: "b1", facilityId: F, startsAt: slot("09").startsAt });
    const b = await c.book({ bookingId: "b1", facilityId: F, startsAt: slot("09").startsAt });
    expect(a).toEqual(b);
    expect(c.booked.length).toBe(1);
  });
  it("fails once as a value, never throws, then recovers; cancel frees the slot", async () => {
    const c = createMockPartnerCalendar();
    c.setSlots(F, [slot("09")]);
    c.failNextCall();
    const f = await c.listSlots(F, "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z");
    expect(f.ok === false && f.error.retryable).toBe(true);
    await c.book({ bookingId: "b1", facilityId: F, startsAt: slot("09").startsAt });
    expect((await c.cancel("b1")).ok).toBe(true);
    const l = await c.listSlots(F, "2026-10-12T00:00:00Z", "2026-10-13T00:00:00Z");
    expect(l.ok && l.data.length).toBe(1);
    expect((await c.cancel("nope")).ok).toBe(false);
  });
  it("is never selected from the environment: no real adapter is fabricated", () => {
    const src = readFileSync(new URL("../../../supabase/functions/_shared/integrations/from-env.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/partner.?calendar/i);
  });
});

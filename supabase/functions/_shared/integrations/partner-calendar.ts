import { fail, ok, type ProviderResult } from "./result.ts";

/**
 * Partner calendar sync (S65, spec 15.9): the interface a partner facility's booking calendar would implement, and a mock. NO real
 * adapter exists. No partner beyond Synlab is contracted and nothing here pretends otherwise: until a partner offers a calendar and a real
 * adapter is written, a facility booking stays a request that a staff member confirms by phone (`confirmation_source = 'staff_phone'`).
 * `from-env.ts` deliberately has no partner-calendar entry, so a missing real adapter is "not configured", never a quiet mock.
 *
 * Booking details given to a partner carry no condition or reading (INV-07): a facility id, a slot and an opaque booking id.
 */
export interface CalendarSlot {
  readonly startsAt: string;
  readonly endsAt: string;
}
export interface PartnerCalendarBooking {
  /** Our booking id. The partner stores it so a retried call never double-books. */
  readonly bookingId: string;
  readonly facilityId: string;
  readonly startsAt: string;
}
export interface PartnerCalendarProvider {
  readonly name: "mock";
  readonly isMock: boolean;
  listSlots(facilityId: string, fromIso: string, toIso: string): Promise<ProviderResult<readonly CalendarSlot[]>>;
  book(input: PartnerCalendarBooking): Promise<ProviderResult<{ readonly partnerReference: string }>>;
  cancel(bookingId: string): Promise<ProviderResult<{ readonly cancelled: true }>>;
}

export interface MockPartnerCalendarControl {
  /** Replace the open slots a facility offers. */
  setSlots(facilityId: string, slots: readonly CalendarSlot[]): void;
  readonly booked: readonly PartnerCalendarBooking[];
  failNextCall(): void;
}

export function createMockPartnerCalendar(): PartnerCalendarProvider & MockPartnerCalendarControl {
  const slots = new Map<string, CalendarSlot[]>();
  const booked: PartnerCalendarBooking[] = [];
  const refs = new Map<string, string>();
  let failNext = false;
  const guard = (): ProviderResult<never> | null => {
    if (!failNext) return null;
    failNext = false;
    return fail("network", "Could not reach the partner calendar");
  };

  return {
    name: "mock",
    isMock: true,
    booked,
    setSlots(facilityId, s) {
      slots.set(facilityId, [...s]);
    },
    failNextCall() {
      failNext = true;
    },
    async listSlots(facilityId, fromIso, toIso) {
      const failed = guard();
      if (failed) return failed;
      const from = Date.parse(fromIso);
      const to = Date.parse(toIso);
      if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return fail("invalid_input", "Choose a valid time range");
      return ok((slots.get(facilityId) ?? []).filter((s) => Date.parse(s.startsAt) >= from && Date.parse(s.endsAt) <= to));
    },
    async book(input) {
      const failed = guard();
      if (failed) return failed;
      const existing = refs.get(input.bookingId);
      if (existing) return ok({ partnerReference: existing });
      const list = slots.get(input.facilityId) ?? [];
      const i = list.findIndex((s) => s.startsAt === input.startsAt);
      if (i < 0) return fail("conflict", "That slot is no longer open", false);
      list.splice(i, 1);
      booked.push(input);
      const ref = `mock-cal-${booked.length}`;
      refs.set(input.bookingId, ref);
      return ok({ partnerReference: ref });
    },
    async cancel(bookingId) {
      const failed = guard();
      if (failed) return failed;
      const i = booked.findIndex((b) => b.bookingId === bookingId);
      if (i < 0) return fail("not_found", "No such booking", false);
      const [b] = booked.splice(i, 1);
      refs.delete(bookingId);
      const list = slots.get(b!.facilityId) ?? [];
      list.push({ startsAt: b!.startsAt, endsAt: b!.startsAt });
      slots.set(b!.facilityId, list);
      return ok({ cancelled: true });
    },
  };
}

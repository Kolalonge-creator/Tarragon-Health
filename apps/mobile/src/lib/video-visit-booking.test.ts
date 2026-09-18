/**
 * video-visit-booking.ts mixes two shapes: plain RLS-scoped Supabase reads
 * (slots/price/my requests/cancel) and two api.ts passthrough wrappers for
 * the writes that need more than the mobile client's own session (reserving
 * against platform credit, picking a doctor's alternate slot) — see the
 * module header. These tests cover the shaping/branching this file itself
 * does, not request()'s own auth/retry policy (api.test.ts) or the RPC/route
 * logic itself (exercised server-side).
 */
import { supabase } from "./supabase";
import { postVideoVisitRequestWithPlatformCredit, postSelectVideoVisitAlternateSlot } from "./api";
import {
  loadOpenVideoVisitSlots,
  loadVideoVisitPrice,
  loadMyVideoVisitRequests,
  requestVideoVisitWithPlatformCredit,
  cancelVideoVisitRequest,
  selectVideoVisitAlternateSlot,
} from "./video-visit-booking";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn() } }));
jest.mock("./api", () => ({
  postVideoVisitRequestWithPlatformCredit: jest.fn(),
  postSelectVideoVisitAlternateSlot: jest.fn(),
}));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockRequestWithCredit = postVideoVisitRequestWithPlatformCredit as jest.MockedFunction<
  typeof postVideoVisitRequestWithPlatformCredit
>;
const mockSelectAlternate = postSelectVideoVisitAlternateSlot as jest.MockedFunction<
  typeof postSelectVideoVisitAlternateSlot
>;

/** One chainable stub covering every query shape this module builds —
 * select/eq/gt/is/order/limit/in/delete all just return the same builder,
 * and awaiting it (no .single()/.maybeSingle() call site in this module)
 * resolves to {data, error}. Mirrors emergency.test.ts's table() helper. */
function table(data: unknown, error: unknown = null) {
  const builder: Record<string, unknown> = {
    then: (resolve: (value: { data: unknown; error: unknown }) => unknown) =>
      Promise.resolve({ data, error }).then(resolve),
  };
  for (const method of ["select", "eq", "gt", "is", "order", "limit", "in", "delete"]) {
    builder[method] = () => builder;
  }
  return builder;
}

function seedTables(tables: Record<string, unknown>) {
  mockFrom.mockImplementation((name: string) => tables[name] ?? table(null, "unexpected table: " + name));
}

describe("loadOpenVideoVisitSlots", () => {
  it("returns the open slots as-is", async () => {
    const slots = [{ id: "s1", slot_start: "2026-09-20T09:00:00Z", clinician: { full_name: "Ada" } }];
    seedTables({ consult_availability_slots: table(slots) });
    await expect(loadOpenVideoVisitSlots()).resolves.toEqual({ ok: true, data: slots });
  });

  it("surfaces a query error", async () => {
    seedTables({ consult_availability_slots: table(null, { message: "boom" }) });
    await expect(loadOpenVideoVisitSlots()).resolves.toEqual({ ok: false, error: "boom" });
  });
});

describe("loadVideoVisitPrice", () => {
  it("prefers the caller's own org override over the platform default", async () => {
    seedTables({
      video_visit_prices: table([
        { organisation_id: null, amount_minor: 500000, currency: "NGN", is_enabled: true },
        { organisation_id: "org-1", amount_minor: 300000, currency: "NGN", is_enabled: true },
      ]),
    });
    await expect(loadVideoVisitPrice("org-1")).resolves.toEqual({
      ok: true,
      data: { organisation_id: "org-1", amount_minor: 300000, currency: "NGN", is_enabled: true },
    });
  });

  it("falls back to the platform default when the caller's org has no override", async () => {
    seedTables({
      video_visit_prices: table([{ organisation_id: null, amount_minor: 500000, currency: "NGN", is_enabled: true }]),
    });
    await expect(loadVideoVisitPrice("org-2")).resolves.toEqual({
      ok: true,
      data: { organisation_id: null, amount_minor: 500000, currency: "NGN", is_enabled: true },
    });
  });

  it("returns null when no price is enabled at all, not an error", async () => {
    seedTables({ video_visit_prices: table([]) });
    await expect(loadVideoVisitPrice("org-1")).resolves.toEqual({ ok: true, data: null });
  });
});

describe("loadMyVideoVisitRequests", () => {
  it("resolves proposed_slot_ids against consult_availability_slots and attaches proposedSlots", async () => {
    seedTables({
      video_visit_requests: table([
        {
          id: "req-1",
          status: "alternate_proposed",
          proposed_slot_ids: ["slot-a", "slot-b"],
          slot: { slot_start: "2026-09-20T09:00:00Z" },
        },
      ]),
      consult_availability_slots: table([
        { id: "slot-a", slot_start: "2026-09-21T09:00:00Z" },
        { id: "slot-b", slot_start: "2026-09-21T11:00:00Z" },
      ]),
    });

    const result = await loadMyVideoVisitRequests("patient-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toHaveLength(1);
    expect(result.data[0].proposedSlots).toEqual([
      { id: "slot-a", slot_start: "2026-09-21T09:00:00Z" },
      { id: "slot-b", slot_start: "2026-09-21T11:00:00Z" },
    ]);
  });

  it("skips the follow-up slots query entirely when nothing has proposed_slot_ids", async () => {
    const secondQuery = jest.fn();
    seedTables({
      video_visit_requests: table([
        { id: "req-1", status: "payment_confirmed", proposed_slot_ids: null, slot: null },
      ]),
      consult_availability_slots: { select: secondQuery },
    });

    const result = await loadMyVideoVisitRequests("patient-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0].proposedSlots).toEqual([]);
    expect(secondQuery).not.toHaveBeenCalled();
  });

  it("surfaces a query error on the primary request", async () => {
    seedTables({ video_visit_requests: table(null, { message: "boom" }) });
    await expect(loadMyVideoVisitRequests("patient-1")).resolves.toEqual({ ok: false, error: "boom" });
  });
});

describe("cancelVideoVisitRequest", () => {
  it("deletes the request", async () => {
    seedTables({ video_visit_requests: table(null) });
    await expect(cancelVideoVisitRequest("req-1")).resolves.toEqual({ ok: true, data: null });
  });

  it("surfaces a delete error", async () => {
    seedTables({ video_visit_requests: table(null, { message: "not allowed" }) });
    await expect(cancelVideoVisitRequest("req-1")).resolves.toEqual({ ok: false, error: "not allowed" });
  });
});

describe("requestVideoVisitWithPlatformCredit", () => {
  it("maps a successful reservation", async () => {
    mockRequestWithCredit.mockResolvedValue({ ok: true, request_id: "req-1", amount_kobo: 500000 });
    await expect(requestVideoVisitWithPlatformCredit("slot-1")).resolves.toEqual({
      ok: true,
      data: { requestId: "req-1", amountKobo: 500000 },
    });
    expect(mockRequestWithCredit).toHaveBeenCalledWith("slot-1", undefined);
  });

  it("surfaces the server's human-readable error on insufficient balance", async () => {
    mockRequestWithCredit.mockResolvedValue({
      ok: false,
      reason: "insufficient_balance",
      balance_kobo: 100000,
      required_kobo: 500000,
      shortfall_kobo: 400000,
      error: "You need ₦4,000 more in platform credit to reserve this visit.",
    });
    await expect(requestVideoVisitWithPlatformCredit("slot-1")).resolves.toEqual({
      ok: false,
      error: "You need ₦4,000 more in platform credit to reserve this visit.",
    });
  });
});

describe("selectVideoVisitAlternateSlot", () => {
  it("returns the new consultation id on success", async () => {
    mockSelectAlternate.mockResolvedValue({ success: true, consultationId: "consult-1" });
    await expect(selectVideoVisitAlternateSlot("req-1", "slot-b")).resolves.toEqual({
      ok: true,
      data: "consult-1",
    });
  });

  it("surfaces a failure without a consultation id", async () => {
    mockSelectAlternate.mockResolvedValue({ error: "that time is no longer available" });
    await expect(selectVideoVisitAlternateSlot("req-1", "slot-b")).resolves.toEqual({
      ok: false,
      error: "that time is no longer available",
    });
  });
});

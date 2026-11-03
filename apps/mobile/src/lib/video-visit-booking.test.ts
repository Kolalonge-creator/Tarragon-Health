/**
 * video-visit-booking.ts mixes two shapes: plain RLS-scoped Supabase reads
 * (slots/price/my requests/cancel) and one api.ts passthrough wrapper for
 * the write that needs more than the mobile client's own session (picking a
 * doctor's alternate slot) — see the module header. These tests cover the
 * shaping/branching this file itself does, not request()'s own auth/retry policy (api.test.ts) or the RPC/route
 * logic itself (exercised server-side).
 */
import { supabase } from "./supabase";
import { postSelectVideoVisitAlternateSlot } from "./api";
import {
  loadOpenVideoVisitSlots,
  loadVideoVisitPrice,
  parseVideoVisitPrice,
  loadMyVideoVisitRequests,
  cancelVideoVisitRequest,
  selectVideoVisitAlternateSlot,
} from "./video-visit-booking";

jest.mock("./supabase", () => ({ supabase: { from: jest.fn(), rpc: jest.fn() } }));
jest.mock("./api", () => ({
  postSelectVideoVisitAlternateSlot: jest.fn(),
}));

const mockFrom = supabase.from as unknown as jest.Mock;
const mockRpc = supabase.rpc as unknown as jest.Mock;
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
  it("returns the price the database charges, from my_video_visit_price", async () => {
    mockRpc.mockResolvedValueOnce({ data: { amount_minor: 800000, currency: "NGN" }, error: null });
    await expect(loadVideoVisitPrice()).resolves.toEqual({ ok: true, data: { amount_minor: 800000, currency: "NGN" } });
    expect(mockRpc).toHaveBeenCalledWith("my_video_visit_price");
    expect(mockFrom).not.toHaveBeenCalledWith("video_visit_prices");
  });

  it("returns null when no price is set or it is switched off, not an error", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(loadVideoVisitPrice()).resolves.toEqual({ ok: true, data: null });
  });

  it("surfaces an error from the function", async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    await expect(loadVideoVisitPrice()).resolves.toEqual({ ok: false, error: "boom" });
  });
});

describe("parseVideoVisitPrice", () => {
  it.each([
    ["a string", "800000"],
    ["a missing amount", { currency: "NGN" }],
    ["a zero amount", { amount_minor: 0, currency: "NGN" }],
    ["a fractional amount", { amount_minor: 1.5, currency: "NGN" }],
    ["a missing currency", { amount_minor: 800000 }],
  ])("treats %s as no price", (_label, value) => {
    expect(parseVideoVisitPrice(value)).toBeNull();
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

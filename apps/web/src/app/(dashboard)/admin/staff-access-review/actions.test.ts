/**
 * Security audit 2026-11-05, Phase 3: the staff access review actions. The rules live in the database; these tests pin that
 * the form is validated before any call, that a database sentence reaches the admin, and that a raw database error does not.
 */
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
const rpc = jest.fn();
jest.mock("@/lib/supabase/server", () => ({ createClient: jest.fn(async () => ({ rpc })) }));

import { completeReview, decideItem, startReview } from "./actions";

const ITEM = "11111111-1111-4111-8111-111111111111";
const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeEach(() => {
  rpc.mockReset().mockResolvedValue({ data: null, error: null });
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("decideItem", () => {
  it("records keep with no note", async () => {
    expect(await decideItem(undefined, form({ itemId: ITEM, decision: "keep" }))).toEqual({ message: "Saved." });
    expect(rpc).toHaveBeenCalledWith("decide_staff_access_review_item", { p_item: ITEM, p_decision: "keep", p_note: null });
  });

  it("refuses remove with no reason before calling the database", async () => {
    const r = await decideItem(undefined, form({ itemId: ITEM, decision: "remove", note: "" }));
    expect(r?.error).toMatch(/what should change and why/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("passes the reason with remove", async () => {
    await decideItem(undefined, form({ itemId: ITEM, decision: "remove", note: "Left the team in October" }));
    expect(rpc).toHaveBeenCalledWith("decide_staff_access_review_item", { p_item: ITEM, p_decision: "remove", p_note: "Left the team in October" });
  });

  it("refuses an unknown decision or a malformed id", async () => {
    expect((await decideItem(undefined, form({ itemId: ITEM, decision: "delete" })))?.error).toBeTruthy();
    expect((await decideItem(undefined, form({ itemId: "x", decision: "keep" })))?.error).toBeTruthy();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("database answers", () => {
  it("shows a sentence the database raised on purpose", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "P0001", message: "A staff access review is already open. Finish it first." } });
    expect(await startReview()).toEqual({ error: "A staff access review is already open. Finish it first." });
  });

  it("never shows a raw database error", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "23503", message: 'insert violates foreign key constraint "staff_access_review_items_profile_id_fkey"' } });
    const r = await completeReview(undefined, form({ reviewId: ITEM }));
    expect(r?.error).toBe("Something went wrong. Please try again.");
  });
});

import { answerProxyReview, dueReviews, loadProxyReviews, reviewCategoryLabel, type ProxyReviewRow } from "./proxy-review";
import { supabase } from "./supabase";

jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;

const RAW = {
  grant_id: "g1",
  grantee_id: "u2",
  first_name: "Ada",
  since: "2025-10-01T00:00:00Z",
  categories: ["medications", "vitals_readings"],
  due_at: "2026-10-01T00:00:00Z",
  is_due: true,
  days_overdue: 19,
  last_reviewed_at: null,
};

beforeEach(() => rpc.mockReset());

describe("loadProxyReviews", () => {
  it("maps the rows", async () => {
    rpc.mockResolvedValueOnce({ data: [RAW], error: null });
    const out = await loadProxyReviews();
    expect(out).toEqual({ ok: true, rows: [expect.objectContaining({ grantId: "g1", firstName: "Ada", isDue: true, daysOverdue: 19 })] });
  });
  it("a failed read is not an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadProxyReviews()).toEqual({ ok: false });
  });
  it("a malformed row fails the whole read instead of being skipped", async () => {
    rpc.mockResolvedValueOnce({ data: [RAW, { ...RAW, grant_id: 5 }], error: null });
    expect(await loadProxyReviews()).toEqual({ ok: false });
  });
  it("a real empty list is an empty list", async () => {
    rpc.mockResolvedValueOnce({ data: [], error: null });
    expect(await loadProxyReviews()).toEqual({ ok: true, rows: [] });
  });
});

describe("dueReviews", () => {
  const row = (over: Partial<ProxyReviewRow>): ProxyReviewRow => ({ grantId: "g", granteeId: "u", firstName: "A", since: "", categories: [], dueAt: "2026-01-01", isDue: true, daysOverdue: 0, lastReviewedAt: null, ...over });
  it("keeps due rows only, oldest first", () => {
    const out = dueReviews([row({ grantId: "late", dueAt: "2026-05-01" }), row({ grantId: "no", isDue: false }), row({ grantId: "early", dueAt: "2026-02-01" })]);
    expect(out.map((r) => r.grantId)).toEqual(["early", "late"]);
  });
});

describe("answerProxyReview", () => {
  it("keep sends no categories and no notify flag", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await answerProxyReview("u2", { action: "keep" });
    expect(rpc).toHaveBeenCalledWith("answer_proxy_review", { p_grantee: "u2", p_action: "keep" });
  });
  it("narrow sends the kept categories and never tells the proxy", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    await answerProxyReview("u2", { action: "narrow", keep: ["medications"] });
    expect(rpc).toHaveBeenCalledWith("answer_proxy_review", { p_grantee: "u2", p_action: "narrow", p_categories: ["medications"], p_notify: false });
  });
  it("removing access that is already gone counts as done", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "P0002", message: "gone" } });
    expect(await answerProxyReview("u2", { action: "remove" })).toEqual({ ok: true });
  });
  it("narrowing against a changed list says it changed; any other error is a plain failure", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "22023", message: "x" } });
    expect(await answerProxyReview("u2", { action: "narrow", keep: ["medications"] })).toEqual({ ok: false, reason: "changed" });
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "x" } });
    expect(await answerProxyReview("u2", { action: "keep" })).toEqual({ ok: false, reason: "failed" });
  });
  it("a removal that really fails elsewhere is not hidden", async () => {
    rpc.mockResolvedValueOnce({ error: { code: "XX000", message: "x" } });
    expect(await answerProxyReview("u2", { action: "remove" })).toEqual({ ok: false, reason: "failed" });
  });
});

describe("reviewCategoryLabel", () => {
  it("falls back instead of showing a raw code", () => {
    expect(reviewCategoryLabel("not_a_category")).toBe("Something else");
    expect(reviewCategoryLabel("medications")).not.toBe("Something else");
  });
});

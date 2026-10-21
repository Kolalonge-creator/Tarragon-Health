import { createShare, fetchShl, loadMyShares, openShares, revokeShare, shareUrl, viewsLeft, isUsedUp, sessionEnded, deadReason, SHARE_MAX_VIEWS_CHOICES, SHARE_WINDOW_DAYS_CHOICES, getSharingOffer, expiryText, type RecordShareRow } from "./record-share";
import { supabase } from "./supabase";

const chain = { select: jest.fn(), eq: jest.fn(), order: jest.fn(), limit: jest.fn(), maybeSingle: jest.fn() };
jest.mock("./supabase", () => ({ supabase: { rpc: jest.fn(), from: jest.fn() } }));
const rpc = supabase.rpc as unknown as jest.Mock;
const from = supabase.from as unknown as jest.Mock;

const row = (over: Partial<RecordShareRow> = {}): RecordShareRow => ({
  id: "s1", token: "t".repeat(64), sections: ["vitals"], expiresAt: "2099-01-01T00:00:00Z", isActive: true, viewCount: 0,
  pinProtected: false, oneSession: false, lockedAt: null, revokedAt: null, recipientLabel: null, maxViews: null, windowDays: null, firstOpenedAt: null, ...over,
});

beforeEach(() => {
  rpc.mockReset();
  from.mockReset();
  for (const k of Object.keys(chain)) (chain as Record<string, jest.Mock>)[k]?.mockReset();
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  from.mockReturnValue(chain);
});

describe("choices", () => {
  it("stay inside the database limits", () => {
    expect(Math.min(...SHARE_MAX_VIEWS_CHOICES)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...SHARE_MAX_VIEWS_CHOICES)).toBeLessThanOrEqual(50);
    expect([...SHARE_WINDOW_DAYS_CHOICES]).toEqual([30, 90, 180]);
  });
  it("offers expiry options from the shared configuration", () => {
    const o = getSharingOffer();
    expect(o.expiryOptionsHours).toContain(o.defaultExpiryHours);
    expect(expiryText(24)).toBe("1 day");
    expect(expiryText(72)).toBe("3 days");
    expect(expiryText(6)).toBe("6 hours");
  });
});

describe("viewsLeft / shareUrl / openShares", () => {
  it("counts down and never goes below zero; null when there is no cap", () => {
    expect(viewsLeft(null, 4)).toBeNull();
    expect(viewsLeft(3, 1)).toBe(2);
    expect(viewsLeft(3, 9)).toBe(0);
  });
  it("builds the public link", () => {
    expect(shareUrl("abc")).toMatch(/\/share\/abc$/);
  });
  it("hides revoked, locked, expired and inactive links", () => {
    const rows = [row({ id: "ok" }), row({ id: "rev", revokedAt: "2026-01-01" }), row({ id: "lock", lockedAt: "2026-01-01" }), row({ id: "old", expiresAt: "2020-01-01T00:00:00Z" }), row({ id: "off", isActive: false })];
    expect(openShares(rows).map((r) => r.id)).toEqual(["ok"]);
  });
});

describe("loadMyShares", () => {
  it("maps rows", async () => {
    chain.limit.mockResolvedValueOnce({
      data: [{ id: "s1", token: "t", sections: ["vitals"], expires_at: "2099-01-01T00:00:00Z", is_active: true, view_count: 2, pin_protected: true, one_session: false, locked_at: null, revoked_at: null, recipient_label: "Dr A", max_views: 3, window_days: 30 }],
      error: null,
    });
    const out = await loadMyShares("u1");
    expect(chain.eq).toHaveBeenCalledWith("patient_id", "u1");
    expect(out).toEqual({ ok: true, data: [expect.objectContaining({ id: "s1", pinProtected: true, recipientLabel: "Dr A", maxViews: 3, windowDays: 30 })] });
  });
  it("a failed read is a failure, not an empty list", async () => {
    chain.limit.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await loadMyShares("u1")).toEqual({ ok: false });
  });
});

describe("createShare", () => {
  const input = { sections: ["vitals" as const], expiresInHours: 24, usePin: true, oneSession: false, recipientLabel: "  Dr Okafor  ", maxViews: 3, windowDays: 90 };
  it("sends the options as the web does, trims the label", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "s1", token: "tok", pin: "123456" }, error: null });
    const out = await createShare(input);
    expect(rpc).toHaveBeenCalledWith("create_record_share_with_options", {
      p_sections: ["vitals"], p_expires_in_hours: 24, p_use_pin: true, p_one_session: false, p_recipient_label: "Dr Okafor", p_max_views: 3, p_window_days: 90,
    });
    expect(out).toEqual({ ok: true, data: { id: "s1", token: "tok", pin: "123456" } });
  });
  it("sends null for an empty label and no limits", async () => {
    rpc.mockResolvedValueOnce({ data: { id: "s1", token: "tok" }, error: null });
    await createShare({ ...input, recipientLabel: "   ", maxViews: null, windowDays: null, usePin: false });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_recipient_label: null, p_max_views: null, p_window_days: null });
  });
  it("an error or a malformed answer is a failure", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "x" } });
    expect(await createShare(input)).toEqual({ ok: false });
    rpc.mockResolvedValueOnce({ data: { nope: 1 }, error: null });
    expect(await createShare(input)).toEqual({ ok: false });
  });
});

describe("revokeShare", () => {
  it("revokes by id and reports failure", async () => {
    rpc.mockResolvedValueOnce({ error: null });
    expect(await revokeShare("s1")).toEqual({ ok: true, data: null });
    expect(rpc).toHaveBeenCalledWith("revoke_record_share", { p_share_id: "s1" });
    rpc.mockResolvedValueOnce({ error: { message: "x" } });
    expect(await revokeShare("s1")).toEqual({ ok: false });
  });
  it("counts a link as already stopped only when the row really is stopped", async () => {
    rpc.mockResolvedValue({ error: { message: "share not found or already revoked" } });
    chain.maybeSingle.mockResolvedValueOnce({ data: { is_active: false, revoked_at: "2026-10-01T00:00:00Z" } });
    expect(await revokeShare("s1")).toEqual({ ok: true, data: null });
    // read back for the person's own row only
    chain.maybeSingle.mockResolvedValueOnce({ data: { is_active: false, revoked_at: "2026-10-01T00:00:00Z" } });
    expect(await revokeShare("s1", "user-1")).toEqual({ ok: true, data: null });
    expect(chain.eq).toHaveBeenCalledWith("patient_id", "user-1");
    // still active (the id was not the person's, or the update matched nothing): it is NOT stopped
    chain.maybeSingle.mockResolvedValueOnce({ data: { is_active: true, revoked_at: null } });
    expect(await revokeShare("s1")).toEqual({ ok: false });
    // no row visible at all
    chain.maybeSingle.mockResolvedValueOnce({ data: null });
    expect(await revokeShare("s1")).toEqual({ ok: false });
  });
});

describe("deadReason", () => {
  const now = new Date("2026-10-21T12:00:00Z").getTime();
  it("a one-session link is dead once its window since the first opening has passed, and not before", () => {
    expect(sessionEnded({ oneSession: true, firstOpenedAt: "2026-10-21T11:00:00Z" }, 30, now)).toBe(true);
    expect(sessionEnded({ oneSession: true, firstOpenedAt: "2026-10-21T11:45:00Z" }, 30, now)).toBe(false);
    expect(sessionEnded({ oneSession: true, firstOpenedAt: null }, 30, now)).toBe(false);
    expect(sessionEnded({ oneSession: false, firstOpenedAt: "2020-01-01T00:00:00Z" }, 30, now)).toBe(false);
    expect(sessionEnded({ oneSession: true, firstOpenedAt: "garbage" }, 30, now)).toBe(false);
  });
  it("names the reason, views first", () => {
    expect(deadReason({ maxViews: 1, viewCount: 1, oneSession: true, firstOpenedAt: "2020-01-01T00:00:00Z" }, 30, now)).toBe("used_up");
    expect(deadReason({ maxViews: null, viewCount: 0, oneSession: true, firstOpenedAt: "2020-01-01T00:00:00Z" }, 30, now)).toBe("session_ended");
    expect(deadReason({ maxViews: null, viewCount: 0, oneSession: false, firstOpenedAt: null }, 30, now)).toBeNull();
  });
});

describe("isUsedUp", () => {
  it("is true only for a capped link with no views left", () => {
    expect(isUsedUp({ maxViews: 3, viewCount: 3 })).toBe(true);
    expect(isUsedUp({ maxViews: 3, viewCount: 5 })).toBe(true);
    expect(isUsedUp({ maxViews: 3, viewCount: 2 })).toBe(false);
    expect(isUsedUp({ maxViews: null, viewCount: 99 })).toBe(false);
  });
});

describe("fetchShl", () => {
  const okFetch = (status: number, body: unknown) => jest.fn().mockResolvedValue({ status, json: async () => body });
  it("returns the link, sending only the bearer token and the share id", async () => {
    const f = okFetch(200, { link: "shlink:/abc" });
    expect(await fetchShl("jwt", "s 1", f, "https://x.test")).toEqual({ kind: "ok", link: "shlink:/abc" });
    expect(f).toHaveBeenCalledWith("https://x.test/api/mobile/share-shl?id=s%201", expect.objectContaining({ headers: { Authorization: "Bearer jwt" } }));
  });
  it("is unavailable without a session, on a refusal, or on a body that is not a link", async () => {
    expect(await fetchShl(null, "s1", okFetch(200, {}), "https://x.test")).toEqual({ kind: "unavailable" });
    expect(await fetchShl("jwt", "s1", okFetch(404, { error: "not_found" }), "https://x.test")).toEqual({ kind: "unavailable" });
    expect(await fetchShl("jwt", "s1", okFetch(200, { link: "https://evil.test" }), "https://x.test")).toEqual({ kind: "unavailable" });
  });
  it("reports a network failure separately", async () => {
    expect(await fetchShl("jwt", "s1", jest.fn().mockRejectedValue(new Error("offline")), "https://x.test")).toEqual({ kind: "network" });
  });
});

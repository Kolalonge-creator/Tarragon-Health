const mockRpc = jest.fn();
const mockGetSession = jest.fn();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => mockRpc(...args), auth: { getSession: () => mockGetSession() } },
}));

import { deletePost, getAccessToken, hideAuthor, joinGroup, loadFeed, reactToPost, reportPost, searchGroups, submitAppeal, submitPost, uploadPostWithImage, alertEmergencyContactFromCard } from "./api";
import { buildPostUpload } from "./upload";

const ok = (data: unknown) => ({ data, error: null, status: 200 });
const list = { open: true, adult: true, groups: [] };

beforeEach(() => {
  mockRpc.mockReset();
  mockGetSession.mockReset();
});

describe("joinGroup", () => {
  it("sends nothing until both ticks are given", async () => {
    const r = await joinGroup({ groupId: "g", rulesVersion: 1, rulesAcknowledged: true, consent: false });
    expect(r).toEqual({ ok: false, key: "community.join.refused.consent_needed", definite: true });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("sends the group's own rules version and the consent", async () => {
    mockRpc.mockResolvedValue(ok({ status: "joined", handle: "Quiet Heron", avatar_code: "leaf" }));
    const r = await joinGroup({ groupId: "g", rulesVersion: 4, rulesAcknowledged: true, consent: true });
    expect(mockRpc).toHaveBeenCalledWith("community_join_group", { p_group_id: "g", p_rules_version: 4, p_consent: true });
    expect(r).toEqual({ ok: true, handle: "Quiet Heron", avatarCode: "leaf" });
  });
  it("turns a refusal into a calm key, never database text", async () => {
    mockRpc.mockResolvedValue(ok({ status: "refused", reason: "group_full" }));
    expect(await joinGroup({ groupId: "g", rulesVersion: 1, rulesAcknowledged: true, consent: true })).toMatchObject({ ok: false, key: "community.join.refused.group_full" });
    mockRpc.mockResolvedValue({ data: null, error: { message: "relation community_x does not exist" }, status: 500 });
    expect(await joinGroup({ groupId: "g", rulesVersion: 1, rulesAcknowledged: true, consent: true })).toMatchObject({ ok: false, key: "community.compose.refused.other" });
  });
});

describe("submitPost", () => {
  const input = { groupId: "g", parentId: null, body: "  hello  ", clientRequestId: "rid" };
  it("trims the text and sends the request id", async () => {
    mockRpc.mockResolvedValue(ok({ status: "published", post_id: "p" }));
    const r = await submitPost(input);
    expect(mockRpc).toHaveBeenCalledWith("community_submit_post", { p_group_id: "g", p_parent_id: null, p_body: "hello", p_client_request_id: "rid" });
    expect(r).toEqual({ ok: true, outcome: { kind: "published", message: "community.compose.published" } });
  });
  it("does not call the database for an empty post", async () => {
    expect(await submitPost({ ...input, body: "   " })).toMatchObject({ ok: false, key: "community.compose.refused.empty" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("a network failure is not a definite answer, a database refusal is", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "TypeError: Network request failed" }, status: 0 });
    expect(await submitPost(input)).toMatchObject({ ok: false, definite: false });
    mockRpc.mockResolvedValue({ data: null, error: { message: "bad" }, status: 400 });
    expect(await submitPost(input)).toMatchObject({ ok: false, definite: true });
    mockRpc.mockResolvedValue(ok({ garbage: true }));
    expect(await submitPost(input)).toMatchObject({ ok: false, definite: false });
  });
  it("routes emergency language to the safety outcome", async () => {
    mockRpc.mockResolvedValue(ok({ status: "withheld", safety_kind: "emergency" }));
    expect(await submitPost(input)).toMatchObject({ ok: true, outcome: { kind: "safety", safety: "emergency" } });
  });
});

describe("searchGroups", () => {
  it("searches for 2 to 60 characters and asks for the plain list otherwise", async () => {
    mockRpc.mockResolvedValue(ok(list));
    await searchGroups("  sugar ");
    expect(mockRpc).toHaveBeenLastCalledWith("community_search_groups", { p_q: "sugar" });
    await searchGroups("a");
    expect(mockRpc).toHaveBeenLastCalledWith("community_list_groups");
    await searchGroups("");
    expect(mockRpc).toHaveBeenLastCalledWith("community_list_groups");
  });
  it("is null when the reply is unreadable", async () => {
    mockRpc.mockResolvedValue(ok({ open: "yes" }));
    expect(await searchGroups("sugar")).toBeNull();
  });
});

describe("feed paging", () => {
  it("passes the created_at of the last post as the cursor", async () => {
    mockRpc.mockResolvedValue(ok({ ok: true, posts: [], has_more: false }));
    await loadFeed("g", "2026-10-09T10:00:00Z");
    expect(mockRpc).toHaveBeenCalledWith("community_feed", { p_group_id: "g", p_before: "2026-10-09T10:00:00Z" });
    await loadFeed("g");
    expect(mockRpc).toHaveBeenLastCalledWith("community_feed", { p_group_id: "g" });
  });
  it("a refused or broken feed is a failure, not an empty feed", async () => {
    mockRpc.mockResolvedValue(ok({ ok: false, reason: "not_a_member" }));
    expect(await loadFeed("g")).toMatchObject({ ok: false, key: "community.feed.error" });
  });
});

describe("small actions", () => {
  it("reacts, reads the new count, and reports with the thank-you or already lines", async () => {
    mockRpc.mockResolvedValue(ok({ status: "ok", support_count: 5, i_supported: true }));
    expect(await reactToPost("p", true)).toEqual({ ok: true, supportCount: 5, supported: true });
    mockRpc.mockResolvedValue(ok({ status: "reported" }));
    expect(await reportPost("p", "privacy", " ")).toEqual({ ok: true, key: "community.report.thanks" });
    expect(mockRpc).toHaveBeenLastCalledWith("community_report_post", { p_post_id: "p", p_reason_code: "privacy" });
    mockRpc.mockResolvedValue(ok({ status: "already_reported" }));
    expect(await reportPost("p", "other", "more")).toEqual({ ok: true, key: "community.report.already" });
  });
  it("hides a person with a failure line when the database says no", async () => {
    mockRpc.mockResolvedValue(ok({ status: "refused", reason: "own_post" }));
    expect(await hideAuthor("p")).toMatchObject({ ok: false, key: "community.post.hide_failed" });
    mockRpc.mockResolvedValue(ok({ status: "hidden" }));
    expect(await hideAuthor("p")).toEqual({ ok: true });
  });
  it("deleting an own post needs the deleted status", async () => {
    mockRpc.mockResolvedValue(ok({ status: "refused", reason: "not_yours" }));
    expect(await deletePost("p")).toMatchObject({ ok: false, key: "community.compose.refused.not_yours" });
  });
});

describe("submitAppeal", () => {
  it("needs at least 10 characters before anything is sent", async () => {
    expect(await submitAppeal("removal", "t", "too short")).toMatchObject({ ok: false, key: "community.appeals.refused.reason_length" });
    expect(mockRpc).not.toHaveBeenCalled();
  });
  it("sends the member's own words and maps the refusals, including safety and contact details", async () => {
    mockRpc.mockResolvedValue(ok({ status: "ok" }));
    expect(await submitAppeal("sanction", "t", " I think this was a mistake ")).toEqual({ ok: true });
    expect(mockRpc).toHaveBeenLastCalledWith("community_appeal", { p_kind: "sanction", p_target_id: "t", p_reason: "I think this was a mistake" });
    mockRpc.mockResolvedValue(ok({ status: "refused", reason: "safety" }));
    expect(await submitAppeal("removal", "t", "long enough reason")).toMatchObject({ key: "community.appeals.refused.safety" });
    mockRpc.mockResolvedValue(ok({ status: "refused", reason: "contact_details" }));
    expect(await submitAppeal("removal", "t", "long enough reason")).toMatchObject({ key: "community.appeals.refused.contact_details" });
  });
});

describe("pictures", () => {
  it("reads the session token, and is null without one", async () => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: "tok" } } });
    expect(await getAccessToken()).toBe("tok");
    mockGetSession.mockResolvedValue({ data: { session: null } });
    expect(await getAccessToken()).toBeNull();
    mockGetSession.mockRejectedValue(new Error("x"));
    expect(await getAccessToken()).toBeNull();
  });
  it("posts multipart with the bearer token and reads the answer; a dropped connection is not a definite answer", async () => {
    const upload = buildPostUpload({
      groupId: "g",
      parentId: null,
      body: "hi",
      clientRequestId: "rid",
      image: { uri: "file:///p.jpg", width: 1, height: 1 },
      imagesAllowed: true,
    });
    const fetchMock = jest.fn().mockResolvedValue({ status: 200, json: async () => ({ status: "held", reason: "image" }) });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const reply = await uploadPostWithImage(upload, "tok");
    expect(reply).toEqual({ kind: "outcome", outcome: { kind: "held", message: "community.compose.held.image" } });
    const [url, init] = fetchMock.mock.calls[0] as [string, { method: string; headers: Record<string, string>; body: FormData }];
    expect(url.endsWith("/api/community/images")).toBe(true);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(init.headers["Content-Type"]).toBeUndefined();
    expect(init.body.get("client_request_id")).toBe("rid");

    globalThis.fetch = jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch;
    expect(await uploadPostWithImage(upload, "tok")).toEqual({ kind: "failed", definite: false });
  });
});

describe("alertEmergencyContactFromCard", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });
  it("does nothing without a session", async () => {
    global.fetch = jest.fn() as unknown as typeof fetch;
    expect(await alertEmergencyContactFromCard(null)).toBe("failed");
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it("posts once with the bearer token and sends no post text", async () => {
    const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, contact: "sent" }) }));
    global.fetch = fetchMock as unknown as typeof fetch;
    expect(await alertEmergencyContactFromCard("tok")).toBe("sent");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/mobile/community-emergency");
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });
  it("tells a missing contact apart from a failure", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, contact: "not_sent" }) })) as unknown as typeof fetch;
    expect(await alertEmergencyContactFromCard("tok")).toBe("not_sent");
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await alertEmergencyContactFromCard("tok")).toBe("failed");
    global.fetch = jest.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch;
    expect(await alertEmergencyContactFromCard("tok")).toBe("failed");
  });
});

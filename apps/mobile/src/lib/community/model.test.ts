import { en, type MessageKey } from "@tarragon/i18n";
import {
  APPEAL_REFUSED_KEYS,
  HELD_KEYS,
  JOIN_REFUSED_KEYS,
  REFUSED_KEYS,
  REPORT_REASONS,
  appealRefusalKey,
  composeOutcome,
  isSearchQuery,
  joinRefusalKey,
  memberCountKey,
  parseFeed,
  parseGroupList,
  parseGroupView,
  parseHiddenList,
  parseMyActions,
  parseOutcome,
  parseReplies,
  parseSubmitResult,
  refusalKey,
  replyCountKey,
  reportReasonKey,
  withinEditWindow,
} from "./model";

const group = {
  id: "g1",
  slug: "living-with-hypertension",
  name: "Living with hypertension",
  description: "Share what helps.",
  topic_code: "hypertension",
  topic_label: "Hypertension",
  status: "active",
  member_count: 12,
  my_status: "none",
};

const post = {
  id: "p1",
  author_handle: "Quiet Heron",
  author_avatar: "leaf",
  is_mine: false,
  body: "Hello",
  created_at: "2026-10-09T10:00:00Z",
  edited_at: null,
  support_count: 2,
  i_supported: false,
  pending_review: false,
};

const view = {
  found: true,
  group: {
    id: "g1",
    slug: "s",
    name: "N",
    description: "D",
    topic_code: "t",
    topic_label: null,
    status: "active",
    rules_text: "Be kind",
    rules_version: 3,
    join_mode: "open",
    images_allowed: true,
  },
  membership: { status: "active", handle: "Quiet Heron", avatar_code: "leaf", rules_current: true, notifications_muted: false, digest_opt_in: true },
  pinned: [{ id: "n1", title: "T", body: "B", reviewed_at: "2026-10-01T00:00:00Z", reviewed_by_name: "Dr Ada Obi" }],
  limits: { post_max_chars: 1500, edit_window_minutes: 15 },
};

describe("parseGroupList", () => {
  it("reads a good list, with the optional full flag", () => {
    const list = parseGroupList({ open: true, adult: true, groups: [group, { ...group, id: "g2", full: true }] });
    expect(list?.groups).toHaveLength(2);
    expect(list?.groups[1]?.full).toBe(true);
  });
  it("reads the closed and not-adult replies (empty groups)", () => {
    expect(parseGroupList({ open: false, adult: true, groups: [] })).toEqual({ open: false, adult: true, groups: [] });
    expect(parseGroupList({ open: true, adult: false, groups: [] })?.adult).toBe(false);
  });
  it.each([
    ["not an object", "nope"],
    ["null", null],
    ["missing open", { adult: true, groups: [] }],
    ["a group with a bad status", { open: true, adult: true, groups: [{ ...group, status: "archived" }] }],
    ["a group with a negative member count", { open: true, adult: true, groups: [{ ...group, member_count: -1 }] }],
    ["a group missing its slug", { open: true, adult: true, groups: [{ ...group, slug: undefined }] }],
    ["groups not an array", { open: true, adult: true, groups: {} }],
  ])("refuses %s", (_label, input) => {
    expect(parseGroupList(input)).toBeUndefined();
  });
});

describe("parseGroupView", () => {
  it("reads a found group and fills the optional lists", () => {
    const parsed = parseGroupView(view);
    expect(parsed?.found).toBe(true);
    if (parsed?.found) {
      expect(parsed.team).toEqual([]);
      expect(parsed.prompts).toEqual([]);
      expect(parsed.qa).toBeNull();
      expect(parsed.limits).toEqual({ post_max_chars: 1500, edit_window_minutes: 15 });
      expect(parsed.group.images_allowed).toBe(true);
      expect(parsed.pinned[0]?.reviewed_by_name).toBe("Dr Ada Obi");
    }
  });
  it("reads the doctor question session, the team and the prompts", () => {
    const parsed = parseGroupView({
      ...view,
      team: [{ display_name: "Ada, community moderator", scope: "moderator" }],
      prompts: [{ id: "q1", body: "Welcome" }],
      qa: {
        session_id: "s1",
        title: "Ask",
        intro: "Hi",
        opens_at: "2026-10-09T10:00:00Z",
        closes_at: "2026-10-09T12:00:00Z",
        status: "open",
        doctors: ["Dr Ada Obi"],
        my_questions: 1,
        question_limit: 3,
      },
    });
    expect(parsed?.found && parsed.qa?.question_limit).toBe(3);
    expect(parsed?.found && parsed.team[0]?.scope).toBe("moderator");
  });
  it("reads a not-found reply and a non-member", () => {
    expect(parseGroupView({ found: false, reason: "not_open_yet" })).toEqual({ found: false, reason: "not_open_yet" });
    const none = parseGroupView({ ...view, membership: { status: "none" } });
    expect(none?.found && none.membership.status).toBe("none");
  });
  it.each([
    ["a member row missing the handle", { ...view, membership: { status: "active", avatar_code: "x", rules_current: true, notifications_muted: false } }],
    ["limits that are zero", { ...view, limits: { post_max_chars: 0, edit_window_minutes: 15 } }],
    ["limits missing", { ...view, limits: undefined }],
    ["a bad join mode", { ...view, group: { ...view.group, join_mode: "secret" } }],
    ["found without a group", { found: true }],
    ["a team entry with a bad scope", { ...view, team: [{ display_name: "A", scope: "admin" }] }],
    ["a question session with a bad status", { ...view, qa: { session_id: "s", title: "t", intro: "i", opens_at: "a", closes_at: "b", status: "paused", doctors: [], my_questions: 0, question_limit: 1 } }],
    ["found false without a reason", { found: false }],
  ])("refuses %s", (_label, input) => {
    expect(parseGroupView(input)).toBeUndefined();
  });
});

describe("parseFeed and parseReplies", () => {
  it("reads posts with a picture and doctor answers", () => {
    const feed = parseFeed({
      ok: true,
      has_more: true,
      posts: [
        { ...post, image: { id: "i1", width: 800, height: 600 }, reply_count: 3 },
        { ...post, id: "p2", qa_session_id: "s1", answers: [{ id: "a1", doctor_name: "Dr Ada Obi", body: "Rest.", created_at: "2026-10-09T11:00:00Z" }] },
      ],
    });
    expect(feed?.ok && feed.posts[0]?.image?.id).toBe("i1");
    expect(feed?.ok && feed.posts[1]?.answers[0]?.doctor_name).toBe("Dr Ada Obi");
    expect(feed?.ok && feed.posts[0]?.answers).toEqual([]);
  });
  it("reads a refused feed", () => {
    expect(parseFeed({ ok: false, reason: "not_a_member" })).toEqual({ ok: false, reason: "not_a_member" });
  });
  it.each([
    ["a post with a number for its handle", { ok: true, has_more: false, posts: [{ ...post, author_handle: 5 }] }],
    ["a negative support count", { ok: true, has_more: false, posts: [{ ...post, support_count: -1 }] }],
    ["missing has_more", { ok: true, posts: [] }],
    ["a picture without a size", { ok: true, has_more: false, posts: [{ ...post, image: { id: "i" } }] }],
  ])("refuses %s", (_label, input) => {
    expect(parseFeed(input)).toBeUndefined();
  });
  it("reads replies and refuses a bad one", () => {
    expect(parseReplies({ ok: true, replies: [post] })?.ok).toBe(true);
    expect(parseReplies({ ok: true, replies: [{ ...post, id: 7 }] })).toBeUndefined();
    expect(parseReplies({ ok: false, reason: "no_such_post" })).toEqual({ ok: false, reason: "no_such_post" });
  });
  it("never carries a member identity field through", () => {
    const feed = parseFeed({ ok: true, has_more: false, posts: [{ ...post, author_profile_id: "secret", email: "a@b.c" }] });
    expect(feed?.ok && Object.keys(feed.posts[0] ?? {})).not.toContain("author_profile_id");
    expect(feed?.ok && Object.keys(feed.posts[0] ?? {})).not.toContain("email");
  });
});

describe("other replies", () => {
  it("reads an outcome, keeping the extra fields the screens use", () => {
    expect(parseOutcome({ status: "joined", handle: "Quiet Heron", avatar_code: "leaf" })?.handle).toBe("Quiet Heron");
    expect(parseOutcome({ status: "ok", support_count: 3, i_supported: true })?.support_count).toBe(3);
    expect(parseOutcome({ reason: "x" })).toBeUndefined();
  });
  it("reads a submit result and refuses an unknown status", () => {
    expect(parseSubmitResult({ status: "withheld", safety_kind: "self_harm", post_id: "p" })?.safety_kind).toBe("self_harm");
    expect(parseSubmitResult({ status: "queued" })).toBeUndefined();
    expect(parseSubmitResult({ status: "withheld", safety_kind: "other" })).toBeUndefined();
  });
  it("reads the hidden list", () => {
    expect(parseHiddenList({ ok: true, hidden: [{ id: "h1", handle: "Calm Ibis" }] })).toEqual({ ok: true, hidden: [{ id: "h1", handle: "Calm Ibis" }] });
    expect(parseHiddenList({ ok: true, hidden: [{ id: "h1" }] })).toBeUndefined();
  });
  it("reads my actions", () => {
    const actions = parseMyActions({
      open: true,
      removed_posts: [{ post_id: "p", group_name: "G", removed_at: null, reason_code: null, appeal_status: null, can_appeal: true }],
      sanctions: [{ sanction_id: "s", kind: "mute", group_name: null, starts_at: "2026-10-01T00:00:00Z", ends_at: null, reason_code: "spam", overturned: false, appeal_status: "open", can_appeal: false }],
    });
    expect(actions?.removed_posts[0]?.can_appeal).toBe(true);
    expect(actions?.sanctions[0]?.appeal_status).toBe("open");
    expect(parseMyActions({ open: true, removed_posts: [], sanctions: [{ kind: "shout" }] })).toBeUndefined();
  });
});

describe("composeOutcome", () => {
  it("maps every kind of answer", () => {
    expect(composeOutcome({ status: "published" })).toEqual({ kind: "published", message: "community.compose.published" });
    expect(composeOutcome({ status: "held", reason: "commerce" })).toEqual({ kind: "held", message: "community.compose.held.commerce" });
    expect(composeOutcome({ status: "held", reason: "image" })).toEqual({ kind: "held", message: "community.compose.held.image" });
    expect(composeOutcome({ status: "blocked", reason: "contact" })).toEqual({ kind: "blocked", message: "community.compose.blocked.contact" });
    expect(composeOutcome({ status: "blocked", reason: "anything" })).toEqual({ kind: "blocked", message: "community.compose.blocked.other" });
    expect(composeOutcome({ status: "refused", reason: "rate_limited" })).toEqual({ kind: "refused", message: "community.compose.refused.rate_limited" });
    expect(composeOutcome({ status: "refused", reason: "bad_image" })).toEqual({ kind: "refused", message: "community.compose.refused.bad_image" });
    expect(composeOutcome({ status: "refused", reason: "qa_limit" })).toEqual({ kind: "refused", message: "community.compose.refused.qa_limit" });
  });
  it("sends emergency and self-harm language to the safety card, never to a post", () => {
    expect(composeOutcome({ status: "withheld", safety_kind: "emergency" })).toEqual({ kind: "safety", safety: "emergency", message: "community.safety.emergency.title" });
    expect(composeOutcome({ status: "withheld", safety_kind: "self_harm" })).toEqual({ kind: "safety", safety: "self_harm", message: "community.safety.self_harm.title" });
    // A withheld post with no kind is treated as an emergency: the safer card.
    expect(composeOutcome({ status: "withheld" }).kind).toBe("safety");
  });
  it("falls back to a calm line for an unknown reason, never to raw text", () => {
    expect(composeOutcome({ status: "held", reason: "something_new" })).toEqual({ kind: "held", message: "community.compose.held" });
    expect(composeOutcome({ status: "refused", reason: "constructor" })).toEqual({ kind: "refused", message: "community.compose.refused.other" });
    expect(composeOutcome({ status: "refused" })).toEqual({ kind: "refused", message: "community.compose.refused.other" });
  });
});

describe("message keys", () => {
  const tables: Array<[string, Readonly<Record<string, MessageKey>>]> = [
    ["refused", REFUSED_KEYS],
    ["held", HELD_KEYS],
    ["join", JOIN_REFUSED_KEYS],
    ["appeal", APPEAL_REFUSED_KEYS],
  ];
  it.each(tables)("every %s key exists in the English catalogue", (_name, table) => {
    for (const key of Object.values(table)) expect(en[key]).toEqual(expect.any(String));
  });
  it("has a catalogue line for every report reason and the fixed keys", () => {
    for (const r of REPORT_REASONS) expect(en[reportReasonKey(r)]).toEqual(expect.any(String));
    for (const key of [replyCountKey(1), replyCountKey(2), memberCountKey(1), memberCountKey(5), "community.compose.refused.other", "community.compose.held", "community.appeals.refused.other"] as MessageKey[]) {
      expect(en[key]).toEqual(expect.any(String));
    }
  });
  it("maps refusals, join refusals and appeal refusals totally", () => {
    expect(refusalKey("edit_window_over")).toBe("community.compose.refused.edit_window_over");
    expect(refusalKey("nonsense")).toBe("community.compose.refused.other");
    expect(joinRefusalKey("group_full")).toBe("community.join.refused.group_full");
    expect(joinRefusalKey(undefined)).toBe("community.compose.refused.other");
    expect(appealRefusalKey("safety")).toBe("community.appeals.refused.safety");
    expect(appealRefusalKey("contact_details")).toBe("community.appeals.refused.contact_details");
    expect(appealRefusalKey("not_open_yet")).toBe("community.appeals.refused.not_appealable");
    expect(appealRefusalKey("zzz")).toBe("community.appeals.refused.other");
  });
});

describe("small rules", () => {
  it("search only counts 2 to 60 characters after trimming", () => {
    expect(isSearchQuery("a")).toBe(false);
    expect(isSearchQuery(" ab ")).toBe(true);
    expect(isSearchQuery("x".repeat(60))).toBe(true);
    expect(isSearchQuery("x".repeat(61))).toBe(false);
  });
  it("the edit window comes from the group, not from a constant", () => {
    const created = "2026-10-09T10:00:00Z";
    const at = (minutes: number) => Date.parse(created) + minutes * 60_000;
    expect(withinEditWindow(created, 15, at(14))).toBe(true);
    expect(withinEditWindow(created, 15, at(16))).toBe(false);
    expect(withinEditWindow(created, 60, at(16))).toBe(true);
    expect(withinEditWindow(created, 0, at(1))).toBe(false);
    expect(withinEditWindow("not a date", 15, at(1))).toBe(false);
  });
});

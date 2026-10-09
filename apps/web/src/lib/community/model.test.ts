import { describe, expect, it } from "@jest/globals";
import { en, type MessageKey } from "@tarragon/i18n";
import {
  composeOutcome,
  feedSchema,
  groupListSchema,
  groupViewSchema,
  holdReasonLabel,
  joinRefusalKey,
  memberCountKey,
  modQueueSchema,
  outcomeSchema,
  REPORT_REASONS,
  replyCountKey,
  reportReasonKey,
  safetyQueueSchema,
  staffRefusalText,
  submitResultSchema,
} from "./model";

const has = (k: MessageKey) => Object.hasOwn(en, k);

describe("community model: replies are parsed, never trusted", () => {
  it("accepts a feed and carries only a handle for authorship", () => {
    const parsed = feedSchema.parse({
      ok: true,
      has_more: false,
      posts: [{ id: "p1", author_handle: "calm-river-42", author_avatar: "leaf", is_mine: false, body: "Hello", created_at: "2026-10-09T10:00:00Z", edited_at: null, support_count: 2, reply_count: 1, i_supported: false, pending_review: false }],
    });
    expect(parsed.ok && parsed.posts[0]?.author_handle).toBe("calm-river-42");
  });

  it("drops fields it does not know about, so an identity field added by mistake can never reach a component", () => {
    const parsed = feedSchema.parse({
      ok: true,
      has_more: false,
      posts: [{ id: "p1", author_handle: "calm-river-42", author_avatar: null, is_mine: false, body: "x", created_at: "t", edited_at: null, support_count: 0, i_supported: false, pending_review: false, profile_id: "SECRET", full_name: "SECRET" }],
    });
    expect(JSON.stringify(parsed)).not.toContain("SECRET");
  });

  it("rejects a malformed reply instead of rendering it half-wrong", () => {
    expect(feedSchema.safeParse({ ok: true, posts: "nope" }).success).toBe(false);
    expect(groupListSchema.safeParse({ open: "yes" }).success).toBe(false);
    expect(modQueueSchema.safeParse({ items: [{ post_id: 1 }] }).success).toBe(false);
  });

  it("reads a closed community and a group view", () => {
    expect(groupListSchema.parse({ open: false, adult: true, groups: [] }).open).toBe(false);
    const v = groupViewSchema.parse({
      found: true,
      group: { id: "g", slug: "s", name: "N", description: "", topic_code: "diabetes", topic_label: "Diabetes", status: "active", rules_text: "Be kind", rules_version: 1, join_mode: "open" },
      membership: { status: "none" },
      pinned: [],
      limits: { post_max_chars: 2000, edit_window_minutes: 15 },
    });
    expect(v.found && v.limits.post_max_chars).toBe(2000);
  });

  it("the staff queues have no field for a member's identity", () => {
    const q = modQueueSchema.parse({
      items: [{ post_id: "p", group_id: "g", group_name: "G", author_handle: "kind-hill-10", is_reply: false, body: "b", state: "held", reasons: ["new_member"], created_at: "t", report_count: 0, report_reasons: [], author_is_new: true, profile_id: "SECRET" }],
    });
    expect(JSON.stringify(q)).not.toContain("SECRET");
    const s = safetyQueueSchema.parse({
      items: [{ signal_id: "s", kind: "emergency_language", status: "open", created_at: "t", group_name: "G", post_id: "p", post_state: "held", author_handle: "kind-hill-10", body: "b", full_name: "SECRET" }],
    });
    expect(JSON.stringify(s)).not.toContain("SECRET");
  });
});

describe("community model: what the screen does with an outcome", () => {
  it("every message key it can return exists in the English catalogue", () => {
    const results = [
      { status: "published" },
      { status: "held", reason: "new_member" },
      { status: "held", reason: "commerce" },
      { status: "held", reason: "cure_claim" },
      { status: "held", reason: "medicine_instruction" },
      { status: "held", reason: "contact_platform" },
      { status: "held", reason: "abuse" },
      { status: "held", reason: "spam" },
      { status: "held", reason: "something_new" },
      { status: "blocked", reason: "contact" },
      { status: "blocked", reason: "spam" },
      { status: "withheld", safety_kind: "emergency" },
      { status: "withheld", safety_kind: "self_harm" },
      ...["rate_limited", "cooling_down", "muted", "suspended", "banned", "empty", "too_long", "not_a_member", "accept_rules", "group_closed", "group_read_only", "reply_target_gone", "not_ready", "not_open_yet", "adults_only", "edit_window_over", "not_yours", "not_editable", "brand_new_reason"].map((reason) => ({ status: "refused", reason })),
    ];
    for (const r of results) {
      const out = composeOutcome(submitResultSchema.parse(r));
      expect([JSON.stringify(r), has(out.message)]).toEqual([JSON.stringify(r), true]);
    }
    for (const reason of ["consent_needed", "rules_changed", "by_invitation", "group_closed", "not_allowed", "not_open_yet", "adults_only", "unknown_thing", undefined]) {
      expect([reason, has(joinRefusalKey(reason))]).toEqual([reason, true]);
    }
    for (const r of REPORT_REASONS) expect(has(reportReasonKey(r))).toBe(true);
    for (const n of [0, 1, 2, 50]) {
      expect(has(replyCountKey(n))).toBe(true);
      expect(has(memberCountKey(n))).toBe(true);
    }
  });

  it("an emergency or self-harm post is a safety outcome, never a published or refused one", () => {
    expect(composeOutcome({ status: "withheld", safety_kind: "emergency" })).toMatchObject({ kind: "safety", safety: "emergency" });
    expect(composeOutcome({ status: "withheld", safety_kind: "self_harm" })).toMatchObject({ kind: "safety", safety: "self_harm" });
    // a withheld post with no kind still gets a safety card: the safer default is the emergency one
    expect(composeOutcome({ status: "withheld" })).toMatchObject({ kind: "safety", safety: "emergency" });
  });

  it("a blocked contact detail gets the contact message and nothing else", () => {
    expect(composeOutcome({ status: "blocked", reason: "contact" }).message).toBe("community.compose.blocked.contact");
  });

  it("a held post for an unknown reason still gets a calm line", () => {
    expect(composeOutcome({ status: "held", reason: "who_knows" }).message).toBe("community.compose.held");
  });

  it("never throws, whatever the database sends", () => {
    for (const reason of [undefined, "", "constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const out = composeOutcome(submitResultSchema.parse({ status: "refused", ...(reason === undefined ? {} : { reason }) }));
      expect(has(out.message)).toBe(true);
    }
    // a status the database might add later is rejected at the edge, not rendered
    expect(submitResultSchema.safeParse({ status: "something_new" }).success).toBe(false);
    expect(joinRefusalKey("constructor")).toBe("community.compose.refused.other");
    expect(staffRefusalText("toString")).toBe("That could not be done. Please try again.");
  });

  it("outcome parsing keeps extras and tolerates a bare status", () => {
    expect(outcomeSchema.parse({ status: "ok" }).status).toBe("ok");
    expect(outcomeSchema.parse({ status: "joined", handle: "calm-river-42" }).handle).toBe("calm-river-42");
  });
});

describe("community model: staff wording", () => {
  it("labels every hold reason the rule set can produce, and passes an unknown one through", () => {
    for (const c of ["new_member", "commerce", "cure_claim", "medicine_instruction", "contact_platform", "abuse", "spam", "reported"]) {
      expect(holdReasonLabel(c)).not.toBe(c);
    }
    expect(holdReasonLabel("brand_new")).toBe("brand_new");
  });
  it("every refusal the staff functions return has plain wording", () => {
    for (const r of ["reason_needed", "hours_needed", "bad_decision", "already_handled", "safety_reviewer_only", "no_such_post", "daily_limit", "reason_too_short", "not_reviewable", "bad_hostname"]) {
      expect(staffRefusalText(r)).not.toBe("That could not be done. Please try again.");
    }
  });
});

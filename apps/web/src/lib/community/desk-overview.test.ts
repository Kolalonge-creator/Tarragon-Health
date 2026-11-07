import {
  actionLabel, attentionHref, deskOverviewSchema, elapsed, formatMinutes, parsePeriod, sortAttention, trend, type AttentionItem,
} from "./desk-overview";
import type { StaffContext } from "./model";

const ctx: StaffContext = {
  is_admin: false, is_cmo: false, is_moderator: true, is_senior_moderator: false, is_safety_reviewer: false, is_clinician: false, has_desk: true,
};
const item = (p: Partial<AttentionItem>): AttentionItem => ({
  priority: "medium", category: "held", label: "x", status: "open", overdue: false, next_action: "y", ...p,
});

describe("desk overview helpers", () => {
  it("accepts only the offered periods", () => {
    expect(parsePeriod("30")).toBe(30);
    expect(parsePeriod("12")).toBe(7);
    expect(parsePeriod(undefined)).toBe(7);
    expect(parsePeriod("1")).toBe(1);
  });

  it("puts critical first, overdue before on-time, older before newer, untimed last", () => {
    const sorted = sortAttention([
      item({ label: "low", priority: "low" }),
      item({ label: "med-new", received_at: "2026-11-07T02:00:00Z" }),
      item({ label: "med-untimed" }),
      item({ label: "med-old", received_at: "2026-11-07T01:00:00Z" }),
      item({ label: "med-overdue", received_at: "2026-11-07T03:00:00Z", overdue: true }),
      item({ label: "crit", priority: "critical" }),
    ]);
    expect(sorted.map((i) => i.label)).toEqual(["crit", "med-overdue", "med-old", "med-new", "med-untimed", "low"]);
  });

  it("never links someone to a page they cannot open", () => {
    expect(attentionHref("queue?tab=moderation", ctx)).toBe("/community-desk/queue?tab=moderation");
    expect(attentionHref("queue?tab=safety", ctx)).toBeNull();
    expect(attentionHref("queue?tab=safety", { ...ctx, is_safety_reviewer: true })).toBe("/community-desk/queue?tab=safety");
    expect(attentionHref("queue?tab=moderation", { ...ctx, is_moderator: false, is_admin: true })).toBeNull();
    expect(attentionHref("rota", ctx)).toBeNull();
    expect(attentionHref("rota", { ...ctx, is_admin: true })).toBe("/admin/community/rota");
    expect(attentionHref("drills", { ...ctx, is_cmo: true })).toBe("/clinician/community/drill");
    expect(attentionHref("somewhere-else", { ...ctx, is_admin: true })).toBeNull();
    expect(attentionHref(null, ctx)).toBeNull();
  });

  it("shows a trend only when there is a real earlier figure", () => {
    expect(trend(5, null, "yesterday")).toBeNull();
    expect(trend(5, 3, "yesterday")).toEqual({ direction: "up", text: "+2 on yesterday" });
    expect(trend(1, 3, "yesterday")).toEqual({ direction: "down", text: "-2 on yesterday" });
    expect(trend(3, 3, "yesterday")?.direction).toBe("flat");
  });

  it("formats response times and says so when nothing was decided", () => {
    expect(formatMinutes(null)).toBe("No decisions yet");
    expect(formatMinutes(42)).toBe("42 min");
    expect(formatMinutes(185)).toBe("3 h 5 min");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(3 * 24 * 60)).toBe("3 days");
  });

  it("says how long ago in plain words", () => {
    const now = Date.parse("2026-11-07T12:00:00Z");
    expect(elapsed("2026-11-07T11:59:40Z", now)).toBe("just now");
    expect(elapsed("2026-11-07T11:15:00Z", now)).toBe("45 min ago");
    expect(elapsed("2026-11-07T02:00:00Z", now)).toBe("10 h ago");
    expect(elapsed("2026-11-04T12:00:00Z", now)).toBe("3 days ago");
    expect(elapsed(null, now)).toBe("");
  });

  it("labels known events and never drops an unknown one", () => {
    expect(actionLabel("approved")).toBe("Post approved");
    expect(actionLabel("appeal_upheld")).toBe("Appeal decided");
    expect(actionLabel("sanction_mute")).toBe("Sanction applied");
    expect(actionLabel("brand_new_thing")).toBe("Brand new thing");
  });

  it("parses a real overview reply, with an empty series read as none", () => {
    const parsed = deskOverviewSchema.safeParse({
      days: 7, generated_at: "2026-11-07T02:00:00Z", local_hour: 3, sees_safety: false,
      attention: [{ priority: "high", category: "coverage", label: "No safety reviewer", status: "uncovered", overdue: false, next_action: "Add cover", href: "rota", received_at: null }],
      kpis: { members_active: 0, members_new: 0, members_new_prev: 0, groups_active: 4, posts_today: 0, posts_yesterday: 0, awaiting_moderation: 0,
        open_reports: 0, open_safety: 0, response_minutes_median: null, response_decisions: 0, moderators_on_duty: 1, safety_on_duty: 0 },
      series: null, groups: [], staff: [], waiting: { queue: 0, queue_overdue: 0, appeals: 0, queue_overdue_minutes: 60 }, activity: [], last_drill: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.series).toEqual([]);
  });

  it("refuses a reply with a negative count rather than showing it", () => {
    expect(deskOverviewSchema.shape.kpis.safeParse({ members_active: -1 }).success).toBe(false);
  });
});

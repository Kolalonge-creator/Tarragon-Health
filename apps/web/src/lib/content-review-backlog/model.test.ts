import { describe, expect, it } from "@jest/globals";
import { backlogRowsSchema, groupBacklog } from "./model";

const row = (kind: string, code: string) => ({
  content_id: "7d1f6b0e-3a52-4c1a-9a53-0f5f2a9d1b11",
  code,
  title: code,
  content_status: "published",
  clinician_reviewed: false,
  next_review_due: null,
  days_overdue: null,
  needs_re_review: kind === "needs_re_review",
  needs_re_review_reason: null,
  safety_relevant: true,
  author_name: null,
  backlog_kind: kind,
});

describe("content review backlog model", () => {
  it("parses the database answer and groups by kind", () => {
    const parsed = backlogRowsSchema.parse([row("never_reviewed", "a"), row("needs_re_review", "b"), row("never_reviewed", "c")]);
    const g = groupBacklog(parsed);
    expect(g.never_reviewed.map((r) => r.code)).toEqual(["a", "c"]);
    expect(g.needs_re_review).toHaveLength(1);
    expect(g.review_overdue).toHaveLength(0);
  });

  it("rejects an unknown kind instead of guessing", () => {
    expect(backlogRowsSchema.safeParse([row("something_else", "x")]).success).toBe(false);
  });
});

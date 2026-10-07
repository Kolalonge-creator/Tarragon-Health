import { describe, expect, it } from "@jest/globals";
import {
  formatLagosDate,
  nextStep,
  offlineSyncPlan,
  offlineVisible,
  publicShareUrl,
  reviewCredit,
  reviewExpired,
  shareByEmailUrl,
  splitSources,
} from "./learning-item";

describe("reviewCredit is null-gated", () => {
  const base = { clinician_reviewed: true, reviewed_by_name: "Dr Ada Obi", reviewed_at: "2026-09-01T10:00:00Z", source_reference: "WHO 2023; NICE NG136" };
  it("returns the credit with sources when every part exists", () => {
    expect(reviewCredit(base)).toEqual({ reviewer: "Dr Ada Obi", reviewedAt: "2026-09-01T10:00:00Z", sources: ["WHO 2023", "NICE NG136"], nextReviewDue: null });
  });
  it("is null when the item is not marked reviewed", () => expect(reviewCredit({ ...base, clinician_reviewed: false })).toBeNull());
  it("is null without a reviewer name", () => expect(reviewCredit({ ...base, reviewed_by_name: "  " })).toBeNull());
  it("is null without a review date", () => expect(reviewCredit({ ...base, reviewed_at: null })).toBeNull());
});

describe("nextStep", () => {
  it("returns the standard footer for a booking", () => {
    expect(nextStep({ next_action: "Book a blood pressure check.", next_step_kind: "booking" })).toEqual({ kind: "booking", label: "Book a blood pressure check.", targetCode: null, targetTitle: null });
  });
  it("links the next lesson only when it is servable", () => {
    expect(nextStep({ next_action: "Read lesson two.", next_step_kind: "lesson", next_step_target_code: "bpc_02", next_step_target_title: "Measure it right" })?.targetCode).toBe("bpc_02");
    expect(nextStep({ next_action: "Read lesson two.", next_step_kind: "lesson", next_step_target_code: "bpc_02", next_step_target_title: null })?.targetCode).toBeNull();
  });
  it("is null for an older item with no next step, or an unknown kind", () => {
    expect(nextStep({})).toBeNull();
    expect(nextStep({ next_action: "Do a thing now.", next_step_kind: "other" })).toBeNull();
    expect(nextStep({ next_action: "", next_step_kind: "booking" })).toBeNull();
  });
});

describe("review expiry (offline, Lagos date)", () => {
  const now = new Date("2026-10-07T23:30:00Z"); // 00:30 on 8 Oct in Lagos
  it("a date in the past or today (Lagos) is expired", () => {
    expect(reviewExpired("2026-10-07", now)).toBe(true);
    expect(reviewExpired("2026-10-08", now)).toBe(true);
    expect(reviewExpired("2026-10-09", now)).toBe(false);
  });
  it("no date means not expired", () => expect(reviewExpired(null, now)).toBe(false));
  it("offlineVisible drops an expired cached item", () => {
    const kept = offlineVisible([{ code: "a", next_review_due: "2026-10-01" }, { code: "b", next_review_due: "2026-12-01" }, { code: "c", next_review_due: null }], now);
    expect(kept.map((k) => k.code)).toEqual(["b", "c"]);
  });
});

describe("offlineSyncPlan", () => {
  it("removes anything the server no longer returns", () => {
    const plan = offlineSyncPlan([{ code: "a" }, { code: "b" }, { code: "c" }], [{ code: "a" }, { code: "c" }]);
    expect(plan.keep.map((k) => k.code)).toEqual(["a", "c"]);
    expect(plan.drop.map((k) => k.code)).toEqual(["b"]);
  });
  it("removes everything when the server returns nothing (all expired)", () => {
    expect(offlineSyncPlan([{ code: "a" }], []).drop).toHaveLength(1);
  });
});

describe("sharing", () => {
  it("builds a link with only the content code", () => {
    expect(publicShareUrl("https://tarragonhealth.ng/", "bp basics")).toBe("https://tarragonhealth.ng/health-library/bp%20basics");
  });
  it("builds an email link", () => {
    const url = shareByEmailUrl("Blood pressure basics", "https://x.test/health-library/bp");
    expect(url.startsWith("mailto:?subject=Blood%20pressure%20basics&body=")).toBe(true);
    expect(decodeURIComponent(url)).toContain("https://x.test/health-library/bp");
  });
  it("splits sources on lines and semicolons and formats a Lagos date", () => {
    expect(splitSources("a\n b ;c;; ")).toEqual(["a", "b", "c"]);
    expect(formatLagosDate("2026-10-07T23:30:00Z")).toBe("8 Oct 2026");
  });
});

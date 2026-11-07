import { describe, expect, it } from "@jest/globals";
import {
  attentionFromComplaints,
  attentionFromIncidents,
  attentionFromSafeguarding,
  attentionFromSignoffs,
  attentionFromWorklist,
  countByTier,
  leadershipPeriodBounds,
  parseLeadershipPeriod,
  periodTrend,
  previousPeriodComparable,
  rankExecutiveAttention,
  ratioText,
  timeOutstanding,
  type ExecutiveAttentionItem,
} from "./cmo-leadership";
import type { DoctorWorklistRow } from "./doctor-worklist";

const NOW = new Date("2026-11-07T12:00:00Z"); // 13:00 in Lagos

function row(over: Partial<DoctorWorklistRow> & Pick<DoctorWorklistRow, "key">): DoctorWorklistRow {
  return {
    source: "escalation",
    patientId: "p",
    patientName: "A Patient",
    patientNumber: "TH-000001",
    issue: "High blood pressure",
    priority: "routine",
    receivedAt: "2026-11-07T08:00:00Z",
    dueAt: null,
    assignedName: "Dr Ada",
    assignedToMe: false,
    unassigned: false,
    status: "New",
    nextAction: "Start the review",
    href: "/clinician/escalations/1",
    ...over,
  };
}

describe("reporting period", () => {
  it("defaults to the last 30 days and ignores unknown values", () => {
    expect(parseLeadershipPeriod(undefined)).toBe("30d");
    expect(parseLeadershipPeriod("forever")).toBe("30d");
    expect(parseLeadershipPeriod(["7d", "90d"])).toBe("7d");
  });

  it("starts today at Lagos midnight and compares with yesterday's same stretch", () => {
    const b = leadershipPeriodBounds("today", NOW);
    expect(b.start.toISOString()).toBe("2026-11-06T23:00:00.000Z");
    expect(b.previousStart.toISOString()).toBe("2026-11-05T23:00:00.000Z");
    expect(b.previousEnd.toISOString()).toBe("2026-11-06T12:00:00.000Z");
  });

  it("uses a rolling window for 7, 30 and 90 days", () => {
    const b = leadershipPeriodBounds("7d", NOW);
    expect(b.start.toISOString()).toBe("2026-10-31T12:00:00.000Z");
    expect(b.previousStart.toISOString()).toBe("2026-10-24T12:00:00.000Z");
  });

  it("compares year to date with the same stretch of last year", () => {
    const b = leadershipPeriodBounds("ytd", NOW);
    expect(b.start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(b.previousStart.toISOString()).toBe("2024-12-31T23:00:00.000Z");
    expect(b.previousEnd.getTime() - b.previousStart.getTime()).toBe(b.end.getTime() - b.start.getTime());
  });
});

describe("figures", () => {
  it("always shows the numerator and denominator with a percentage", () => {
    expect(ratioText(168, 200).text).toBe("84%, 168 of 200");
    expect(ratioText(0, 0).text).toBe("none to measure yet");
    expect(ratioText(null, 200).text).toBe("could not be loaded");
    expect(ratioText(5, null).pct).toBeNull();
  });

  it("gives no trend when the previous period is not covered by data or a figure is unknown", () => {
    expect(periodTrend(10, 4, false)).toBeNull();
    expect(periodTrend(null, 4, true)).toBeNull();
    expect(periodTrend(10, 4, true)).toEqual({ direction: "up", text: "6 up on the previous period (4)" });
    expect(periodTrend(3, 4, true)?.direction).toBe("down");
    expect(periodTrend(4, 4, true)?.direction).toBe("flat");
  });

  it("treats the previous period as comparable only when data began on or before it", () => {
    const b = leadershipPeriodBounds("30d", NOW);
    expect(previousPeriodComparable(b, null)).toBe(false);
    expect(previousPeriodComparable(b, "2026-10-20T00:00:00Z")).toBe(false);
    expect(previousPeriodComparable(b, "2026-08-01T00:00:00Z")).toBe(true);
  });

  it("describes time outstanding in plain units", () => {
    expect(timeOutstanding("2026-11-07T11:15:00Z", NOW)).toBe("45 minutes");
    expect(timeOutstanding("2026-11-07T06:00:00Z", NOW)).toBe("6 hours");
    expect(timeOutstanding("2026-11-03T12:00:00Z", NOW)).toBe("4 days");
    expect(timeOutstanding(null, NOW)).toBeNull();
  });
});

describe("requires executive attention", () => {
  it("raises critical, overdue and unassigned team work only, never a routine on-time case", () => {
    const items = attentionFromWorklist(
      [
        row({ key: "a", priority: "critical" }),
        row({ key: "b", dueAt: "2026-11-07T10:00:00Z" }),
        row({ key: "c", unassigned: true, assignedName: null }),
        row({ key: "d" }),
        row({ key: "q", source: "queue", priority: "critical" }),
      ],
      NOW
    );
    expect(items.map((i) => [i.key, i.tier])).toEqual([
      ["a", "critical"],
      ["b", "high"],
      ["c", "attention"],
    ]);
    expect(items[2]?.owner).toBeNull();
    expect(items[2]?.nextAction).toBe("Assign a doctor");
  });

  it("shows the patient number, never the patient name", () => {
    const [item] = attentionFromWorklist([row({ key: "a", priority: "critical" })], NOW);
    expect(item?.title).toContain("TH-000001");
    expect(item?.title).not.toContain("A Patient");
  });

  it("tiers incidents by reported severity and skips closed ones", () => {
    const items = attentionFromIncidents([
      { id: "1", category: "medication_error", severity: "critical", status: "open", reported_at: "2026-11-01T00:00:00Z", reviewer_name: null },
      { id: "2", category: "other", severity: "medium", status: "under_review", reported_at: "2026-11-01T00:00:00Z", reviewer_name: "Dr B" },
      { id: "3", category: "other", severity: "near_miss", status: "action_planned", reported_at: "2026-11-01T00:00:00Z", reviewer_name: "Dr B" },
      { id: "4", category: "other", severity: "critical", status: "closed", reported_at: "2026-11-01T00:00:00Z", reviewer_name: "Dr B" },
    ]);
    expect(items.map((i) => i.tier)).toEqual(["critical", "attention", "routine"]);
    expect(items[0]?.title).toBe("Critical severity: Medication error");
  });

  it("makes every open safeguarding concern at least high priority and never shows its description", () => {
    const items = attentionFromSafeguarding([
      { id: "1", concern_category: "immediate_safety_risk", status: "open", reported_at: "2026-11-06T00:00:00Z", reviewer_name: null },
      { id: "2", concern_category: "neglect", status: "under_review", reported_at: "2026-11-06T00:00:00Z", reviewer_name: "Dr C" },
      { id: "3", concern_category: "abuse", status: "closed", reported_at: "2026-11-06T00:00:00Z", reviewer_name: "Dr C" },
    ]);
    expect(items.map((i) => i.tier)).toEqual(["critical", "high"]);
    expect(Object.keys(items[0] ?? {})).not.toContain("description");
  });

  it("never puts a complaint above requires attention", () => {
    const items = attentionFromComplaints(
      [
        { id: "1", category: "billing", status: "received", created_at: "2026-10-01T00:00:00Z", assignee_name: null },
        { id: "2", category: "billing", status: "resolved", created_at: "2026-11-06T00:00:00Z", assignee_name: "Ops" },
        { id: "3", category: "billing", status: "investigating", created_at: "2026-11-06T00:00:00Z", assignee_name: "Ops" },
        { id: "4", category: "billing", status: "governance_review", created_at: "2026-10-01T00:00:00Z", assignee_name: "Ops" },
      ],
      NOW
    );
    expect(items.map((i) => [i.key, i.tier])).toEqual([
      ["complaint:1", "attention"],
      ["complaint:2", "attention"],
      ["complaint:3", "routine"],
    ]);
    expect(items[1]?.nextAction).toBe("Complete the governance review");
  });

  it("adds one sign-off line only when something is waiting", () => {
    expect(attentionFromSignoffs(0)).toEqual([]);
    expect(attentionFromSignoffs(3)[0]?.title).toBe("3 items waiting for your signature");
  });

  it("ranks by tier, then longest outstanding first", () => {
    const base: Omit<ExecutiveAttentionItem, "key" | "tier" | "raisedAt"> = {
      kind: "k",
      title: "t",
      owner: null,
      status: "s",
      nextAction: "n",
      href: "/",
    };
    const ranked = rankExecutiveAttention([
      { ...base, key: "routine", tier: "routine", raisedAt: "2026-01-01T00:00:00Z" },
      { ...base, key: "high-new", tier: "high", raisedAt: "2026-11-07T00:00:00Z" },
      { ...base, key: "high-old", tier: "high", raisedAt: "2026-11-01T00:00:00Z" },
      { ...base, key: "critical", tier: "critical", raisedAt: null },
    ]);
    expect(ranked.map((i) => i.key)).toEqual(["critical", "high-old", "high-new", "routine"]);
    expect(countByTier(ranked)).toEqual({ critical: 1, high: 2, attention: 0, routine: 1 });
  });
});

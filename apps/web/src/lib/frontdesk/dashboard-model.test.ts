import { describe, expect, it } from "@jest/globals";
import { buildTiles, fmtPct, fmtSeconds, fmtUsd, num, topicLabel, type Dashboard } from "./dashboard-model";

const base = (o: Partial<Dashboard> = {}): Dashboard => ({
  current: {
    conversations: { total: 12, ai_resolved_pct: 66.7, median_first_response_seconds: 4.2 },
    handoffs: { total: 3, urgent: 1, open_now: 1 },
    leads: { total: 6 }, funnel: { events: { account_created: 3, paid: 1 } },
    review: { pending: 4, ok: 5, wrong: 1, unsafe: 0, incidents_open: 0 },
    spend: { cost_usd: 1.5, daily_cap_usd: 5 },
  },
  previous: { conversations: { total: 9, ai_resolved_pct: 55 }, leads: { total: 2 } },
  spend_today_usd: 0.4, reports: [], incidents: [], review_sample_percent: 10, ...o,
});
const tile = (d: Dashboard, label: string) => buildTiles(d).find((t) => t.label.startsWith(label))!;

describe("formatters never turn unknown into zero", () => {
  it("shows a missing share as 'Not yet', not 0%", () => { expect(fmtPct(null)).toBe("Not yet"); expect(fmtPct(undefined)).toBe("Not yet"); expect(fmtPct(0)).toBe("0%"); });
  it("shows a missing speed as 'None yet'", () => { expect(fmtSeconds(null)).toBe("None yet"); expect(fmtSeconds(3)).toBe("3 s"); });
  it("reads numbers from strings and refuses junk", () => { expect(num("2.5")).toBe(2.5); expect(num("abc")).toBeNull(); expect(num("")).toBeNull(); expect(fmtUsd("x")).toBe("$0.00"); });
  it("labels topics", () => { expect(topicLabel("how_it_works")).toBe("How it works"); expect(topicLabel("")).toBe("Other"); });
});

describe("buildTiles", () => {
  it("compares with the week before", () => {
    expect(tile(base(), "Conversations").sub).toBe("last week 9");
    expect(tile(base(), "Finished").sub).toBe("last week 55%");
  });
  it("says nothing to compare when there was no week before", () => {
    expect(tile(base({ previous: {} }), "Conversations").sub).toBeNull();
  });
  it("marks a fast first reply green and a slow one amber, and an unknown one grey", () => {
    expect(tile(base(), "Median").tone).toBe("green");
    const slow = base(); (slow.current.conversations as { median_first_response_seconds: number }).median_first_response_seconds = 90;
    expect(tile(slow, "Median").tone).toBe("amber");
    expect(tile(base({ current: {} }), "Median")).toMatchObject({ value: "None yet", tone: "grey" });
  });
  it("flags work waiting for the founder", () => {
    expect(tile(base(), "Handoffs").tone).toBe("amber");
    expect(tile(base(), "Conversations to review").tone).toBe("amber");
    const clear = base(); (clear.current.handoffs as { open_now: number }).open_now = 0; (clear.current.review as { pending: number }).pending = 0;
    expect(tile(clear, "Handoffs").tone).toBe("green");
    expect(tile(clear, "Conversations to review").tone).toBe("green");
  });
  it("makes an open safety incident red and tells the founder what closes it", () => {
    const d = base(); (d.current.review as { incidents_open: number }).incidents_open = 2;
    expect(tile(d, "Open safety")).toMatchObject({ value: "2", tone: "red" });
    expect(tile(d, "Open safety").sub).toMatch(/rule you tightened/);
    expect(tile(base(), "Open safety").tone).toBe("green");
  });
  it("turns spend red once today's spend reaches the daily cap", () => {
    expect(tile(base(), "Assistant spend").tone).toBe("grey");
    expect(tile(base({ spend_today_usd: 5 }), "Assistant spend").tone).toBe("red");
  });
  it("renders an empty dashboard without NaN", () => {
    const empty = buildTiles({ current: {}, previous: {}, spend_today_usd: null, reports: [], incidents: [], review_sample_percent: null });
    expect(empty.map((t) => t.value + (t.sub ?? "")).join(" ")).not.toMatch(/NaN|undefined/);
  });
});

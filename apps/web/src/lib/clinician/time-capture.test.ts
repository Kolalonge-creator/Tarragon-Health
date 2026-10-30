import { en } from "@tarragon/i18n";
import {
  AUTO_FLUSH_SECONDS,
  IDLE_SECONDS,
  MAX_ENTRY_SECONDS,
  MIN_FLUSH_SECONDS,
  VisibleTimer,
  manualMinutesToSeconds,
  manualNeedsConfirm,
  timeEntryInputSchema,
} from "./time-capture";
import { parseMemberMonthMinutes, sourceLabelKey, tierLabelKey } from "./time-report";

const T0 = 1_000_000;
const s = (n: number) => n * 1000;

describe("VisibleTimer", () => {
  it("counts active time and pauses while the tab is hidden", () => {
    const t = new VisibleTimer(T0, true);
    t.setVisible(false, T0 + s(60));
    t.setVisible(true, T0 + s(3660)); // an hour hidden adds nothing
    expect(t.seconds(T0 + s(3690))).toBe(90);
  });

  it("counts nothing for a page that starts hidden until it is shown", () => {
    const t = new VisibleTimer(T0, false);
    expect(t.seconds(T0 + s(600))).toBe(0);
    t.setVisible(true, T0 + s(600));
    expect(t.seconds(T0 + s(630))).toBe(30);
  });

  it("pauses after two minutes with no input and counts only up to the idle limit", () => {
    const t = new VisibleTimer(T0, true);
    t.input(T0 + s(30));
    // 10 minutes later with no input: 30 s before the input plus IDLE_SECONDS after it, nothing more
    expect(t.seconds(T0 + s(600))).toBe(30 + IDLE_SECONDS);
  });

  it("resumes on the next input, without counting the idle stretch", () => {
    const t = new VisibleTimer(T0, true);
    t.input(T0 + s(10)); // active 10 s
    t.input(T0 + s(1000)); // idle in between: only the 120 s allowance after the last input counts
    expect(t.seconds(T0 + s(1000))).toBe(10 + IDLE_SECONDS);
    expect(t.seconds(T0 + s(1030))).toBe(10 + IDLE_SECONDS + 30);
  });

  it("ignores input while the surface is not active", () => {
    const t = new VisibleTimer(T0, false);
    t.input(T0 + s(5));
    expect(t.seconds(T0 + s(60))).toBe(0);
  });

  it("keeps a short glance instead of sending it, then adds the next one", () => {
    const t = new VisibleTimer(T0, true);
    expect(t.take(T0 + s(MIN_FLUSH_SECONDS - 1))).toBe(0);
    expect(t.take(T0 + s(10))).toBe(10);
  });

  it("starts again from zero after a take", () => {
    const t = new VisibleTimer(T0, true);
    expect(t.take(T0 + s(20))).toBe(20);
    expect(t.seconds(T0 + s(25))).toBe(5);
  });

  it("never sends more than the database accepts in one entry", () => {
    const t = new VisibleTimer(T0, true);
    // keep the page in use so idle does not cap it
    for (let i = 1; i <= (MAX_ENTRY_SECONDS + 100) / 60; i++) t.input(T0 + s(i * 60));
    const end = T0 + s(MAX_ENTRY_SECONDS + 100);
    t.input(end);
    expect(t.take(end)).toBe(MAX_ENTRY_SECONDS);
    expect(AUTO_FLUSH_SECONDS).toBeLessThan(MAX_ENTRY_SECONDS);
  });
});

describe("manual time", () => {
  it("turns minutes into seconds, up to 120, and refuses nonsense", () => {
    expect(manualMinutesToSeconds("12")).toBe(720);
    expect(manualMinutesToSeconds("120")).toBe(7200);
    for (const bad of ["", "0", "-3", "abc", "121", "240"]) expect(manualMinutesToSeconds(bad)).toBeNull();
  });

  it("asks to confirm above 60 minutes", () => {
    expect(manualNeedsConfirm("60")).toBe(false);
    expect(manualNeedsConfirm("61")).toBe(true);
    expect(manualNeedsConfirm("abc")).toBe(false);
  });

  it("validates the server input, needs a client key, and does not allow the consult source from a client", () => {
    const base = { sourceRef: null, patientId: "11111111-1111-4111-8111-111111111111", seconds: 60, clientKey: "22222222-2222-4222-8222-222222222222" };
    expect(timeEntryInputSchema.safeParse({ ...base, source: "manual" }).success).toBe(true);
    expect(timeEntryInputSchema.safeParse({ ...base, source: "consult" }).success).toBe(false);
    expect(timeEntryInputSchema.safeParse({ ...base, source: "manual", seconds: 0 }).success).toBe(false);
    expect(timeEntryInputSchema.safeParse({ ...base, source: "manual", clientKey: "nope" }).success).toBe(false);
  });
});

describe("care team time report", () => {
  const total = { kind: "total", tier: "plus", source: null, members: 4, mean_minutes: 7.5, median_minutes: 7.5, p90_minutes: 13.5, total_minutes: 30 };
  const source = { kind: "source", tier: "plus", source: "task", members: null, mean_minutes: null, median_minutes: null, p90_minutes: null, total_minutes: 5 };

  it("splits totals from per-source rows and has no place for a clinician", () => {
    const report = parseMemberMonthMinutes([source, total]);
    expect(report?.totals).toHaveLength(1);
    expect(report?.sources).toHaveLength(1);
    expect(Object.keys(report!.totals[0]!)).not.toContain("clinician_profile_id");
    expect(parseMemberMonthMinutes([{ ...total, clinician_profile_id: "x" }])!.totals[0]).not.toHaveProperty("clinician_profile_id");
  });

  it("orders by membership and kind of work, not by any figure", () => {
    const report = parseMemberMonthMinutes([
      { ...source, source: "manual", total_minutes: 999 },
      { ...source, source: "consult", total_minutes: 1 },
    ]);
    expect(report!.sources.map((r) => r.source)).toEqual(["consult", "manual"]);
  });

  it("keeps a small group's figures null", () => {
    const report = parseMemberMonthMinutes([{ ...total, members: 1, mean_minutes: null, median_minutes: null, p90_minutes: null, total_minutes: null }]);
    expect(report!.totals[0]!.median_minutes).toBeNull();
  });

  it("reports an unreadable answer as null so the page shows a load error", () => {
    expect(parseMemberMonthMinutes({ nope: true })).toBeNull();
  });

  it("labels come from i18n keys that exist", () => {
    for (const k of ["task", "consult", "message", "manual"] as const) expect(en[sourceLabelKey(k)]).toBeTruthy();
    expect(en[tierLabelKey("plus")!]).toBe("Membership Plus");
    expect(tierLabelKey("something_else")).toBeNull();
  });
});

describe("copy", () => {
  it("states planning only, with no dash and no ranking words", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("time."));
    expect(keys.length).toBeGreaterThan(10);
    for (const k of keys) {
      const text = en[k as keyof typeof en];
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/rank|leaderboard|productivity|score/i);
    }
    expect(en["time.page_intro"]).toContain("never a target for any doctor");
    expect(en["time.task_footer"]).toBe("Your time on this case is recorded for planning only.");
  });
});

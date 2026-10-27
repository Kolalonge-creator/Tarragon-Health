import { en } from "@tarragon/i18n";
import { MAX_ENTRY_SECONDS, MIN_FLUSH_SECONDS, VisibleTimer, manualMinutesToSeconds, timeEntryInputSchema } from "./time-capture";
import { parseMemberMonthMinutes } from "./time-report";

const T0 = 1_000_000;

describe("VisibleTimer", () => {
  it("counts visible time and pauses while the tab is hidden", () => {
    const t = new VisibleTimer(T0, true);
    t.setVisible(false, T0 + 60_000);
    // an hour hidden adds nothing
    t.setVisible(true, T0 + 3_660_000);
    expect(t.seconds(T0 + 3_690_000)).toBe(90);
  });

  it("counts nothing for a page that starts hidden until it is shown", () => {
    const t = new VisibleTimer(T0, false);
    expect(t.seconds(T0 + 600_000)).toBe(0);
    t.setVisible(true, T0 + 600_000);
    expect(t.seconds(T0 + 630_000)).toBe(30);
  });

  it("keeps a short glance instead of sending it, then adds the next one", () => {
    const t = new VisibleTimer(T0, true);
    expect(t.take(T0 + (MIN_FLUSH_SECONDS - 1) * 1000)).toBe(0);
    expect(t.take(T0 + 10_000)).toBe(10);
  });

  it("starts again from zero after a take", () => {
    const t = new VisibleTimer(T0, true);
    expect(t.take(T0 + 20_000)).toBe(20);
    expect(t.seconds(T0 + 25_000)).toBe(5);
  });

  it("never sends more than the database accepts in one entry", () => {
    const t = new VisibleTimer(T0, true);
    const sent = t.take(T0 + (MAX_ENTRY_SECONDS + 100) * 1000);
    expect(sent).toBe(MAX_ENTRY_SECONDS);
    expect(t.seconds(T0 + (MAX_ENTRY_SECONDS + 100) * 1000)).toBe(100);
  });
});

describe("manual time", () => {
  it("turns minutes into seconds and refuses nonsense", () => {
    expect(manualMinutesToSeconds("12")).toBe(720);
    expect(manualMinutesToSeconds("1.5")).toBe(90);
    for (const bad of ["", "0", "-3", "abc", "241"]) expect(manualMinutesToSeconds(bad)).toBeNull();
  });

  it("validates the server input and does not allow the consult source from a client", () => {
    const base = { sourceRef: null, patientId: "11111111-1111-4111-8111-111111111111", seconds: 60 };
    expect(timeEntryInputSchema.safeParse({ ...base, source: "manual" }).success).toBe(true);
    expect(timeEntryInputSchema.safeParse({ ...base, source: "consult" }).success).toBe(false);
    expect(timeEntryInputSchema.safeParse({ ...base, source: "manual", seconds: 0 }).success).toBe(false);
  });
});

describe("care team time report", () => {
  const row = { source: "task", tier: "plus", members: 4, median_minutes: 6, p90_minutes: 11, total_minutes: 30 };

  it("accepts the aggregate shape and has no place for a clinician", () => {
    const rows = parseMemberMonthMinutes([row]);
    expect(rows).toHaveLength(1);
    expect(Object.keys(rows![0]!)).not.toContain("clinician_profile_id");
    expect(parseMemberMonthMinutes([{ ...row, clinician_profile_id: "x" }])![0]).not.toHaveProperty("clinician_profile_id");
  });

  it("orders by kind of work, not by any figure", () => {
    const rows = parseMemberMonthMinutes([
      { ...row, source: "manual", total_minutes: 999 },
      { ...row, source: "consult", total_minutes: 1 },
    ]);
    expect(rows!.map((r) => r.source)).toEqual(["consult", "manual"]);
  });

  it("reports an unreadable answer as null so the page shows a load error", () => {
    expect(parseMemberMonthMinutes({ nope: true })).toBeNull();
  });
});

describe("copy", () => {
  it("states planning only, with no dash and no ranking words", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("time."));
    expect(keys.length).toBeGreaterThan(5);
    for (const k of keys) {
      const text = en[k as keyof typeof en];
      expect(text).not.toMatch(/[–—]/);
      expect(text).not.toMatch(/rank|leaderboard|productivity|score/i);
    }
    expect(en["time.page_intro"]).toContain("never a target for any doctor");
    expect(en["time.task_footer"]).toBe("Your time on this case is recorded for planning only.");
  });
});

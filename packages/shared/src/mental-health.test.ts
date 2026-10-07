import { describe, expect, it } from "@jest/globals";
import {
  CRISIS_CARD_OFFLINE, changeOverTime, cleanWellbeingTags, isHelplineShowable, isValidSharedPhonePin, lagosDay, mergeMoodBpSleep,
  normaliseCrisisCard, pickHandoffScreen, SHARED_PHONE_NEUTRAL_TEXT, WELLBEING_TAGS,
} from "./mental-health";

const NOW = new Date("2026-10-07T12:00:00Z");

describe("check-in tags", () => {
  it("keeps only known tags, once each, at most six", () => {
    expect(cleanWellbeingTags(["work", "work", "nonsense", " money "])).toEqual(["work", "money"]);
    expect(cleanWellbeingTags(WELLBEING_TAGS)).toHaveLength(6);
    expect(cleanWellbeingTags("work,family")).toEqual(["work", "family"]);
    expect(cleanWellbeingTags(null)).toEqual([]);
  });
  it("matches the database CHECK list exactly", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");
    const dir = join(process.cwd(), "..", "..", "supabase", "migrations");
    const file = readdirSync(dir).find((f) => f.includes("s56_checkin_tags"));
    expect(file).toBeDefined();
    const sql = readFileSync(join(dir, file as string), "utf8");
    const m = /tags <@ array\[([^\]]+)\]/.exec(sql);
    const inDb = (m?.[1] ?? "").split(",").map((s) => s.trim().replace(/'/g, "")).sort();
    expect(inDb).toEqual([...WELLBEING_TAGS].sort());
  });
});

describe("mood beside blood pressure and sleep", () => {
  it("merges per Lagos day, oldest first, with means and no invented values", () => {
    const rows = mergeMoodBpSleep(
      [
        { checked_in_at: "2026-10-05T08:00:00Z", mood_score: 2, stress_score: 4, tags: ["work"] },
        { checked_in_at: "2026-10-05T19:00:00Z", mood_score: 3, stress_score: 4, tags: ["sleep"] },
      ],
      [{ taken_at: "2026-10-05T07:00:00Z", systolic: 150, diastolic: 95 }, { taken_at: "2026-10-06T07:00:00Z", systolic: null, diastolic: null }],
      [{ day: "2026-10-06", minutes: 410 }],
    );
    expect(rows.map((r) => r.day)).toEqual(["2026-10-05", "2026-10-06"]);
    expect(rows[0]).toMatchObject({ mood: 2.5, stress: 4, tags: ["sleep", "work"], systolic: 150, diastolic: 95, sleepMinutes: null });
    expect(rows[1]).toMatchObject({ mood: null, systolic: null, sleepMinutes: 410 });
  });
  it("uses the Lagos calendar day, not UTC", () => {
    expect(lagosDay("2026-10-05T23:30:00Z")).toBe("2026-10-06");
  });
});

describe("change over time", () => {
  const screens = [
    { instrument: "phq9", total_score: 14, severity_band: "moderate", created_at: "2026-09-01T00:00:00Z" },
    { instrument: "phq9", total_score: 9, severity_band: "mild", created_at: "2026-10-01T00:00:00Z" },
    { instrument: "gad7", total_score: 4, severity_band: "minimal", created_at: "2026-10-01T00:00:00Z" },
  ];
  it("reports the raw difference only and never a clinical verdict", () => {
    const c = changeOverTime(screens, "phq9");
    expect(c).toMatchObject({ first: 14, latest: 9, previous: 14, sinceFirst: -5, sincePrevious: -5, direction: "lower" });
    expect(JSON.stringify(c)).not.toMatch(/reliable|significant|improved|worse|recover/i);
  });
  it("is empty-safe", () => {
    expect(changeOverTime(screens, "epds")).toMatchObject({ points: [], latest: null, direction: null, sinceFirst: null });
    expect(changeOverTime(screens, "gad7")).toMatchObject({ sinceFirst: null, sincePrevious: null });
  });
});

describe("crisis card", () => {
  const verified = { name: "Line A", phone_e164: "+2348000000000", hours_text: null, languages: ["en"], last_verified_at: "2026-09-01T00:00:00Z" };
  it("bundled fallback is 112 with no helpline and no promised callback time", () => {
    expect(CRISIS_CARD_OFFLINE.emergencyNumber).toBe("112");
    expect(CRISIS_CARD_OFFLINE.helplines).toEqual([]);
    expect(CRISIS_CARD_OFFLINE.callbackSlaMinutes).toBeNull();
  });
  it("shows a helpline only with a number and a recent verification", () => {
    expect(isHelplineShowable(verified, NOW)).toBe(true);
    expect(isHelplineShowable({ ...verified, last_verified_at: null }, NOW)).toBe(false);
    expect(isHelplineShowable({ ...verified, phone_e164: null }, NOW)).toBe(false);
    expect(isHelplineShowable({ ...verified, last_verified_at: "2025-01-01T00:00:00Z" }, NOW)).toBe(false);
    expect(isHelplineShowable({ ...verified, last_verified_at: "not a date" }, NOW)).toBe(false);
  });
  it("drops an unverified helpline even if the server sent one", () => {
    const card = normaliseCrisisCard({ emergency_number: "112", helplines: [verified, { ...verified, name: "Line B", last_verified_at: null }], callback_sla_minutes: null }, NOW);
    expect(card.helplines.map((h) => h.name)).toEqual(["Line A"]);
  });
  it("falls back to the bundled card on junk, never throws", () => {
    for (const junk of [null, undefined, 5, "x", [], { helplines: "no", emergency_number: "<script>" }]) {
      const c = normaliseCrisisCard(junk, NOW);
      expect(c.emergencyNumber).toBe("112");
      expect(c.helplines).toEqual([]);
      expect(c.callbackSlaMinutes).toBeNull();
    }
  });
  it("passes a confirmed callback figure through only as a positive integer", () => {
    expect(normaliseCrisisCard({ callback_sla_minutes: 30 }, NOW).callbackSlaMinutes).toBe(30);
    expect(normaliseCrisisCard({ callback_sla_minutes: -1 }, NOW).callbackSlaMinutes).toBeNull();
    expect(normaliseCrisisCard({ callback_sla_minutes: 1.5 }, NOW).callbackSlaMinutes).toBeNull();
  });
});

describe("shared-phone mode", () => {
  it("neutral text names no wellbeing term and no em dash", () => {
    const text = `${SHARED_PHONE_NEUTRAL_TEXT.title} ${SHARED_PHONE_NEUTRAL_TEXT.body}`;
    expect(text).not.toMatch(/mood|mental|depress|anxi|stress|crisis|self|therapy|check-in|screen|—/i);
  });
  it("accepts 4 to 8 digit PINs only", () => {
    expect(isValidSharedPhonePin("1234")).toBe(true);
    expect(isValidSharedPhonePin("12345678")).toBe(true);
    expect(isValidSharedPhonePin("123")).toBe(false);
    expect(isValidSharedPhonePin("123456789")).toBe(false);
    expect(isValidSharedPhonePin("12a4")).toBe(false);
  });
});

describe("hand-off screen choice", () => {
  const rows = [
    { id: "a", instrument: "phq9", crisis_flagged: false, created_at: "2026-10-01T00:00:00Z" },
    { id: "b", instrument: "gad7", crisis_flagged: false, created_at: "2026-10-03T00:00:00Z" },
    { id: "c", instrument: "auditc", crisis_flagged: false, created_at: "2026-10-05T00:00:00Z" },
    { id: "d", instrument: "phq9", crisis_flagged: true, created_at: "2026-09-01T00:00:00Z" },
  ];
  it("prefers a crisis-flagged screen, then the newest mood or anxiety screen, never alcohol", () => {
    expect(pickHandoffScreen(rows)?.id).toBe("d");
    expect(pickHandoffScreen(rows.filter((r) => r.id !== "d"))?.id).toBe("b");
    expect(pickHandoffScreen(rows.filter((r) => r.instrument === "auditc"))).toBeNull();
    expect(pickHandoffScreen([])).toBeNull();
  });
});

/**
 * S06y: how old is the copy kept on the phone. Pure logic plus the wording scan (calm, English, no fear words).
 */
import { en, t } from "@tarragon/i18n";
import { CLOCK_SKEW_TOLERANCE_MS, assessFreshness, freshnessCopy, loadFreshnessConfig, type FreshnessConfig } from "./freshness";

const NOW = Date.parse("2026-10-20T12:00:00Z");
const CFG: FreshnessConfig = { version: 1, staleAfterMs: 24 * 3_600_000 };
const ago = (ms: number): string => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 3_600_000;
const text = (iso: string | null | undefined, cfg = CFG) => freshnessCopy(assessFreshness(iso, NOW, cfg), (k, p) => t(k, "en", p));

describe("loadFreshnessConfig", () => {
  it("reads the PROPOSED threshold from the versioned registry (24 hours today)", () => {
    expect(loadFreshnessConfig()).toEqual({ version: 1, staleAfterMs: 24 * HOUR });
  });
});

describe("assessFreshness", () => {
  it("says just now under a minute", () => {
    expect(assessFreshness(ago(20_000), NOW, CFG)).toMatchObject({ level: "recent", label: { key: "freshness.just_now" }, notice: null });
  });

  it.each([
    [1 * MIN, "freshness.minute_one", 1],
    [2 * MIN, "freshness.minute_other", 2],
    [59 * MIN, "freshness.minute_other", 59],
    [60 * MIN, "freshness.hour_one", 1],
    [5 * HOUR, "freshness.hour_other", 5],
    [23 * HOUR + 59 * MIN, "freshness.hour_other", 23],
  ])("below the threshold it only says when (%d ms)", (age, key, count) => {
    const f = assessFreshness(ago(age), NOW, CFG);
    expect(f.level).toBe("recent");
    expect(f.label).toEqual({ key, params: { count } });
    expect(f.notice).toBeNull();
  });

  it("at exactly the threshold the calm out-of-date note is added", () => {
    const f = assessFreshness(ago(24 * HOUR), NOW, CFG);
    expect(f.level).toBe("stale");
    expect(f.label).toEqual({ key: "freshness.day_one", params: { count: 1 } });
    expect(f.notice).toEqual({ key: "freshness.may_be_old" });
  });

  it("counts days, singular and plural", () => {
    expect(assessFreshness(ago(2 * 24 * HOUR), NOW, CFG).label).toEqual({ key: "freshness.day_other", params: { count: 2 } });
    expect(assessFreshness(ago(40 * 24 * HOUR), NOW, CFG).label).toEqual({ key: "freshness.day_other", params: { count: 40 } });
  });

  it("follows the configured threshold, not a literal", () => {
    const strict: FreshnessConfig = { version: 2, staleAfterMs: 2 * HOUR };
    expect(assessFreshness(ago(3 * HOUR), NOW, strict).level).toBe("stale");
    expect(assessFreshness(ago(3 * HOUR), NOW, CFG).level).toBe("recent");
  });

  it.each([null, undefined, "", "not a date"])("an unknown time (%p) is worded cautiously", (value) => {
    const f = assessFreshness(value, NOW, CFG);
    expect(f).toMatchObject({ level: "unknown", ageMs: null, label: { key: "freshness.unknown" }, notice: { key: "freshness.unknown_notice" } });
  });

  it("a small clock difference is just now; a time well in the future cannot be trusted", () => {
    expect(assessFreshness(new Date(NOW + 2 * MIN).toISOString(), NOW, CFG)).toMatchObject({ level: "recent", ageMs: 0, label: { key: "freshness.just_now" } });
    expect(assessFreshness(new Date(NOW + CLOCK_SKEW_TOLERANCE_MS + MIN).toISOString(), NOW, CFG).level).toBe("unknown");
  });

  it("a non-finite now is unknown, never a crash", () => {
    expect(assessFreshness(ago(MIN), Number.NaN, CFG).level).toBe("unknown");
  });
});

describe("freshnessCopy", () => {
  it("builds the label, the note and a screen reader label that says it is a saved copy", () => {
    expect(text(ago(5 * HOUR))).toEqual({
      label: "Last updated 5 hours ago.",
      notice: null,
      labelA11y: "Saved copy on this phone. Last updated 5 hours ago.",
    });
    expect(text(ago(3 * 24 * HOUR)).notice).toBe("This may be out of date. Connect to the internet to refresh it.");
    expect(text(null)).toMatchObject({ label: "We cannot tell when this copy was last updated.", notice: "Connect to the internet to refresh it." });
  });
});

describe("wording", () => {
  const keys = Object.keys(en).filter((k) => k.startsWith("freshness.")) as (keyof typeof en)[];
  const FEAR = /(urgent|warning|danger|emergency|immediately|act now|risk|unsafe|\balert\b|\bdoctor\b|!)/i;

  it("has the keys the logic can return", () => {
    expect(keys.length).toBe(11);
  });

  it.each(keys)("%s is calm English: no fear words, no em or en dash, no 'doctor'", (key) => {
    const value = en[key];
    expect(value).not.toMatch(/[–—]/);
    expect(value).not.toMatch(FEAR);
    expect(value.length).toBeLessThan(80);
  });
});

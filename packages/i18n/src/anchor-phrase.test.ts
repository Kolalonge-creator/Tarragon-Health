import { describe, expect, it } from "@jest/globals";
import { anchorPhrase, anchorTitle, isKnownAnchor } from "./anchor-phrase";
import { en } from "./en";

const IDS = ["waking", "morning_prayer", "breakfast", "midday_prayer", "lunch", "afternoon_prayer", "evening_prayer", "dinner", "night_prayer", "bedtime"];

/**
 * INV-07: a reminder never names a medicine, a condition, a reading or a result. The anchor words end up inside a reminder, so
 * they get the same scan the other reminder strings get, along with the dash and fear-wording rules.
 */
const FORBIDDEN: RegExp[] = [
  /\bmedic\w*/i, /\bdrugs?\b/i, /\bpills?\b/i, /\btablets?\b/i, /\bcapsules?\b/i, /\bmg\b/i, /\bdoses?\b/i, /\bprescri\w*/i,
  /\binsulin\b/i, /\bglucose\b/i, /\bsugar\b/i, /\bblood\b/i, /\bpressure\b/i, /\bdiabet\w*/i, /\bhypertens\w*/i, /\bhiv\b/i,
  /\breadings?\b/i, /\bresults?\b/i, /\bconditions?\b/i, /\bamlodipine\b/i, /\bmetformin\b/i,
];

describe("anchor phrases", () => {
  it("says an anchor with no offset in plain words", () => {
    expect(anchorPhrase("breakfast", 0)).toBe("with breakfast");
    expect(anchorPhrase("waking", 0)).toBe("on waking");
    expect(anchorPhrase("morning_prayer", 0)).toBe("at the morning prayer");
    expect(anchorPhrase("bedtime", 0)).toBe("at bedtime");
  });

  it("says an offset before and after", () => {
    expect(anchorPhrase("breakfast", 30)).toBe("30 minutes after breakfast");
    expect(anchorPhrase("morning_prayer", 15)).toBe("15 minutes after the morning prayer");
    expect(anchorPhrase("dinner", -30)).toBe("30 minutes before dinner");
  });

  it("treats a missing or odd offset as no offset, and an unknown anchor as nothing", () => {
    expect(anchorPhrase("lunch", Number.NaN)).toBe("with lunch");
    expect(anchorPhrase("lunch", 1.5)).toBe("with lunch");
    expect(anchorPhrase("brunch", 0)).toBe("");
    expect(anchorTitle("brunch")).toBe("");
    expect(isKnownAnchor("brunch")).toBe(false);
    expect(isKnownAnchor("lunch")).toBe(true);
  });

  it.each(IDS)("%s has a title, a name and an at-phrase", (id) => {
    expect(anchorTitle(id)).not.toBe("");
    expect(anchorPhrase(id, 0)).not.toBe("");
    expect(anchorPhrase(id, 30)).toContain("30 minutes after");
    expect(anchorPhrase(id, -30)).toContain("30 minutes before");
  });

  it("every doseanchor string is free of clinical words, dashes and fear wording", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("doseanchor.")) as (keyof typeof en)[];
    expect(keys.length).toBeGreaterThan(60);
    for (const key of keys) {
      const text = en[key];
      expect({ key, hits: FORBIDDEN.filter((re) => re.test(text.replace(/\bnot advice about when to take anything\b/i, ""))).map((r) => r.source) }).toEqual({ key, hits: [] });
      expect(text).not.toMatch(/—|–/);
      expect(text).not.toMatch(/warning|danger|urgent/i);
    }
  });
});

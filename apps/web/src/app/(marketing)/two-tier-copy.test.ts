import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * S47e: the founder's two-tier model (2026-10-08). Free is technology only. Membership is 120,000 naira a year with ONE annual blood test and a doctor who follows up
 * about once a month. Imaging is not part of either. Copy that promised imaging inside a tier, or that still sold the old Core / Advanced / Comprehensive screens,
 * was wrong; this scans the sources so it cannot come back. The database half (no bundle contains an imaging test) is packages/db/tests/s47_two_tier_model.sql.
 */
const root = join(__dirname, "..", "..", "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");

const IMAGING = /(ultrasound|mammogra|sonograph|breast imaging|breast scan|prostate scan)/i;

describe("two-tier copy", () => {
  const page = read("apps", "web", "src", "app", "(marketing)", "annual-health-check", "page.tsx");
  const measure = read("apps", "web", "src", "app", "(marketing)", "_components", "what-we-measure.tsx");
  const i18n = read("packages", "i18n", "src", "en.ts");

  it("the level cards are Free and Membership, with the 120,000 naira price, and promise no imaging", () => {
    const start = page.indexOf('eyebrow="Two levels"');
    const end = page.indexOf("Coming soon", start);
    expect(start).toBeGreaterThan(-1);
    const block = page.slice(start, end);
    expect(block).toContain("120,000 naira a year");
    expect(block).not.toMatch(/Comprehensive Screen|Advanced Screen|Core Screen/);
    // "imaging" may appear only to say it is NOT included
    for (const m of block.matchAll(/[^.]*imaging[^.]*\./gi)) expect(m[0]).toMatch(/not included/i);
    expect(block).not.toMatch(IMAGING);
  });

  it("the test list has no imaging entry and no Screen package names", () => {
    expect(measure).not.toMatch(IMAGING);
    expect(measure).not.toMatch(/(Core|Advanced|Comprehensive) Screen/);
  });

  it("the Membership catalogue copy does not promise imaging and says the doctor follow-up is about monthly", () => {
    const lines = i18n.split("\n").filter((l) => l.includes('"catalog.membership_annual.'));
    expect(lines.length).toBeGreaterThanOrEqual(4);
    for (const l of lines) expect(l).not.toMatch(IMAGING);
    expect(lines.join("\n")).toContain("about once a month");
    expect(lines.join("\n")).not.toContain("12 in the year");
  });
});

import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression for the 2026-10-26 finding: the homepage said "The app is free.
 * You pay for a doctor, not a subscription" and "No monthly fee" while
 * /pricing sold a ₦120,000 annual Membership. The homepage must state the same
 * two-plan model as /pricing, take the price from versioned config, and never
 * carry the retired pay-per-piece wording.
 */
/** Comments may legitimately quote the retired wording (to explain it); only shipped copy is checked. */
const stripComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
const read = (rel: string) => stripComments(readFileSync(join(__dirname, rel), "utf8"));

const HOME_FILES = [
  "page.tsx",
  "_components/home-plan-compare.tsx",
  "_components/home-entry-chips.tsx",
  "_components/home-business-door.tsx",
  "_content/channel-heroes.ts",
];

describe("homepage pricing copy", () => {
  it.each(HOME_FILES)("%s carries no retired pay-per-piece wording", (file) => {
    const src = read(file);
    expect(src).not.toMatch(/not a subscription/i);
    expect(src).not.toMatch(/no monthly fee/i);
    expect(src).not.toMatch(/paid, per piece of work/i);
    expect(src).not.toMatch(/you only pay for a doctor/i);
  });

  it("reads the Membership price and refund window from config instead of typing them", () => {
    const page = read("page.tsx");
    expect(page).toContain('getProposedConfig("commerce.membership_prices")');
    expect(page).toContain('getProposedConfig("membership.refund")');
    // A typed naira amount in any marketing file is also caught repo-wide by
    // src/lib/marketing/no-public-prices.test.ts; checked here for the home files too.
    for (const file of HOME_FILES) {
      expect(read(file)).not.toMatch(/₦\s?\d/);
    }
  });

  it("says Membership does not renew by itself, matching /pricing", () => {
    expect(read("_components/home-plan-compare.tsx")).toMatch(/does not renew by itself/i);
    expect(read("pricing/page.tsx")).toMatch(/does not renew by itself/i);
  });
});

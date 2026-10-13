/**
 * The platform has two plans, Free and Membership (decision 2026-10-13). The marketing site and everything else public must quote ONE
 * naira price: the Membership price, read from versioned config. This scans the source of every marketing route and the marketing
 * library and fails on any other naira amount, on a naira template outside the files that read the Membership price from config, and
 * on any import of the per-service price machinery that used to exist.
 *
 * It scans source, not rendered HTML (the pages are server components with data loaders). A figure typed into a page is the only way
 * a stray price gets onto the site, and this catches that. Comments and test files are ignored.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(__dirname, "..", "..");
const ROOTS = [join(SRC, "app", "(marketing)"), join(SRC, "lib", "marketing")];

/** Files allowed to format a naira figure with a template (`₦${...}`), and why. */
const NAIRA_TEMPLATE_ALLOWED: Record<string, string> = {
  "app/(marketing)/pricing/page.tsx": "the Membership price, from commerce.membership_prices",
  "app/(marketing)/gift/page.tsx": "the Membership price, from commerce.membership_prices",
  "app/(marketing)/_components/roi-calculator.tsx":
    "an employer sketch whose every figure is a visitor-editable assumption and a modelled saving; it quotes no Tarragon price",
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

const files = ROOTS.flatMap(walk).map((p) => ({ rel: relative(SRC, p).split("\\").join("/"), text: stripComments(readFileSync(p, "utf8")) }));

describe("no public price other than the Membership price", () => {
  it("scans a real set of marketing files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("types no naira amount into any marketing route or marketing library file", () => {
    const amount = /₦\s?\d|\bNGN\s?\d|\bN\d{3,}|\b\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)\b|\b\d+\s*(?:k|K)\s*naira\b|\b\d{4,}\s*naira\b/;
    const hits = files.filter((f) => amount.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("formats a naira template only where the Membership price is read from config", () => {
    const hits = files
      .filter((f) => f.text.includes("₦${") && !(f.rel in NAIRA_TEMPLATE_ALLOWED))
      .map((f) => f.rel);
    expect(hits).toEqual([]);
    for (const rel of Object.keys(NAIRA_TEMPLATE_ALLOWED)) {
      const f = files.find((x) => x.rel === rel);
      expect(f).toBeDefined();
      if (rel.endsWith("pricing/page.tsx") || rel.endsWith("gift/page.tsx")) {
        expect(f!.text).toContain("commerce.membership_prices");
      }
    }
  });

  it("does not use the old per-service price machinery or the public price list", () => {
    const banned = /\b(PAID_SERVICES|PaidService|servicePrice|ResolvedServicePrices|fetchPlanPrices|fetchServicePriceOverrides|getPricingFaq|paidServicesJsonLd|public_price_list)\b|guest-checkout|\/checkout\//;
    const hits = files.filter((f) => banned.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("the pricing page reads the refund window from config rather than typing it", () => {
    const page = files.find((f) => f.rel === "app/(marketing)/pricing/page.tsx");
    expect(page).toBeDefined();
    expect(page!.text).toContain('getProposedConfig("membership.refund")');
    expect(page!.text).not.toMatch(/within 21 days/);
  });

  it("sabotage: the scan really catches a typed price", () => {
    const amount = /₦\s?\d|\bNGN\s?\d|\bN\d{3,}|\b\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)\b|\b\d+\s*(?:k|K)\s*naira\b|\b\d{4,}\s*naira\b/;
    expect(amount.test(stripComments("const price = '₦5,000';"))).toBe(true);
    expect(amount.test(stripComments("const x = '5,000 naira';"))).toBe(true);
    expect(amount.test(stripComments("// ₦5,000 in a comment is ignored\nconst x = 1;"))).toBe(false);
  });
});

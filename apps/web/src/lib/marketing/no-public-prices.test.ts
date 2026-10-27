/**
 * Public price rule (replaces the TT-11 "one price" premise, which the 2026-10-21 three-tier decision superseded; see docs/DECISIONS.md).
 * The marketing site and everything else public may quote EXACTLY TWO member prices, Membership and Membership Plus, plus the upgrade
 * difference between them, every one read from versioned config (commerce.membership_ladder, or commerce.membership_prices while the
 * ladder is off). It may quote no volume or seat-tier wording and no other naira figure. This holds with the ladder OFF and ON.
 *
 * It scans source, not rendered HTML (the pages are server components with data loaders). A figure typed into a page is the only way
 * a stray price gets onto the site, and this catches that. Comments and test files are ignored.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { getProposedConfig } from "@tarragon/shared";

const SRC = join(__dirname, "..", "..");
const ROOTS = [join(SRC, "app", "(marketing)"), join(SRC, "lib", "marketing")];

/** Files allowed to format a naira figure with a template (`₦${...}`), and why. */
const NAIRA_TEMPLATE_ALLOWED: Record<string, string> = {
  "app/(marketing)/pricing/page.tsx": "the Membership price, from commerce.membership_prices",
  "app/(marketing)/gift/page.tsx": "the Membership price, from commerce.membership_prices",
  "app/(marketing)/page.tsx": "the Membership price on the homepage, from commerce.membership_prices (same source as /pricing)",
  "app/(marketing)/_components/roi-calculator.tsx":
    "an employer sketch whose every figure is a visitor-editable assumption and a modelled saving; it quotes no Tarragon price",
};

/** Public offers that are banned (the Membership is one yearly payment; no family or volume pricing). */
const OFFER = /\b(?:pay(?:ing)?\s+(?:it\s+|them\s+)?(?:in|by)\s+instal?ments?|in\s+instal?ments|by\s+instal?ments|instal?ment\s+plans?|monthly\s+payments?|family\s+plans?\s+from|bulk\s+discounts?|volume\s+discounts?)\b/gi;
const NEGATION = /\b(?:no|not|never|without|nor|neither|cannot|can't|don't)\b[^.]{0,30}$/i;

/** Every banned offer in a text, ignoring one that is explicitly negated just before it ("there are no instalments"). */
function findOffers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(OFFER)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + 1);
    if (NEGATION.test(before)) continue;
    out.push(m[0]);
  }
  return out;
}

/**
 * Files allowed to mention paying a Care Voucher in parts. Care Voucher layaway (payTowardVoucher, voucher-checkout p_instalment_kobo) is
 * still a live feature, separate from the Membership, which has had no instalments since 2026-10-21. Open founder decision: keep voucher
 * layaway or retire it (docs/OPEN-QUESTIONS.md, OQ-GAP-VOUCHER-LAYAWAY).
 */
const VOUCHER_LAYAWAY_ALLOWED = ["app/(marketing)/_content/products.ts"];

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

describe("public prices: exactly two member prices plus the upgrade difference, nothing else", () => {
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
      if (rel.endsWith("pricing/page.tsx") || rel.endsWith("gift/page.tsx") || rel === "app/(marketing)/page.tsx") {
        // The price comes from the one shared reader, which itself reads versioned config.
        expect(f!.text).toContain("@/lib/marketing/membership");
      }
    }
  });

  it("reads prices only from the two member-price config keys, however the key is written", () => {
    const allowed = new Set(["commerce.membership_ladder", "commerce.membership_prices"]);
    const used = new Set<string>();
    // Any quoted commerce.* key anywhere in the marketing roots: a direct call, a constant, a wrapper's argument.
    for (const f of files) for (const m of f.text.matchAll(/["'`](commerce\.[A-Za-z0-9_.]+)["'`]/g)) used.add(m[1]);
    expect([...used].filter((k) => !allowed.has(k))).toEqual([]);
    expect(used.size).toBeGreaterThan(0);
  });

  it("every getProposedConfig call in the marketing roots names its key as a literal (no computed key can hide a price)", () => {
    const hits: string[] = [];
    for (const f of files) for (const m of f.text.matchAll(/getProposedConfig(?:<[^>]*>)?\(\s*([^)\s,]?)/g)) if (m[1] !== '"') hits.push(f.rel);
    expect(hits).toEqual([]);
  });

  it("the ladder config holds exactly two member prices and one upgrade difference that equals their gap", () => {
    const v = getProposedConfig("commerce.membership_ladder").value as Record<string, unknown>;
    const priceKeys = Object.keys(v).filter((k) => k.endsWith("_kobo")).sort();
    expect(priceKeys).toEqual(["evergreen_kobo", "evergreen_plus_kobo", "upgrade_kobo"]);
    expect(v.upgrade_kobo).toBe((v.evergreen_plus_kobo as number) - (v.evergreen_kobo as number));
  });

  describe("offers that are banned, and the negations that are allowed", () => {
    it("catches each banned offer", () => {
      for (const t of [
        "Pay in instalments if you like",
        "You can pay it in instalments",
        "Choose monthly payments",
        "A family plan from ₦5",
        "Ask about a bulk discount",
        "Enjoy a volume discount",
      ]) expect(findOffers(t)).not.toEqual([]);
    });

    it("allows an explicit negation", () => {
      for (const t of [
        "There are no instalments.",
        "We do not offer monthly payments.",
        "There are no family plans from us.",
        "No bulk discount, no volume discount.",
        "Never pay in instalments here.",
      ]) expect(findOffers(t)).toEqual([]);
    });

    it("finds none in the public source, apart from the Care Voucher layaway sentence that is still a live feature", () => {
      const hits = files
        .flatMap((f) => findOffers(f.text).map((o) => `${f.rel}: ${o}`))
        .filter((h) => !VOUCHER_LAYAWAY_ALLOWED.some((a) => h.startsWith(a)));
      expect(hits).toEqual([]);
    });

    it("the Care Voucher layaway allowance is only valid while layaway really exists", () => {
      const checkout = readFileSync(join(SRC, "lib", "billing", "voucher-checkout.ts"), "utf8");
      expect(checkout).toContain("p_instalment_kobo");
      const products = files.find((f) => f.rel === "app/(marketing)/_content/products.ts")!;
      // The sentence is about vouchers only, never about the Membership.
      expect(products.text).toMatch(/or a doctor's time whenever suits you, in one go or in instalments/);
    });
  });

  it("does not use the old per-service price machinery or the public price list", () => {
    const banned = /\b(PAID_SERVICES|PaidService|servicePrice|ResolvedServicePrices|fetchPlanPrices|fetchServicePriceOverrides|getPricingFaq|paidServicesJsonLd|public_price_list)\b|guest-checkout|\/checkout\//;
    const hits = files.filter((f) => banned.test(f.text)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("the shared membership module reads the price and refund window from config rather than typing them", () => {
    const mod = files.find((f) => f.rel === "lib/marketing/membership.ts");
    expect(mod).toBeDefined();
    expect(mod!.text).toContain('getProposedConfig("commerce.membership_prices")');
    expect(mod!.text).toContain('getProposedConfig("membership.refund")');
    const page = files.find((f) => f.rel === "app/(marketing)/pricing/page.tsx");
    expect(page).toBeDefined();
    expect(page!.text).toContain("refundWindowDays");
    expect(page!.text).not.toMatch(/within 21 days/);
  });

  it("sabotage: the scan really catches a typed price", () => {
    const amount = /₦\s?\d|\bNGN\s?\d|\bN\d{3,}|\b\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)\b|\b\d+\s*(?:k|K)\s*naira\b|\b\d{4,}\s*naira\b/;
    expect(amount.test(stripComments("const price = '₦5,000';"))).toBe(true);
    expect(amount.test(stripComments("const x = '5,000 naira';"))).toBe(true);
    expect(amount.test(stripComments("// ₦5,000 in a comment is ignored\nconst x = 1;"))).toBe(false);
  });
});

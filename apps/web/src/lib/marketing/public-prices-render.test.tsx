/**
 * @jest-environment node
 */
import { formatNaira } from "@tarragon/commerce";
import { getProposedConfig as realGet } from "@tarragon/shared";
import { renderPageText } from "./render-server-page";

/**
 * W-47, updated for Tarragon Health 2.0 (T2-01, T2-05, 2026-11-04): render /pricing and the homepage with
 * marketing.membership_ladder_public OFF and ON, pull out every naira figure a visitor can read, and assert only the allowed ones appear:
 * the Membership price and the employer seat price, both from commerce.membership_prices, whichever way the flag is set. No other naira
 * figure, no volume words.
 */
let ladderPublic = false;
jest.mock("@tarragon/shared", () => {
  const actual = jest.requireActual("@tarragon/shared");
  return {
    ...actual,
    getProposedConfig: (key: string, ...rest: unknown[]) =>
      key === "marketing.membership_ladder_public"
        ? { ...actual.getProposedConfig(key, ...rest), value: { enabled: ladderPublic } }
        : actual.getProposedConfig(key, ...rest),
  };
});
// The founding member offer (2026-11-04) is closed unless a test opens it; when open its one first-year price is the only extra figure.
let foundingOpen = false;
jest.mock("./founding-offer", () => {
  const actual = jest.requireActual("./founding-offer");
  return { ...actual, loadFoundingOffer: async () => (foundingOpen ? { placesTotal: 100, placesLeft: 42, code: "FOUNDING10", percent: 10 } : null) };
});
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/", useRouter: () => ({ push: jest.fn() }) }));

/** Every naira figure in a text, as digits only: "₦129,000", "NGN 5,000", "5,000 naira". */
function nairaFigures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:₦|NGN)\s?([\d,]+)/gi)) out.add(m[1].replace(/,/g, ""));
  for (const m of text.matchAll(/\b([\d,]{4,})\s*naira\b/gi)) out.add(m[1].replace(/,/g, ""));
  return [...out].filter((x) => x !== "");
}

const kobo = (n: number) => String(n / 100);
const prices = () => realGet("commerce.membership_prices").value as { individual_kobo: number; organisation_member_kobo: number };

describe("naira figures a visitor can read", () => {
  it("extractor: finds each way a figure is written, and ignores plain numbers", () => {
    expect(nairaFigures("₦129,000 a year, NGN 5,000, and 20,000 naira")).toEqual(["129000", "5000", "20000"]);
    expect(nairaFigures("21 days, 12 calls, 3 readings")).toEqual([]);
  });

  describe.each([
    ["pricing", () => import("../../app/(marketing)/pricing/page")],
    ["home", () => import("../../app/(marketing)/page")],
  ] as const)("%s", (_name, load) => {
    it.each([false, true])("ladder flag %s: only the Membership price and the employer seat price appear", async (flag) => {
      ladderPublic = flag;
      const page = (await load()).default as () => Promise<React.ReactNode>;
      const p = prices();
      const allowed = new Set([kobo(p.individual_kobo), kobo(p.organisation_member_kobo)]);
      const text = await renderPageText(page);
      const figures = nairaFigures(text);
      expect(figures).toEqual(expect.arrayContaining([kobo(p.individual_kobo), kobo(p.organisation_member_kobo)]));
      expect(figures.filter((f) => !allowed.has(f))).toEqual([]);
      expect(text).not.toMatch(/\b(?:volume|bulk) (?:price|pricing|discount)\b/i);
    });
  });

  it.each([
    ["pricing", () => import("../../app/(marketing)/pricing/page")],
    ["home", () => import("../../app/(marketing)/page")],
  ] as const)("%s, founding offer open: the only extra figure is the founding first-year price, computed from config", async (_name, load) => {
    foundingOpen = true;
    try {
      const page = (await load()).default as () => Promise<React.ReactNode>;
      const p = prices();
      const off = (k: number) => k - Math.floor((k * 10) / 100);
      const allowed = new Set([kobo(p.individual_kobo), kobo(p.organisation_member_kobo), kobo(off(p.individual_kobo))]);
      const text = await renderPageText(page);
      expect(text).toMatch(/42 of 100 places left/);
      expect(text).toContain(formatNaira(off(p.individual_kobo)));
      expect(nairaFigures(text).filter((f) => !allowed.has(f))).toEqual([]);
    } finally {
      foundingOpen = false;
    }
  });

  it("sabotage: a stray figure would be caught", () => {
    const allowed = new Set([kobo(prices().individual_kobo)]);
    expect(nairaFigures("Membership ₦" + formatNaira(prices().individual_kobo) + " and a ₦7,000 extra").filter((f) => !allowed.has(f))).toEqual(["7000"]);
  });
});

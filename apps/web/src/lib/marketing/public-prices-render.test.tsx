/**
 * @jest-environment node
 */
import { formatNaira } from "@tarragon/commerce";
import { getProposedConfig as realGet } from "@tarragon/shared";
import { renderPageText } from "./render-server-page";

/**
 * W-47: render /pricing and the homepage with marketing.membership_ladder_public OFF and ON, pull out every naira figure a visitor can
 * read, and assert only the allowed ones appear: the two member prices and the upgrade difference when the ladder is on, the one
 * single-product price when it is off. No other naira figure, no volume words.
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
jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/", useRouter: () => ({ push: jest.fn() }) }));

/** Every naira figure in a text, as digits only: "₦129,000", "NGN 5,000", "5,000 naira". */
function nairaFigures(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:₦|NGN)\s?([\d,]+)/gi)) out.add(m[1].replace(/,/g, ""));
  for (const m of text.matchAll(/\b([\d,]{4,})\s*naira\b/gi)) out.add(m[1].replace(/,/g, ""));
  return [...out].filter((x) => x !== "");
}

const kobo = (n: number) => String(n / 100);
const single = () => (realGet("commerce.membership_prices").value as { individual_kobo: number }).individual_kobo;
const ladder = () => realGet("commerce.membership_ladder").value as { evergreen_kobo: number; evergreen_plus_kobo: number; upgrade_kobo: number };

describe("naira figures a visitor can read", () => {
  it("extractor: finds each way a figure is written, and ignores plain numbers", () => {
    expect(nairaFigures("₦129,000 a year, NGN 5,000, and 20,000 naira")).toEqual(["129000", "5000", "20000"]);
    expect(nairaFigures("21 days, 12 calls, 3 readings")).toEqual([]);
  });

  describe.each([
    ["pricing", () => import("../../app/(marketing)/pricing/page")],
    ["home", () => import("../../app/(marketing)/page")],
  ] as const)("%s", (_name, load) => {
    it("ladder OFF: only the single product price appears", async () => {
      ladderPublic = false;
      const page = (await load()).default as () => Promise<React.ReactNode>;
      const figures = nairaFigures(await renderPageText(page));
      expect(figures.length).toBeGreaterThan(0);
      expect(figures.filter((f) => f !== kobo(single()))).toEqual([]);
    });

    it("ladder ON: only the two member prices and the upgrade difference appear", async () => {
      ladderPublic = true;
      const page = (await load()).default as () => Promise<React.ReactNode>;
      const l = ladder();
      const allowed = new Set([kobo(l.evergreen_kobo), kobo(l.evergreen_plus_kobo), kobo(l.upgrade_kobo)]);
      const text = await renderPageText(page);
      const figures = nairaFigures(text);
      expect(figures.length).toBeGreaterThan(0);
      expect(figures.filter((f) => !allowed.has(f))).toEqual([]);
      expect(text).not.toMatch(/\b(?:volume|bulk) (?:price|pricing|discount)\b/i);
    });
  });

  it("sabotage: a stray figure would be caught", () => {
    const allowed = new Set([kobo(ladder().evergreen_kobo)]);
    expect(nairaFigures("Membership ₦" + formatNaira(ladder().evergreen_kobo) + " and a ₦7,000 extra").filter((f) => !allowed.has(f))).toEqual(["7000"]);
  });
});

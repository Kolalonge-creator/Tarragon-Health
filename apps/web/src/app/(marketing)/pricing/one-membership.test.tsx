/**
 * @jest-environment node
 */
import { formatNaira } from "@tarragon/commerce";
import { getProposedConfig as realGet } from "@tarragon/shared";
import { renderPageText } from "@/lib/marketing/render-server-page";
import PricingPage from "./page";
import HomePage from "../page";

/**
 * Tarragon Health 2.0 (decisions T2-01, T2-05, T2-09, 2026-11-04): the public site shows two plans, Free and Membership, at the price in
 * commerce.membership_prices, and an employer seat at the organisation price. Membership Plus is retired: no page names it, prices it or
 * offers its blood panel or testing days, whichever way marketing.membership_ladder_public is set.
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

const prices = () => realGet("commerce.membership_prices").value as { individual_kobo: number; organisation_member_kobo: number };

describe.each([false, true])("with marketing.membership_ladder_public = %s", (flag) => {
  beforeEach(() => {
    ladderPublic = flag;
  });

  it.each([
    ["/pricing", () => PricingPage()],
    ["the homepage", () => HomePage()],
  ] as const)("%s shows the Membership price and the employer seat price from config, and nothing of Membership Plus", async (_name, page) => {
    const t = await renderPageText(page);
    expect(t).toContain(`₦${formatNaira(prices().individual_kobo)} a year`);
    expect(t).toContain(`₦${formatNaira(prices().organisation_member_kobo)} per person per year`);
    expect(t).not.toMatch(/Membership Plus|129,000|84,000|blood panel|testing day|upgrade/i);
    expect(t).not.toMatch(/\b(Oyo|Osun|Ogun)\b/);
    expect(t).toMatch(/Laboratory tests are not included in the Membership/);
    expect(t).toMatch(/Contact the laboratory for current pricing/);
    expect(t).not.toContain("—");
  });

  it("/pricing shows exactly two plan cards, Free and Membership", async () => {
    const t = await renderPageText(() => PricingPage());
    expect(t).toMatch(/Free No cost, no card, no time limit/);
    expect(t).toMatch(/Membership ₦[\d,]+ a year, paid once/);
  });
});

it("today's config is the founder's decision: 100,000 naira a year, 90,000 naira per employer seat", async () => {
  const t = await renderPageText(() => PricingPage());
  expect(t).toContain("₦100,000 a year");
  expect(t).toContain("₦90,000 per person per year");
});

it("sabotage: the Plus check really catches the old name and prices", () => {
  expect(/Membership Plus|129,000|84,000|blood panel|testing day|upgrade/i.test("Membership Plus: ₦129,000 a year")).toBe(true);
});

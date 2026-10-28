/**
 * @jest-environment node
 */
import { renderPageText } from "@/lib/marketing/render-server-page";
import PricingPage from "./page";
import HomePage from "../page";

jest.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), usePathname: () => "/", useRouter: () => ({ push: jest.fn() }) }));

/** W-46: while marketing.membership_ladder_public is OFF the one paid product is "Membership Plus"; the bare word may not name it. */
describe("ladder OFF: the single paid product is named Membership Plus", () => {
  it("/pricing names Membership Plus and no bare Membership", async () => {
    const t = await renderPageText(() => PricingPage());
    expect(t).toMatch(/Membership Plus: ₦/);
    const bare = [...t.matchAll(/Membership(?! Plus)/g)].map((m) => t.slice(Math.max(0, m.index - 30), m.index + 30));
    expect(bare).toEqual([]);
  });

  it("the homepage names Membership Plus in its price section and FAQ", async () => {
    const t = await renderPageText(() => HomePage());
    expect(t).toMatch(/Membership Plus is optional/);
    expect(t).toMatch(/Does Membership Plus renew by itself\?/);
  });

  it("states the yearly blood test as included and collected for you, and that anyone can still request the bundle", async () => {
    const t = await renderPageText(() => PricingPage());
    expect(t).toMatch(/includes a yearly blood test collected for you/);
    expect(t).toMatch(/Anyone, on any plan, can also request the annual test bundle/);
  });

  it("sabotage: the bare-word pattern does catch the old name", () => {
    expect([..."Membership: ₦129,000 a year".matchAll(/Membership(?! Plus)/g)].length).toBe(1);
    expect([..."Membership Plus: ₦129,000 a year".matchAll(/Membership(?! Plus)/g)].length).toBe(0);
  });
});

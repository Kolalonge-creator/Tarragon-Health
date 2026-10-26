/**
 * The public Membership ladder (founder decision 2026-10-21). Successor to the old "one Membership price" premise of
 * no-public-prices.test.ts: there are now exactly TWO member prices, both read from versioned config, nothing typed, no volume words.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";
import { ladderCards, ladderFaq, LADDER_SAFETY_STATEMENT, LADDER_SAME_CARE_STATEMENT } from "@/app/(marketing)/_content/pricing-ladder";

const PAGE = readFileSync(join(__dirname, "..", "..", "app", "(marketing)", "pricing", "page.tsx"), "utf8");
const labels = { evergreen: "₦84,000", evergreenPlus: "₦129,000" };

function allCopy(): string {
  const cards = ladderCards(labels);
  return [
    ...cards.flatMap((c) => [c.name, c.difference, c.priceLine, c.summary, ...c.includes]),
    ...ladderFaq(21).flatMap((f) => [f.question, f.answer]),
    LADDER_SAFETY_STATEMENT,
    LADDER_SAME_CARE_STATEMENT,
  ].join("\n");
}

describe("the Membership ladder pricing content", () => {
  it("is three cards: Free, Membership, Membership Plus, with the annual blood panel stated first on each", () => {
    const cards = ladderCards(labels);
    expect(cards.map((c) => c.name)).toEqual(["Free", "Membership", "Membership Plus"]);
    expect(cards.map((c) => c.difference)).toEqual(["Annual blood panel: no", "Annual blood panel: no", "Annual blood panel: yes"]);
  });

  it("states that both paid plans are the same care", () => {
    expect(LADDER_SAME_CARE_STATEMENT).toMatch(/same care/);
    expect(LADDER_SAFETY_STATEMENT).toMatch(/same on every plan, including Free/);
  });

  it("only the Plus card lists the yearly blood test; Membership's description says it is not included", () => {
    const [, evergreen, plus] = ladderCards(labels);
    expect(evergreen!.includes.join(" ").toLowerCase()).not.toContain("blood test");
    expect(evergreen!.summary).toMatch(/blood test is not included/);
    expect(plus!.includes.join(" ").toLowerCase()).toContain("blood test");
  });

  it("uses no banned tier word, no em dash, no countdown or scarcity, no ratio and no 'doctor-led'", () => {
    const text = allCopy();
    expect(text).not.toMatch(/\b(basic|lite|standard|premium|gold)\b/i);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/limited time|hurry|only \d+ left|last chance|ends (today|soon)|countdown|save \d+%|% off|<s>|strikethrough/i);
    expect(text).not.toMatch(/doctor-led|\b1:\d{2,}\b/i);
  });

  it("types no naira amount: prices come in as labels formatted from config", () => {
    const amount = /₦\s?\d|\bNGN\s?\d|\b\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)\b/;
    expect(amount.test(allCopy().replace(/₦84,000|₦129,000/g, ""))).toBe(false);
    const content = readFileSync(join(__dirname, "..", "..", "app", "(marketing)", "_content", "pricing-ladder.ts"), "utf8");
    const code = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(amount.test(code)).toBe(false);
  });

  it("the page reads the two prices and the public switch from versioned config", () => {
    expect(PAGE).toContain('getProposedConfig("commerce.membership_ladder")');
    expect(PAGE).toContain('getProposedConfig("marketing.membership_ladder_public")');
  });

  it("the gift page switches on the same config and quotes the two gift prices from it, typing none", () => {
    const gift = readFileSync(join(__dirname, "..", "..", "app", "(marketing)", "gift", "page.tsx"), "utf8");
    expect(gift).toContain('getProposedConfig("marketing.membership_ladder_public")');
    expect(gift).toContain('getProposedConfig("commerce.membership_ladder")');
    expect(gift).toContain("@/lib/marketing/membership");
  });

  it("there are exactly two member prices and no volume tier in the ladder config", () => {
    const v = getProposedConfig("commerce.membership_ladder").value as Record<string, unknown>;
    const priceKeys = Object.keys(v).filter((k) => k.endsWith("_kobo") && k !== "upgrade_kobo");
    expect(priceKeys.sort()).toEqual(["evergreen_kobo", "evergreen_plus_kobo"]);
    expect(JSON.stringify(v).toLowerCase()).not.toMatch(/volume|bracket|seat/);
  });

  it("stays off until the launch conditions are met: the public switch is false in this change", () => {
    expect((getProposedConfig("marketing.membership_ladder_public").value as { enabled: boolean }).enabled).toBe(false);
  });

  it("the refund window in the FAQ is the one passed in, never typed", () => {
    expect(ladderFaq(21).find((f) => f.question.startsWith("Can I get a refund"))!.answer).toContain("within 21 days");
    expect(ladderFaq(30).find((f) => f.question.startsWith("Can I get a refund"))!.answer).toContain("within 30 days");
  });

  it("sabotage: the banned-word check really catches a banned tier name", () => {
    expect(/\b(basic|lite|standard|premium|gold)\b/i.test("Gold plan")).toBe(true);
  });
});

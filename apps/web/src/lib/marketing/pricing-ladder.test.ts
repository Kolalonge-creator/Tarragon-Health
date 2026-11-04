/**
 * The public plans (Tarragon Health 2.0, decisions T2-01, T2-05, T2-09, 2026-11-04): Free and Membership. Membership Plus is retired and
 * no public content offers it. Prices are read from versioned config, nothing typed, no laboratory price, no volume words.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";
import { LAB_TESTS_WHERE, planCards, planFaq, SAFETY_STATEMENT } from "@/app/(marketing)/_content/pricing-ladder";
import { LAB_TESTS_NOT_INCLUDED, MEMBERSHIP_INCLUDES, employerSeatLine } from "./membership";

const PAGE = readFileSync(join(__dirname, "..", "..", "app", "(marketing)", "pricing", "page.tsx"), "utf8");
const labels = { membership: "₦100,000" };

function allCopy(): string {
  return [
    ...planCards(labels).flatMap((c) => [c.name, c.priceLine, c.summary, ...c.includes]),
    ...planFaq(21).flatMap((f) => [f.question, f.answer]),
    SAFETY_STATEMENT,
    LAB_TESTS_WHERE,
    LAB_TESTS_NOT_INCLUDED,
    employerSeatLine("90,000"),
  ].join("\n");
}

describe("the public plan content", () => {
  it("is two cards: Free and Membership", () => {
    expect(planCards(labels).map((c) => c.name)).toEqual(["Free", "Membership"]);
  });

  it("never offers Membership Plus, its blood panel, an upgrade or a testing day", () => {
    expect(allCopy()).not.toMatch(/Membership Plus|blood panel|upgrade|testing day|collected for you/i);
  });

  it("the Membership card lists the shared inclusions and says laboratory tests are not included", () => {
    const membership = planCards(labels).find((c) => c.id === "membership")!;
    expect(membership.includes).toEqual(MEMBERSHIP_INCLUDES);
    expect(membership.summary).toMatch(/Laboratory tests and medicines are not included/);
    expect(LAB_TESTS_NOT_INCLUDED).toMatch(/Contact the laboratory for current pricing/);
    expect(LAB_TESTS_WHERE).toMatch(/any reputable laboratory/);
  });

  it("promises no doctor review turnaround time", () => {
    expect(allCopy()).not.toMatch(/within \d+ (?:hours?|days?|working days?) .*review|reviewed within|\b\d+\s*(?:hours?|hrs)\b/i);
  });

  it("the employer line says the seat is the same Membership, counts only, and on-site visits are separate", () => {
    const line = employerSeatLine("90,000");
    expect(line).toMatch(/same Membership for each employee at ₦90,000 per person per year/);
    expect(line).toMatch(/never anyone's results/);
    expect(line).toMatch(/not part of a seat/);
  });

  it("uses no banned tier word, no em dash, no countdown or scarcity, no ratio, no 'doctor-led', no WhatsApp or SMS", () => {
    const text = allCopy();
    expect(text).not.toMatch(/\b(basic|lite|standard|premium|gold)\b/i);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/limited time|hurry|only \d+ left|last chance|ends (today|soon)|countdown|save \d+%|% off|<s>|strikethrough/i);
    expect(text).not.toMatch(/doctor-led|\b1:\d{2,}\b|whatsapp|\bsms\b/i);
  });

  it("types no naira amount: prices come in as labels formatted from config", () => {
    const amount = /₦\s?\d|\bNGN\s?\d|\b\d{1,3}(?:,\d{3})+\s*(?:naira|NGN)\b/;
    const content = readFileSync(join(__dirname, "..", "..", "app", "(marketing)", "_content", "pricing-ladder.ts"), "utf8");
    const code = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    expect(amount.test(code)).toBe(false);
  });

  it("the pricing page reads its prices through the shared membership module, and no longer switches on the ladder flag", () => {
    expect(PAGE).toContain("@/lib/marketing/membership");
    expect(PAGE).toContain("employerSeatPriceLabel");
    expect(PAGE).not.toContain('getProposedConfig("marketing.membership_ladder_public")');
    expect(PAGE).not.toContain('getProposedConfig("commerce.membership_ladder")');
  });

  it("the refund window in the FAQ is the one passed in, never typed", () => {
    expect(planFaq(21).find((f) => f.question.startsWith("Can I get a refund"))!.answer).toContain("within 21 days");
    expect(planFaq(30).find((f) => f.question.startsWith("Can I get a refund"))!.answer).toContain("within 30 days");
  });

  it("the config the site reads is the founder's: one Membership price and an employer seat 10% below it", () => {
    const v = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number; organisation_member_kobo: number };
    expect(v.organisation_member_kobo).toBe((v.individual_kobo * 9) / 10);
    expect((getProposedConfig("commerce.membership_ladder").value as { plus_sold: boolean }).plus_sold).toBe(false);
  });

  it("sabotage: the banned-word check really catches a banned tier name", () => {
    expect(/\b(basic|lite|standard|premium|gold)\b/i.test("Gold plan")).toBe(true);
  });
});

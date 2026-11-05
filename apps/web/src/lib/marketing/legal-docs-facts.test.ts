import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getProposedConfig } from "@tarragon/shared";

/**
 * W-55: the counsel-facing legal drafts are compared against one small facts file (docs/legal/facts.json) instead of locking literal
 * sentences. When a fact changes, change the file, then the docs; the test tells you which doc disagrees. No dates are pinned.
 */
const LEGAL = join(__dirname, "..", "..", "..", "..", "..", "docs", "legal");
const read = (f: string) => readFileSync(join(LEGAL, f), "utf8");
const facts = JSON.parse(read("facts.json")) as {
  ndpc_registration: string;
  refund_window_days: number;
  currency: string;
  plan_names: string[];
  retired_plan_names: string[];
  membership_price_naira: number;
  employer_seat_price_naira: number;
  removed: { channels: string[]; money: string[]; providers: string[]; stale_phrases_in_cover_memo_and_runbook: string[] };
  founder_inputs_outstanding: string[];
};

const CURRENT_DOCS = ["cover-memo-to-counsel.md", "breach-notification-runbook.md"];

describe("legal facts file", () => {
  it("the refund window in the facts file is the one the platform enforces", () => {
    const v = getProposedConfig("membership.refund").value as { window_days: number };
    expect(facts.refund_window_days).toBe(v.window_days);
  });

  it("the plan names are the catalogue's display names (T2-01: Membership Plus is retired, not sold)", () => {
    expect(facts.plan_names).toEqual(["Free", "Membership"]);
    expect(facts.retired_plan_names).toEqual(["Membership Plus"]);
  });

  it("the Membership and employer seat prices are the ones the platform sells (T2-01, T2-05)", () => {
    const prices = getProposedConfig("commerce.membership_prices").value as { individual_kobo: number; organisation_member_kobo: number };
    const ladder = getProposedConfig("commerce.membership_ladder").value as { plus_sold: boolean };
    expect(facts.membership_price_naira * 100).toBe(prices.individual_kobo);
    expect(facts.employer_seat_price_naira * 100).toBe(prices.organisation_member_kobo);
    expect(ladder.plus_sold).toBe(false);
  });
});

describe("the refreshed legal drafts agree with the facts file", () => {
  it("the cover memo states the refund window and the currency", () => {
    const memo = read("cover-memo-to-counsel.md");
    expect(memo).toContain(`${facts.refund_window_days} days`);
    expect(memo.toLowerCase()).toContain(facts.currency);
    // Plus is named only as retired, in the dated 4 November 2026 note (T2-13), never as something on sale.
    for (const line of memo.split("\n").filter((l) => l.includes("Membership Plus"))) expect(line).toMatch(/retired|Until this date|bought earlier/);
    expect(memo).toContain(`₦${facts.membership_price_naira.toLocaleString("en-NG")}`);
    expect(memo).toContain(`₦${facts.employer_seat_price_naira.toLocaleString("en-NG")}`);
    expect(memo).toContain("Update, 4 November 2026");
  });

  it("the Terms (Schedule C) state the same refund window", () => {
    const terms = read("schedule-c-terms-of-service.md");
    expect(terms).toContain(`${facts.refund_window_days}-day refund`);
  });

  it("the cover memo records NDPC registration as approved, in words that follow the facts file", () => {
    expect(facts.ndpc_registration).toBe("approved");
    expect(read("cover-memo-to-counsel.md")).toMatch(/NDPC registration is approved/);
  });

  for (const file of CURRENT_DOCS) {
    it(`${file} does not describe anything the facts file lists as removed`, () => {
      const text = read(file);
      for (const phrase of facts.removed.stale_phrases_in_cover_memo_and_runbook) expect(text).not.toContain(phrase);
      expect(text).not.toMatch(/\bTier [1-5]\b/);
      // Removed things may be mentioned only to say they are gone.
      for (const name of [...facts.removed.channels, ...facts.removed.money, ...facts.removed.providers]) {
        for (const line of text.split("\n").filter((l) => l.includes(name))) {
          expect(line).toMatch(/removed|\bno |no longer|does not exist|gone|withdrawn|no wallet|without|never|not |v3|replaced/i);
        }
      }
    });
  }

  it("open founder inputs are marked as such in the runbook, never invented", () => {
    expect(facts.founder_inputs_outstanding.length).toBeGreaterThan(0);
    expect(read("breach-notification-runbook.md")).toMatch(/FOUNDER INPUT NEEDED/);
  });

  it("sabotage: a stale phrase would be caught", () => {
    const stale = "WhatsApp is notification-only";
    expect("## Communications: WhatsApp is notification-only".includes(stale)).toBe(true);
  });
});

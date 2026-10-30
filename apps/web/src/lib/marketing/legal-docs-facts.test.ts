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
  removed: { channels: string[]; money: string[]; providers: string[]; stale_phrases_in_cover_memo_and_runbook: string[] };
  founder_inputs_outstanding: string[];
};

const CURRENT_DOCS = ["cover-memo-to-counsel.md", "breach-notification-runbook.md"];

describe("legal facts file", () => {
  it("the refund window in the facts file is the one the platform enforces", () => {
    const v = getProposedConfig("membership.refund").value as { window_days: number };
    expect(facts.refund_window_days).toBe(v.window_days);
  });

  it("the plan names are the catalogue's display names", () => {
    expect(facts.plan_names).toEqual(["Free", "Membership", "Membership Plus"]);
  });
});

describe("the refreshed legal drafts agree with the facts file", () => {
  it("the cover memo states the refund window and the currency", () => {
    const memo = read("cover-memo-to-counsel.md");
    expect(memo).toContain(`${facts.refund_window_days} days`);
    expect(memo.toLowerCase()).toContain(facts.currency);
    expect(memo).toContain("Membership Plus");
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

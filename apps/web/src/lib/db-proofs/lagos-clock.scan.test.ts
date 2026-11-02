import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "@jest/globals";

/**
 * A database proof must not cut the UTC clock into days, weeks or months.
 *
 * Why. This platform keeps time in Africa/Lagos, which is an hour ahead of UTC all year. A proof that wrote
 * `date_trunc('month', now())` was asking for the UTC month, and the product function it was testing asked for the
 * Lagos month. The two agree except in the hour after midnight in Lagos on the last day of a month, when UTC still
 * says the old month. CI runs a proof once, so for that hour every month, four proofs failed at once and main-dev went
 * red (s60, s59d, w01 and, by a different route, s38c). The proof was wrong, not the product: nothing was broken for a
 * patient. It is the same trap for `date_trunc('day', now())`, which is wrong for an hour every single day.
 *
 * The rule: when a proof needs a day or month boundary, take it in Lagos, the way the product does:
 *   date_trunc('month', now() at time zone 'Africa/Lagos')
 *
 * What this scan does. It strips comments from every proof in packages/db/tests and finds `date_trunc(<day|week|month|
 * quarter|year>, <clock>)` where the clock is not followed by `at time zone`. Existing uses are listed in ALLOW with a
 * reason. The list can only shrink: a new use fails the build, and so does a listed use that has been fixed but not
 * removed from the list.
 *
 * Every entry below is a proof whose product code under test takes the month as an argument, or stamps ledger rows
 * with the UTC `current_date` (private.finance_post_from_payment and its siblings do), so the proof and the product
 * agree and neither flakes. If the product moves to Lagos dates, these move in the same change. That ledger dating is
 * itself against the "Africa/Lagos always" rule and is recorded as a product finding, not fixed here.
 *
 * To check a proof on a chosen day, use scripts/run-db-proofs-at.sh. It changes the clock the SCRIPT reads, not the
 * database's, so it cannot test a proof whose product function reads the clock itself (the s60 / s59d / w01 case).
 */

const TESTS_DIR = join(process.cwd(), "../../packages/db/tests");

const BUCKET =
  /date_trunc\(\s*'(?:day|week|month|quarter|year)'\s*,\s*(?:now\(\)|current_date|current_timestamp|clock_timestamp\(\)|transaction_timestamp\(\)|statement_timestamp\(\))(?!\s*at\s+time\s+zone)/gi;

const AGREES = "the product under test uses the UTC date or takes the month as an argument, so proof and product agree";

const ALLOW: Record<string, { count: number; why: string }> = {
  "finance_posting_failures_queue.sql": { count: 3, why: `closes the UTC month; the posting functions date entries with UTC current_date (${AGREES})` },
  "finance_revenue_by_funding_source.sql": { count: 1, why: `fixture helper; finance_revenue_by_funding_source defaults its window from UTC current_date (${AGREES})` },
  "money_reconciliation_daily_alert.sql": { count: 1, why: `fixture ledger row; the entries are dated with UTC current_date like the product's (${AGREES})` },
  "money_reconciliation_screen.sql": { count: 18, why: `fixture ledger rows dated with UTC current_date like the product's (${AGREES})` },
  "s25_catalogue_orders_payments.sql": { count: 2, why: `closes the UTC month the order is posted in (${AGREES})` },
  "s31x_payout_reversal_gl_and_batch_controls.sql": { count: 1, why: `sabotage fixture ledger row dated with UTC current_date (${AGREES})` },
  "s74_partner_settlement.sql": { count: 3, why: `private.partner_settlement_run takes the month as an argument, and the terms use the same month (${AGREES})` },
  "s80c_ai_cost_and_review_samples.sql": { count: 1, why: `public.ai_cost_by_system_month groups by the UTC month (${AGREES})` },
  "voucher_redemption_cross_voucher_double_count_and_revrec_rounding.sql": { count: 1, why: `fixture helper default; the function it wraps takes the period as an argument (${AGREES})` },
};

function bucketCounts(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const file of readdirSync(TESTS_DIR).filter((f) => f.endsWith(".sql")).sort()) {
    // Drop `-- comments` first so a note that mentions the pattern is not counted.
    const source = readFileSync(join(TESTS_DIR, file), "utf8")
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .join("\n");
    const hits = source.match(BUCKET);
    if (hits) out[file] = hits.length;
  }
  return out;
}

describe("database proofs cut days and months in Lagos, not UTC", () => {
  const found = bucketCounts();

  it("finds the proofs directory", () => {
    expect(readdirSync(TESTS_DIR).filter((f) => f.endsWith(".sql")).length).toBeGreaterThan(100);
  });

  it("has no new proof that truncates the UTC clock, and none that does it more often than listed", () => {
    const worse = Object.entries(found)
      .filter(([file, count]) => count > (ALLOW[file]?.count ?? 0))
      .map(([file, count]) => `${file}: ${count} (allowed ${ALLOW[file]?.count ?? 0})`);
    expect(worse).toEqual([]);
  });

  it("lists only uses that still exist, so the list shrinks as they are fixed", () => {
    const stale = Object.entries(ALLOW)
      .filter(([file, { count }]) => (found[file] ?? 0) < count)
      .map(([file, { count }]) => `${file}: listed ${count}, found ${found[file] ?? 0}. Lower or remove the entry.`);
    expect(stale).toEqual([]);
  });

  it("catches the pattern that broke s60, and ignores the Lagos form and comments", () => {
    const hit = (sql: string) => (sql.replace(/--.*$/gm, "").match(BUCKET) ?? []).length;
    expect(hit("v := (date_trunc('month', now()) - interval '1 month')::date;")).toBe(1);
    expect(hit("x := date_trunc('day', current_date);")).toBe(1);
    expect(hit("x := date_trunc('month', now() - interval '3 months')::date;")).toBe(1);
    expect(hit("x := date_trunc('month', now() at time zone 'Africa/Lagos');")).toBe(0);
    expect(hit("x := date_trunc('hour', now());")).toBe(0);
    expect(hit("-- never write date_trunc('month', now()) in a proof")).toBe(0);
  });
});

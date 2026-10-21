import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  KIND_LABEL,
  OWNER_LABEL,
  ageLabel,
  mismatchListSchema,
  parseScreenParams,
  subjectHref,
  summaryListSchema,
} from "./money-reconciliation";

const ROOT = join(__dirname, "..", "..", "..", "..", "..");

describe("every kind the migration can report has a label and a known owner", () => {
  const sql = readFileSync(join(ROOT, "supabase", "migrations", "20261021110417_money_reconciliation_screen.sql"), "utf8");
  const kinds = [...sql.matchAll(/select '([a-z_]+)'(?:::text)?, '(?:high|medium)'/g)].map((m) => m[1]);
  const owners = [...new Set([...sql.matchAll(/'(finance|engineering|support)'(?:::text)?, /g)].map((m) => m[1]))];

  it("finds the 29 kinds in the migration", () => {
    expect(new Set(kinds).size).toBe(29);
  });
  it("labels each one", () => {
    for (const k of kinds) expect(KIND_LABEL[k]).toBeTruthy();
    expect(Object.keys(KIND_LABEL).sort()).toEqual([...new Set(kinds)].sort());
  });
  it("names each owner hint the SQL uses", () => {
    for (const o of owners) expect(OWNER_LABEL[o]).toBeTruthy();
  });
});

describe("the screen is read-only", () => {
  it("the migration contains no write statement outside its own function definitions", () => {
    const sql = readFileSync(join(ROOT, "supabase", "migrations", "20261021110417_money_reconciliation_screen.sql"), "utf8");
    const body = sql.replace(/--.*$/gm, "");
    expect(body).not.toMatch(/\b(insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i);
  });
  it("the page calls only the two read functions", () => {
    const page = readFileSync(join(__dirname, "..", "..", "app", "(dashboard)", "finance", "money-reconciliation", "page.tsx"), "utf8");
    expect([...page.matchAll(/\.rpc\("([a-z_]+)"/g)].map((m) => m[1]).sort()).toEqual(["money_reconciliation_list", "money_reconciliation_summary"]);
    expect(page).not.toMatch(/"use server"|\.insert\(|\.update\(|\.delete\(/);
  });
});

describe("parseScreenParams", () => {
  it("defaults to everything, page 1, no test rows", () => {
    expect(parseScreenParams({})).toEqual({ kind: null, includeTest: false, page: 1 });
  });
  it("keeps a known kind and drops an unknown one (never an empty list for a typo)", () => {
    expect(parseScreenParams({ kind: "paid_order_no_entitlement" }).kind).toBe("paid_order_no_entitlement");
    expect(parseScreenParams({ kind: "nonsense" }).kind).toBeNull();
  });
  it("only test=1 includes test rows, and a bad page is page 1", () => {
    expect(parseScreenParams({ test: "1" }).includeTest).toBe(true);
    expect(parseScreenParams({ test: "true" }).includeTest).toBe(false);
    expect(parseScreenParams({ page: "-3" }).page).toBe(1);
    expect(parseScreenParams({ page: "abc" }).page).toBe(1);
    expect(parseScreenParams({ page: "4" }).page).toBe(4);
  });
});

describe("ageLabel", () => {
  const now = new Date("2026-10-21T12:00:00Z");
  it("says how long", () => {
    expect(ageLabel("2026-10-21T11:30:00Z", now)).toBe("under an hour");
    expect(ageLabel("2026-10-21T09:00:00Z", now)).toBe("3 hours");
    expect(ageLabel("2026-10-19T12:00:00Z", now)).toBe("2 days");
    expect(ageLabel(null, now)).toBe("unknown");
  });
});

describe("row parsing fails loudly rather than reading as empty", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const row = {
    kind: "paid_order_no_entitlement", severity: "high", organisation_id: id, subject_type: "order", subject_id: id,
    related_type: null, related_id: null, delta_kobo: 500000, since: "2026-10-19T12:00:00Z", owner_hint: "engineering", detail: "x", total_count: 1,
  };
  it("accepts a real row and a null delta", () => {
    expect(mismatchListSchema.safeParse([row, { ...row, delta_kobo: null }]).success).toBe(true);
  });
  it("rejects a float amount and an unknown severity", () => {
    expect(mismatchListSchema.safeParse([{ ...row, delta_kobo: 1.5 }]).success).toBe(false);
    expect(mismatchListSchema.safeParse([{ ...row, severity: "low" }]).success).toBe(false);
  });
  it("rejects a malformed summary", () => {
    expect(summaryListSchema.safeParse([{ kind: "x", severity: "high", n: -1, delta_abs_kobo: 0, oldest: null }]).success).toBe(false);
  });
});

describe("links", () => {
  it("every subject type the SQL uses can be opened or is named", () => {
    for (const t of ["order", "payment", "refund", "entitlement", "earnings_line", "payout", "journal_entry"]) expect(subjectHref(t)).toBeTruthy();
    expect(subjectHref("nope")).toBeNull();
  });
});

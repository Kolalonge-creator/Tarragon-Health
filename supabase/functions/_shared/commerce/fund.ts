/**
 * Community Access Fund (S72, function 19.11): parsing what the database returns for the public report and for a donor's own pledges.
 * INV-09: nothing in these shapes is a balance a person could spend. The report is aggregate only and withholds small cells whole (the database
 * applies the single minimum-cell rule); this file never computes a figure the database did not send.
 */
export interface FundCell { readonly kind: string; readonly count: number; readonly totalKobo: number }
export type FundReport =
  | { readonly open: false; readonly criteria: readonly string[] }
  | {
      readonly open: true;
      readonly minCell: number;
      readonly criteria: readonly string[];
      readonly donations: { readonly withheld: true } | { readonly withheld: false; readonly count: number; readonly totalKobo: number };
      readonly grants:
        | { readonly withheld: true }
        | { readonly withheld: false; readonly totalsWithheld: boolean; readonly count: number | null; readonly totalKobo: number | null; readonly cells: readonly FundCell[] };
    };

const isInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export function parseFundReport(raw: unknown): FundReport {
  const closed: FundReport = { open: false, criteria: [] };
  if (typeof raw !== "object" || raw === null) return closed;
  const x = raw as Record<string, unknown>;
  const criteria = strings(x["criteria"]);
  if (x["open"] !== true) return { open: false, criteria };
  const min = x["min_cell"];
  if (!isInt(min) || min < 2) return { open: false, criteria };
  const d = x["donations"] as Record<string, unknown> | undefined;
  const g = x["grants"] as Record<string, unknown> | undefined;
  const donations: Extract<FundReport, { open: true }>["donations"] =
    d && isInt(d["count"]) && isInt(d["total_kobo"]) && d["count"] >= min ? { withheld: false, count: d["count"], totalKobo: d["total_kobo"] } : { withheld: true };
  let grants: Extract<FundReport, { open: true }>["grants"] = { withheld: true };
  if (g && g["withheld"] !== true) {
    const cells: FundCell[] = [];
    if (Array.isArray(g["by_kind"])) {
      for (const c of g["by_kind"]) {
        if (typeof c !== "object" || c === null) continue;
        const y = c as Record<string, unknown>;
        // a cell below the minimum is never shown, whatever the database sent
        if (typeof y["kind"] === "string" && isInt(y["count"]) && isInt(y["total_kobo"]) && y["count"] >= min) cells.push({ kind: y["kind"], count: y["count"], totalKobo: y["total_kobo"] });
      }
    }
    const totalsWithheld = g["totals_withheld"] === true || !isInt(g["count"]) || !isInt(g["total_kobo"]);
    grants = { withheld: false, totalsWithheld, count: totalsWithheld ? null : (g["count"] as number), totalKobo: totalsWithheld ? null : (g["total_kobo"] as number), cells };
  }
  return { open: true, minCell: min, criteria, donations, grants };
}

export interface DonationRow {
  readonly id: string;
  readonly reference: string;
  readonly amountKobo: number;
  readonly state: "pledged" | "received" | "cancelled" | "lapsed";
  readonly itemNameKey: string | null;
  readonly createdAt: string;
  readonly pledgeExpiresAt: string;
}
const DSTATES = ["pledged", "received", "cancelled", "lapsed"] as const;

export function parseDonations(raw: unknown): DonationRow[] {
  if (!Array.isArray(raw)) return [];
  const out: DonationRow[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const x = r as Record<string, unknown>;
    if (typeof x["id"] !== "string" || typeof x["reference"] !== "string" || !isInt(x["amount_kobo"]) || !DSTATES.includes(x["state"] as (typeof DSTATES)[number])) continue;
    if (typeof x["created_at"] !== "string" || typeof x["pledge_expires_at"] !== "string") continue;
    out.push({
      id: x["id"], reference: x["reference"], amountKobo: x["amount_kobo"], state: x["state"] as DonationRow["state"],
      itemNameKey: typeof x["item_name_key"] === "string" ? x["item_name_key"] : null, createdAt: x["created_at"], pledgeExpiresAt: x["pledge_expires_at"],
    });
  }
  return out;
}

export interface FundSupportRow { readonly itemCode: string; readonly itemNameKey: string | null; readonly status: "approved" | "used" | "expired" | "cancelled"; readonly expiresAt: string }
const GSTATES = ["approved", "used", "expired", "cancelled"] as const;
export function parseFundSupport(raw: unknown): FundSupportRow[] {
  if (!Array.isArray(raw)) return [];
  const out: FundSupportRow[] = [];
  for (const r of raw) {
    if (typeof r !== "object" || r === null) continue;
    const x = r as Record<string, unknown>;
    if (typeof x["item_code"] !== "string" || typeof x["expires_at"] !== "string" || !GSTATES.includes(x["status"] as (typeof GSTATES)[number])) continue;
    out.push({ itemCode: x["item_code"], itemNameKey: typeof x["item_name_key"] === "string" ? x["item_name_key"] : null, status: x["status"] as FundSupportRow["status"], expiresAt: x["expires_at"] });
  }
  return out;
}

/** Donation error codes from the database, as i18n keys. */
export function fundErrorKey(message: string): string {
  if (message.includes("access_fund_not_open")) return "fund.error.not_open";
  if (message.includes("donation_amount_invalid")) return "fund.error.amount";
  if (message.includes("too_many_open_pledges")) return "fund.error.too_many";
  if (message.includes("item_not_available")) return "fund.error.item";
  return "fund.error.unknown";
}

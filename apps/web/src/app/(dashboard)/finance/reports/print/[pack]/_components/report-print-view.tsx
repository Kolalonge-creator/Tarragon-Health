"use client";

import type { ReportPack } from "../page";
import { GovernmentFilingsPack } from "./government-filings-pack";
import { InvestorPack } from "./investor-pack";
import { AuditPack } from "./audit-pack";
import { lagosToday, lagosYear, lagosYearStart } from "@/lib/format-date";

/**
 * Every default here is a Lagos calendar date, not a UTC one.
 *
 * `new Date().toISOString().slice(0, 10)` is the server's UTC day, which is
 * the previous day in Lagos for the first hour of every day, and it is what
 * feeds `from`/`to` into the packs below: a report headed "to 4 September"
 * that silently stops at 23:00 on the 3rd. This is also a client component,
 * so the UTC form rendered the server's day during SSR and the browser's own
 * clock on hydration. Pinning both to Africa/Lagos settles the report period
 * and the hydration mismatch with the same change.
 */

export function ReportPrintView({
  pack,
  year,
  from,
  to,
  currency,
}: {
  pack: ReportPack;
  year?: string;
  from?: string;
  to?: string;
  currency?: string;
}) {
  if (pack === "government-filings") {
    const y = year ? parseInt(year, 10) : lagosYear();
    return <GovernmentFilingsPack year={Number.isFinite(y) ? y : lagosYear()} />;
  }

  const resolvedFrom = from || lagosYearStart();
  const resolvedTo = to || lagosToday();
  const resolvedCurrency = currency || "NGN";

  if (pack === "investor-pack") {
    return <InvestorPack from={resolvedFrom} to={resolvedTo} currency={resolvedCurrency} />;
  }

  return <AuditPack from={resolvedFrom} to={resolvedTo} currency={resolvedCurrency} />;
}

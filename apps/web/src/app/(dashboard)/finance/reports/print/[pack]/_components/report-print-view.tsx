"use client";

import type { ReportPack } from "../page";
import { GovernmentFilingsPack } from "./government-filings-pack";
import { InvestorPack } from "./investor-pack";
import { AuditPack } from "./audit-pack";

const today = () => new Date().toISOString().slice(0, 10);
const yearStart = () => `${new Date().getFullYear()}-01-01`;

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
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return <GovernmentFilingsPack year={Number.isFinite(y) ? y : new Date().getFullYear()} />;
  }

  const resolvedFrom = from || yearStart();
  const resolvedTo = to || today();
  const resolvedCurrency = currency || "NGN";

  if (pack === "investor-pack") {
    return <InvestorPack from={resolvedFrom} to={resolvedTo} currency={resolvedCurrency} />;
  }

  return <AuditPack from={resolvedFrom} to={resolvedTo} currency={resolvedCurrency} />;
}

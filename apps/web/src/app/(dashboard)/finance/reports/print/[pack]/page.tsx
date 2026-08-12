import { notFound } from "next/navigation";
import { ReportPrintView } from "./_components/report-print-view";

const PACKS = ["government-filings", "investor-pack", "audit-pack"] as const;
export type ReportPack = (typeof PACKS)[number];

function isPack(value: string): value is ReportPack {
  return (PACKS as readonly string[]).includes(value);
}

export default async function FinanceReportPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ pack: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { pack } = await params;
  if (!isPack(pack)) notFound();

  const sp = await searchParams;
  const get = (key: string) => (typeof sp[key] === "string" ? sp[key] : undefined);

  return (
    <ReportPrintView
      pack={pack}
      year={get("year")}
      from={get("from")}
      to={get("to")}
      currency={get("currency")}
    />
  );
}

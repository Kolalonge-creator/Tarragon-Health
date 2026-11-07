import { notFound } from "next/navigation";
import { z } from "zod";
import { RECORD_TYPES } from "@/lib/finance/transactions";
import { TransactionDetailView } from "../../../_components/transaction-detail";

export const metadata = { title: "Transaction" };
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ recordType: z.enum(RECORD_TYPES), recordId: z.uuid() });

/** One payment, failed payment or refund. The finance layout already gates access; the RPC enforces it again and audits the read. */
export default async function FinanceTransactionPage({ params }: { params: Promise<{ recordType: string; recordId: string }> }) {
  const parsed = paramsSchema.safeParse(await params);
  if (!parsed.success) notFound();
  return <TransactionDetailView recordType={parsed.data.recordType} recordId={parsed.data.recordId} />;
}

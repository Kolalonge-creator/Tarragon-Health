"use client";

import { usePatientReceipts, type PatientReceipt, type PatientReceiptServiceType, type PatientReceiptStatus } from "@/lib/queries/receipts";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { APP_ICON } from "@/lib/icons";
import { fromMinorUnits, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

const INVOICEABLE_STATUSES: PatientReceiptStatus[] = ["successful", "refunded"];

const SERVICE_ICON: Record<PatientReceiptServiceType, keyof typeof APP_ICON> = {
  membership: "billing",
  laboratory: "labs",
  pharmacy: "pharmacy",
  referral: "referral",
  consultation: "booking",
  care_voucher: "receipts",
};

const STATUS_LABEL: Record<PatientReceiptStatus, string> = {
  successful: "Paid",
  pending: "Pending",
  failed: "Failed",
  refunded: "Refunded",
  pending_refund: "Refund pending",
};

const STATUS_VARIANT: Record<PatientReceiptStatus, "green" | "amber" | "red" | "grey"> = {
  successful: "green",
  pending: "amber",
  failed: "red",
  refunded: "grey",
  pending_refund: "amber",
};

function formatAmount(amountMinor: number, currency: string): string {
  const cur = (["NGN", "GBP", "USD"] as const).includes(currency as Currency) ? (currency as Currency) : "NGN";
  return `${CURRENCY_SYMBOL[cur]}${fromMinorUnits(amountMinor, cur).toLocaleString()}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" });
}

function ReceiptRow({ receipt }: { receipt: PatientReceipt }) {
  const Icon = APP_ICON[SERVICE_ICON[receipt.service_type] ?? "billing"];
  return (
    <div className="flex items-center justify-between gap-4 border-b border-charcoal-ink/5 py-3 last:border-b-0">
      <div className="flex items-center gap-3">
        <Icon className="h-5 w-5 shrink-0 text-deep-forest" strokeWidth={2} />
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{receipt.service_label}</p>
          <p className="text-xs text-charcoal-ink/50">
            {formatDate(receipt.occurred_at)} · Ref {receipt.reference.slice(0, 18)}
          </p>
        </div>
      </div>
      <div className="text-right">
        <p className="text-sm font-semibold tabular-nums text-charcoal-ink">
          {formatAmount(receipt.amount_minor, receipt.currency)}
        </p>
        <Badge variant={STATUS_VARIANT[receipt.status]}>{STATUS_LABEL[receipt.status]}</Badge>
        {INVOICEABLE_STATUSES.includes(receipt.status) && (
          <a
            href={`/api/patient/receipts/${receipt.service_type}/${receipt.id}/invoice`}
            className="mt-1 block text-xs font-medium text-brand-green hover:underline"
          >
            Download invoice
          </a>
        )}
      </div>
    </div>
  );
}

export function ReceiptsList() {
  const { data: receipts, isLoading, isError } = usePatientReceipts();

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-charcoal-ink/50">Loading your receipts…</CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-charcoal-ink/50">
          Could not load your receipts. Try again in a moment.
        </CardContent>
      </Card>
    );
  }

  if (!receipts || receipts.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-charcoal-ink/50">
          Nothing here yet. Payments you make will show up as receipts.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="pt-4">
        {receipts.map((r) => (
          <ReceiptRow key={`${r.service_type}:${r.id}`} receipt={r} />
        ))}
      </CardContent>
    </Card>
  );
}

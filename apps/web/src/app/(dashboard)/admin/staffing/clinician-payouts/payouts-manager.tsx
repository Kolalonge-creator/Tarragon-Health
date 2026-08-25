"use client";

import { useState } from "react";
import {
  useAccruedEarningsByClinician,
  useSettleClinicianEarnings,
  useFinanceBills,
  useApproveFinanceBill,
  usePayFinanceBill,
} from "@/lib/queries/clinician-earnings";
import { DOCTOR_TIER_LABEL } from "@/lib/clinical/doctor-tier";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { koboToNaira, CURRENCY_SYMBOL, type Currency } from "@tarragon/shared";

function money(amountMinor: number, currency: string): string {
  const symbol = CURRENCY_SYMBOL[currency as Currency] ?? currency;
  return `${symbol}${koboToNaira(amountMinor).toLocaleString()}`;
}

function AccruedSection() {
  const { data: rows, isLoading } = useAccruedEarningsByClinician();
  const settle = useSettleClinicianEarnings();
  const [settlingId, setSettlingId] = useState<string | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Owed, not yet billed</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          Accrues automatically when a Tier 4/5 doctor completes a paid video visit. Settling
          rolls everything owed to one clinician into a single bill — approve and pay it like
          any other vendor bill (Withholding tax handled the same way too).
        </p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && (rows ?? []).length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing owed right now.</p>
        )}
        {(rows ?? []).length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {rows!.map((row) => (
              <li key={row.clinicalStaffId} className="flex flex-wrap items-center gap-2 py-3">
                <p className="text-sm font-medium text-charcoal-ink">{row.fullName}</p>
                {row.doctorTier && (
                  <Badge variant="blue">{DOCTOR_TIER_LABEL[row.doctorTier]}</Badge>
                )}
                <p className="text-sm text-charcoal-ink/70">
                  {row.count} consult{row.count === 1 ? "" : "s"} · {money(row.totalMinor, row.currency)}
                </p>
                <Button
                  size="sm"
                  className="ml-auto"
                  disabled={settle.isPending && settlingId === row.clinicalStaffId}
                  onClick={() => {
                    setSettlingId(row.clinicalStaffId);
                    settle.mutate(row.clinicalStaffId);
                  }}
                >
                  {settle.isPending && settlingId === row.clinicalStaffId
                    ? "Settling…"
                    : "Settle into a bill"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {settle.isError && (
          <p className="mt-2 text-sm text-red-600">
            {(settle.error as Error).message || "Could not settle those earnings."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function DraftBillsSection() {
  const { data: bills, isLoading } = useFinanceBills("draft");
  const approve = useApproveFinanceBill();

  const clinicianBills = (bills ?? []).filter((b) => b.expense_account_code === "2750");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Awaiting approval</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && clinicianBills.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No draft payout bills.</p>
        )}
        {clinicianBills.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {clinicianBills.map((bill) => (
              <li key={bill.id} className="flex flex-wrap items-center gap-2 py-3">
                <p className="text-sm font-medium text-charcoal-ink">
                  #{bill.bill_no} — {bill.vendor_name}
                </p>
                <p className="text-sm text-charcoal-ink/70">
                  {money(bill.amount_minor, bill.currency)}
                  {bill.wht_minor > 0 ? ` (WHT ${money(bill.wht_minor, bill.currency)})` : ""}
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-auto"
                  disabled={approve.isPending}
                  onClick={() => approve.mutate(bill.id)}
                >
                  {approve.isPending ? "Approving…" : "Approve"}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {approve.isError && (
          <p className="mt-2 text-sm text-red-600">
            {(approve.error as Error).message || "Could not approve that bill."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PayRow({ bill }: { bill: { id: string; bill_no: number; vendor_name: string; amount_minor: number; currency: string; wht_minor: number } }) {
  const pay = usePayFinanceBill();
  const [bankAccountCode, setBankAccountCode] = useState("1000");
  const netMinor = bill.amount_minor - bill.wht_minor;

  return (
    <li className="flex flex-wrap items-end gap-2 py-3">
      <div>
        <p className="text-sm font-medium text-charcoal-ink">
          #{bill.bill_no} — {bill.vendor_name}
        </p>
        <p className="text-sm text-charcoal-ink/70">Net due: {money(netMinor, bill.currency)}</p>
      </div>
      <div className="ml-auto flex items-end gap-2">
        <div className="space-y-1">
          <label className="text-xs text-charcoal-ink/60" htmlFor={`bank-${bill.id}`}>
            Paid from account
          </label>
          <Input
            id={`bank-${bill.id}`}
            className="h-8 w-24 text-xs"
            value={bankAccountCode}
            onChange={(e) => setBankAccountCode(e.target.value)}
          />
        </div>
        <Button
          size="sm"
          disabled={pay.isPending}
          onClick={() =>
            pay.mutate({
              billId: bill.id,
              bankAccountCode,
              paidDate: new Date().toISOString().slice(0, 10),
            })
          }
        >
          {pay.isPending ? "Recording…" : "Mark paid"}
        </Button>
      </div>
      {pay.isError && (
        <p className="w-full text-sm text-red-600">
          {(pay.error as Error).message || "Could not record that payment."}
        </p>
      )}
    </li>
  );
}

function ApprovedBillsSection() {
  const { data: bills, isLoading } = useFinanceBills("approved");
  const clinicianBills = (bills ?? []).filter((b) => b.expense_account_code === "2750");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Approved — record the transfer once it&apos;s sent</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-charcoal-ink/60">
          This records that a payment happened (bank transfer, however you sent it) — it doesn&apos;t
          move money itself. The account code defaults to 1000 (Paystack settlement); change it if
          this was paid from a different account.
        </p>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && clinicianBills.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">Nothing approved and unpaid.</p>
        )}
        {clinicianBills.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {clinicianBills.map((bill) => (
              <PayRow key={bill.id} bill={bill} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function PayoutsManager() {
  return (
    <div className="space-y-6">
      <AccruedSection />
      <DraftBillsSection />
      <ApprovedBillsSection />
    </div>
  );
}

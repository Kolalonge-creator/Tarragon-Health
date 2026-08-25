"use client";

import { useActionState, useState } from "react";
import {
  buyCareVoucher,
  payTowardVoucher,
  redeemSubscriptionVoucher,
} from "@/app/(dashboard)/patient/vouchers/actions";
import {
  useMyVouchers,
  useVoucherCatalogue,
  useVoucherConfig,
  useMyReferralCode,
  useRedeemReferralCode,
  isVoucherSpendable,
  type CareVoucher,
} from "@/lib/queries/vouchers";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentMethodPicker } from "@/components/payment-method-picker";
import { Select } from "@/components/ui/select";
import { useSponsorableProfiles } from "@/lib/queries/care-access";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const STATUS_LABEL: Record<string, string> = {
  reserved: "Still paying",
  active: "Ready to use",
  redeemed: "Used",
  expired: "Expired",
  cancelled: "Cancelled",
};

const STATUS_STYLE: Record<string, string> = {
  reserved: "bg-amber-50 text-amber-800",
  active: "bg-emerald-50 text-emerald-800",
  redeemed: "bg-slate-100 text-slate-600",
  expired: "bg-slate-100 text-slate-600",
  cancelled: "bg-slate-100 text-slate-600",
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Care Vouchers: what a patient has paid for ahead of time, and what they are
 * part way through paying for.
 *
 * Deliberately never shows a total, a balance, or a combined figure. A
 * voucher is an entitlement to one named service, and presenting several of
 * them as an amount of money would misdescribe the thing the patient actually
 * holds, in exactly the way the product is designed not to.
 */
export function CareVouchersCard({ patientId }: { patientId: string }) {
  const { data: vouchers } = useMyVouchers(patientId);
  const { data: catalogue } = useVoucherCatalogue();
  const { data: sponsorable } = useSponsorableProfiles();
  const { data: config } = useVoucherConfig();
  const { data: referralCode } = useMyReferralCode();

  const [payingFor, setPayingFor] = useState<string | null>(null);
  const [payState, payAction, payPending] = useActionState(payTowardVoucher, undefined);
  const [buyState, buyAction, buyPending] = useActionState(buyCareVoucher, undefined);
  const [redeemState, redeemAction, redeemPending] = useActionState(
    redeemSubscriptionVoucher,
    undefined
  );
  const [buyOpen, setBuyOpen] = useState(false);

  const redeemCode = useRedeemReferralCode();
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemResult, setRedeemResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const all = vouchers ?? [];
  const live = all.filter((v) => v.status === "reserved" || isVoucherSpendable(v));
  const past = all.filter((v) => !live.includes(v));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.billing className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Your care vouchers
        </CardTitle>
        <p className="pt-1 text-sm text-slate-600">
          A voucher is for the service named on it and for you alone. It is not an account balance
          and it is never exchangeable for cash.
        </p>
      </CardHeader>

      <CardContent className="space-y-5">
        {live.length === 0 && (
          <p className="text-sm text-slate-600">
            You do not have any vouchers yet.
          </p>
        )}

        {live.map((v) => (
          <VoucherRow
            key={v.id}
            voucher={v}
            isPaying={payingFor === v.id}
            onTogglePay={() => setPayingFor(payingFor === v.id ? null : v.id)}
            payAction={payAction}
            payPending={payPending}
            payError={payingFor === v.id ? payState?.error : undefined}
            minInstalmentKobo={config?.min_instalment_kobo ?? 100000}
          />
        ))}

        {/* Starting a gifted year is the recipient's own act, never the
            purchaser's: public.redeem_subscription_voucher refuses anybody but
            the beneficiary. If they already have a plan running, redeeming
            extends it rather than opening a second one. */}
        {live
          .filter((v) => v.subscription_plan_id && isVoucherSpendable(v))
          .map((v) => (
            <form key={`redeem-${v.id}`} action={redeemAction} className="space-y-2">
              <input type="hidden" name="voucherId" value={v.id} />
              <Button type="submit" size="sm" disabled={redeemPending}>
                {redeemPending ? "Starting…" : `Start my year of ${v.sku_name ?? "care"}`}
              </Button>
            </form>
          ))}
        {redeemState?.error && <p className="text-xs text-red-600">{redeemState.error}</p>}
        {redeemState?.message && (
          <p className="text-xs text-emerald-700">{redeemState.message}</p>
        )}
        {/* A voucher buys a YEAR OF A PLAN, never a test: tests are paid
            straight to the laboratory, so there is nothing for us to sell in
            advance (public.purchase_care_voucher fails closed). A plan is
            different, because it is the thing we actually provide. */}
        <div className="border-t border-slate-100 pt-4">
          <Button type="button" size="sm" variant="outline" onClick={() => setBuyOpen(!buyOpen)}>
            {buyOpen ? "Cancel" : "Buy a year of care"}
          </Button>

          {buyOpen && (
            <form action={buyAction} className="space-y-3 pt-3">
              <label className="block text-sm">
                <span className="text-slate-700">Which plan?</span>
                <Select name="planId" required className="mt-1">
                  <option value="">Choose a plan</option>
                  {(catalogue ?? []).map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {plan.name} — {naira(plan.price_minor ?? 0)}
                    </option>
                  ))}
                </Select>
              </label>

              {(sponsorable ?? []).length > 0 && (
                <label className="block text-sm">
                  <span className="text-slate-700">Who is it for?</span>
                  <Select name="beneficiaryProfileId" className="mt-1">
                    <option value={patientId}>Me</option>
                    {(sponsorable ?? []).map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.full_name}
                      </option>
                    ))}
                  </Select>
                </label>
              )}

              <label className="block text-sm">
                <span className="text-slate-700">Add a note (optional)</span>
                <Input name="giftMessage" className="mt-1" placeholder="Thinking of you" />
              </label>

              <p className="text-xs text-slate-500">
                Reserving is free. You pay separately, in one go or bit by bit, and it becomes
                usable once it is paid in full. Whoever it is for starts their year when they are
                ready, so nobody is put on a plan without choosing to be. Tests are still paid at
                the laboratory.
              </p>

              <Button type="submit" size="sm" disabled={buyPending}>
                {buyPending ? "Reserving…" : "Reserve this plan"}
              </Button>
              {buyState?.error && <p className="text-xs text-red-600">{buyState.error}</p>}
              {buyState?.message && <p className="text-xs text-emerald-700">{buyState.message}</p>}
            </form>
          )}
        </div>

        {past.length > 0 && (
          <details className="border-t border-slate-100 pt-4">
            <summary className="cursor-pointer text-sm text-slate-600">
              Earlier vouchers ({past.length})
            </summary>
            <ul className="space-y-2 pt-3">
              {past.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-700">
                    {v.sku_name ?? "Care voucher"}{" "}
                    <span className="text-xs text-slate-500">{v.voucher_number}</span>
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[v.status] ?? "bg-slate-100 text-slate-600"}`}
                  >
                    {STATUS_LABEL[v.status] ?? v.status}
                  </span>
                </li>
              ))}
            </ul>
            <p className="pt-2 text-xs text-slate-500">
              If one expired before you could use it, ask us and we will normally put it back.
            </p>
          </details>
        )}

        <div className="border-t border-slate-100 pt-4">
          <p className="text-sm font-medium text-slate-800">Invite someone</p>
          <p className="pt-1 text-xs text-slate-600">
            When someone you invite completes their first paid order, you both get a reward voucher
            toward your care. Reward vouchers are a discount, not cash, and cannot be exchanged for
            money.
          </p>
          {referralCode && (
            <div className="flex items-center gap-2 pt-2">
              <code className="rounded bg-slate-50 px-2 py-1 text-xs text-slate-700">
                {referralCode}
              </code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    `${window.location.origin}/signup?ref=${referralCode}`,
                  );
                  setCopied(true);
                }}
              >
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          )}
          <div className="flex items-end gap-2 pt-3">
            <label className="block flex-1 text-sm">
              <span className="text-slate-700">Have a code?</span>
              <Input
                className="mt-1"
                value={redeemInput}
                onChange={(e) => setRedeemInput(e.target.value)}
                placeholder="Enter a referral code"
              />
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!redeemInput || redeemCode.isPending}
              onClick={() => {
                redeemCode.mutate(redeemInput, { onSuccess: (r) => setRedeemResult(r) });
              }}
            >
              Apply
            </Button>
          </div>
          {redeemResult && (
            <p className={`pt-1 text-xs ${redeemResult.ok ? "text-emerald-700" : "text-red-600"}`}>
              {redeemResult.ok ? "Code applied." : redeemResult.error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function VoucherRow({
  voucher,
  isPaying,
  onTogglePay,
  payAction,
  payPending,
  payError,
  minInstalmentKobo,
}: {
  voucher: CareVoucher;
  isPaying: boolean;
  onTogglePay: () => void;
  payAction: (formData: FormData) => void;
  payPending: boolean;
  payError?: string;
  minInstalmentKobo: number;
}) {
  const outstanding = voucher.face_value_kobo - voucher.amount_paid_kobo;
  const progressPct = Math.min(
    100,
    Math.round((voucher.amount_paid_kobo / voucher.face_value_kobo) * 100),
  );

  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-slate-800">
            {voucher.sku_name ?? "Care voucher"}
          </p>
          <p className="text-xs text-slate-500">
            {voucher.voucher_number} · {naira(voucher.face_value_kobo)}
          </p>
        </div>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[voucher.status] ?? "bg-slate-100 text-slate-600"}`}
        >
          {STATUS_LABEL[voucher.status] ?? voucher.status}
        </span>
      </div>

      {voucher.status === "reserved" && (
        <div className="pt-3">
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="h-full bg-brand-green" style={{ width: `${progressPct}%` }} />
          </div>
          <p className="pt-1 text-xs text-slate-600">
            {naira(voucher.amount_paid_kobo)} of {naira(voucher.face_value_kobo)} paid.{" "}
            {naira(outstanding)} to go. There is no deadline on this, and we will not take it away
            while you are still paying.
          </p>

          <Button type="button" size="sm" variant="outline" className="mt-2" onClick={onTogglePay}>
            {isPaying ? "Cancel" : "Pay toward this"}
          </Button>

          {isPaying && (
            <form action={payAction} className="space-y-2 pt-3">
              <input type="hidden" name="voucherId" value={voucher.id} />
              <div className="flex items-end gap-2">
                <label className="block text-sm">
                  <span className="text-slate-700">Amount (₦)</span>
                  <Input
                    name="amountNaira"
                    type="number"
                    min={Math.min(koboToNaira(minInstalmentKobo), koboToNaira(outstanding))}
                    max={koboToNaira(outstanding)}
                    defaultValue={koboToNaira(outstanding)}
                    className="mt-1"
                    required
                  />
                </label>
                <Button type="submit" size="sm" disabled={payPending}>
                  {payPending ? "Opening checkout…" : "Pay"}
                </Button>
              </div>
              <PaymentMethodPicker className="max-w-xs" />
            </form>
          )}
          {payError && <p className="pt-1 text-xs text-red-600">{payError}</p>}
        </div>
      )}

      {voucher.status === "active" && (
        <p className="pt-2 text-xs text-slate-600">
          Ready to use when you book your {voucher.sku_name ?? "check"}.
          {voucher.expires_at && ` Valid until ${formatDate(voucher.expires_at)}.`}
        </p>
      )}
    </div>
  );
}

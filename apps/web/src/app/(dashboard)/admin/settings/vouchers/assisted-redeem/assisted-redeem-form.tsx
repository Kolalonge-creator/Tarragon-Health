"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { assistedRedeemAction, lookupPendingOrdersAction, type PendingOrder } from "./actions";

function kobo(n: number) {
  return `₦${(n / 100).toLocaleString()}`;
}

/** Coordinator phone-desk flow: look up the voucher + confirm the caller's
 * phone matches the beneficiary on file, pick which of their orders to pay
 * for, then redeem — same three checks redeem_care_voucher_assisted itself
 * enforces server-side, just surfaced as two screens instead of one. */
export function AssistedRedeemForm() {
  const [lookupState, lookupAction, lookupPending] = useActionState(lookupPendingOrdersAction, undefined);
  const [redeemState, redeemAction, redeemPending] = useActionState(assistedRedeemAction, undefined);
  const [voucherNumber, setVoucherNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<PendingOrder | null>(null);

  const orders = lookupState && "orders" in lookupState ? lookupState.orders : null;

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-charcoal-ink">Redeem a voucher by phone</h1>
        <p className="text-sm text-charcoal-ink/70">
          For a beneficiary with no app or web access who has called in — verify their phone against the
          voucher before redeeming anything.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1. Find the voucher</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={lookupAction} className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="voucher_number">Voucher number</Label>
              <Input
                id="voucher_number"
                name="voucher_number"
                placeholder="TAR-VCH-000123"
                value={voucherNumber}
                onChange={(e) => setVoucherNumber(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="beneficiary_phone">Their phone (E.164)</Label>
              <Input
                id="beneficiary_phone"
                name="beneficiary_phone"
                placeholder="+2348012345678"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={lookupPending}>
                {lookupPending ? "Checking…" : "Look up"}
              </Button>
            </div>
          </form>
          {lookupState && "error" in lookupState && (
            <p className="mt-2 text-sm text-red-600">{lookupState.error}</p>
          )}
        </CardContent>
      </Card>

      {orders && (
        <Card>
          <CardHeader>
            <CardTitle>
              2. Redeem for {lookupState && "beneficiaryName" in lookupState ? lookupState.beneficiaryName : "them"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {orders.length === 0 ? (
              <p className="text-sm text-charcoal-ink/70">No orders awaiting payment for this person.</p>
            ) : (
              <form action={redeemAction} className="space-y-3">
                <input type="hidden" name="voucher_number" value={voucherNumber} />
                <input type="hidden" name="beneficiary_phone" value={phone} />
                <input type="hidden" name="order_type" value={selectedOrder?.type ?? ""} />
                <input type="hidden" name="order_id" value={selectedOrder?.id ?? ""} />
                <div className="space-y-1">
                  <Label htmlFor="order">Order to pay for</Label>
                  <Select
                    id="order"
                    defaultValue=""
                    onChange={(e) => setSelectedOrder(orders.find((o) => o.id === e.target.value) ?? null)}
                    required
                  >
                    <option value="" disabled>
                      Choose an order
                    </option>
                    {orders.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.label} — {kobo(o.payable_kobo)}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" disabled={redeemPending || !selectedOrder}>
                  {redeemPending ? "Redeeming…" : "Redeem"}
                </Button>
              </form>
            )}
            {redeemState?.error && <p className="text-sm text-red-600">{redeemState.error}</p>}
            {redeemState?.message && <p className="text-sm text-tarragon-green">{redeemState.message}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

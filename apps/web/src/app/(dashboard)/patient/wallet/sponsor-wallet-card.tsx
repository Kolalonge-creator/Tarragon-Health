"use client";

import { useState, useActionState } from "react";
import { useFamilyPlanMembers } from "@/lib/queries/family-plan-members";
import { useWalletOf } from "@/lib/queries/wallet";
import { topUpWallet } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

/**
 * Sponsor a family member's Health Wallet — the diaspora "money that becomes
 * care" product. Members come from the caller's family plan; authorization
 * is enforced server-side (get_or_create_wallet_for + INSERT RLS). Their
 * balance shows only when the member has granted profile_access consent —
 * otherwise the sponsor sees just their own top-ups.
 */
export function SponsorWalletCard() {
  const { data: members } = useFamilyPlanMembers();
  const [selected, setSelected] = useState<string>("");
  const [amount, setAmount] = useState<number>(5000);
  const [state, formAction, pending] = useActionState(topUpWallet, undefined);
  const { data: memberWallet } = useWalletOf(selected || null);

  if (!members || members.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.family className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Top up a family member
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          Fund a loved one&apos;s wallet from anywhere — the money can only be spent on their
          Tarragon care (checks, labs, refills), and you&apos;ll see your top-up land.
        </p>
        <form action={formAction} className="space-y-3">
          <input type="hidden" name="currency" value="NGN" />
          <div className="flex flex-wrap items-center gap-2">
            <select
              name="targetProfileId"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              aria-label="Family member to top up"
              className="rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
            >
              <option value="">Choose a family member…</option>
              {members.map((m) => (
                <option key={m.id} value={m.member_id}>
                  {m.member?.full_name ?? "Family member"} ({m.relationship})
                </option>
              ))}
            </select>
            <input
              type="number"
              name="amountNaira"
              min={500}
              step={100}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value))}
              aria-label="Top-up amount in naira"
              className="w-28 rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
            />
            <Button type="submit" size="sm" disabled={!selected || pending || amount < 500}>
              {pending ? "Redirecting…" : `Send ₦${amount.toLocaleString()}`}
            </Button>
          </div>
          {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
        </form>
        {selected && memberWallet && (
          <p className="text-xs text-charcoal-ink/60">
            Their current balance: ₦{koboToNaira(memberWallet.balance_kobo).toLocaleString()}{" "}
            (visible because they&apos;ve shared access with you).
          </p>
        )}
      </CardContent>
    </Card>
  );
}

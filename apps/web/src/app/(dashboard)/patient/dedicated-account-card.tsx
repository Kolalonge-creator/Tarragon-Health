import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RequestDedicatedAccountButton } from "./request-dedicated-account-button";

/**
 * "Transfer ₦24,500 to Tarragon Health, account 90xxxxxxx" — revenue-
 * architecture spec §4.1: dedicated virtual accounts are "the single most
 * under-appreciated build item" and, once a patient has one, apply to
 * whatever they currently owe automatically (see the reconciliation trigger
 * in 20260829201734_paystack_dedicated_virtual_accounts.sql) — no reference
 * to copy, no checkout flow, just a bank transfer from an app they already
 * have open.
 */
export async function DedicatedAccountCard({ profileId }: { profileId: string }) {
  const supabase = await createClient();
  const { data: account } = await supabase
    .from("patient_dedicated_accounts")
    .select("account_number, bank_name")
    .eq("profile_id", profileId)
    .maybeSingle();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Pay by bank transfer</CardTitle>
      </CardHeader>
      <CardContent>
        {account ? (
          <div>
            <p className="text-sm text-charcoal-ink/70">
              Transfer to this account any time — it automatically pays off whatever you currently owe.
            </p>
            <p className="mt-2 text-lg font-semibold text-charcoal-ink">{account.account_number}</p>
            <p className="text-sm text-charcoal-ink/70">{account.bank_name} · Tarragon Health</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-sm text-charcoal-ink/70">
              Get your own Tarragon transfer number — send money from your bank app whenever it suits you,
              no card needed.
            </p>
            <RequestDedicatedAccountButton />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { partnerStatementAccessNotice } from "@/lib/finance/partner-statement-access";
import { anyQueryFailed } from "@/lib/queries/server-query-state";
import { PartnerSettlementsClient } from "./partner-settlements-client";

/**
 * §91.11 provider settlement statements — Synlab, and any future partner
 * laboratory. The reconciliation engine itself (partner_statements/
 * partner_statement_lines, match_partner_statement, approve_partner_statement)
 * already existed live, fully built, from
 * 20260821192256_partner_billing_reconcile_settle_refund.sql — this page is
 * the only piece that was actually missing: nothing in the app called any of
 * it. See actions.ts for the fuller note on that discovery.
 *
 * As of this writing there is exactly one real Synlab order in the whole
 * platform, and it has never reached payment_confirmed — so this page will
 * show nothing to reconcile until a real partner-billed order completes.
 * That is expected, not a bug.
 *
 * The empty state is nonetheless not trustworthy on its own, for a reason
 * that has nothing to do with there being no data: partner_statements' RLS
 * runs on private.is_org_staff, which excludes the `finance` role, and an RLS
 * SELECT filters rather than raising. A finance officer therefore gets
 * `{ data: [], error: null }` every time and used to be told "No laboratory
 * statements recorded yet." See lib/finance/partner-statement-access.ts.
 */
export default async function PartnerSettlementsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();

  const [providersResult, statementsResult] = await Promise.all([
    supabase.from("lab_providers").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("partner_statements")
      .select(
        "id, reference, period_start, period_end, invoiced_total_kobo, expected_total_kobo, status, currency, lab_providers(name)",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const providers = providersResult.data ?? [];
  const statements = (statementsResult.data ?? []).map((s) => ({
    id: s.id,
    reference: s.reference,
    period_start: s.period_start,
    period_end: s.period_end,
    invoiced_total_kobo: s.invoiced_total_kobo,
    expected_total_kobo: s.expected_total_kobo,
    status: s.status,
    currency: s.currency,
    provider_name: s.lab_providers?.name ?? null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Laboratory settlements
        </h1>
        <p className="text-charcoal-ink/60">
          What a partner laboratory has invoiced, reconciled against our own orders, and what we
          actually agree to pay them.
        </p>
      </div>
      <PartnerSettlementsClient
        providers={providers}
        statements={statements}
        loadFailed={anyQueryFailed([providersResult, statementsResult])}
        accessNotice={partnerStatementAccessNotice(profile?.role)}
      />
    </div>
  );
}

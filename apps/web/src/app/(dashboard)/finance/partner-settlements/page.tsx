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
 *
 * The laboratory picker and each statement's provider name read from
 * public.lab_provider_directory, not public.lab_providers directly, and the
 * `lab_providers(name)` embed on partner_statements was replaced with a
 * follow-up query against that same view. Since 2026-09-25
 * (20260925023144_restrict_lab_pharmacy_partner_read_to_safe_columns.sql)
 * lab_providers_select no longer admits a plain `finance`/`authenticated`
 * session (admin or partners.labs.manage only) — a direct read or embed here
 * would silently come back empty/null for the same reason the paragraph
 * above already flagged for partner_statements itself.
 *
 * The picker (line below, `providers`) filters `is_active` explicitly — the
 * directory view itself carries every provider regardless of status (see
 * 20260925024716_fix_lab_pharmacy_directory_active_filter_and_replay_guard.sql),
 * because a HISTORICAL statement's provider name must keep resolving after
 * that provider goes inactive; only the "which lab can I record a NEW
 * invoice for" picker should ever narrow to active-only.
 */
export default async function PartnerSettlementsPage() {
  const supabase = await createClient();
  const profile = await getCurrentProfile();

  const [providersResult, statementsResult] = await Promise.all([
    supabase.from("lab_provider_directory").select("id, name").eq("is_active", true).order("name"),
    supabase
      .from("partner_statements")
      .select(
        "id, provider_id, reference, period_start, period_end, invoiced_total_kobo, expected_total_kobo, status, currency",
      )
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const providers = (providersResult.data ?? []).filter(
    (p): p is { id: string; name: string } => !!p.id && !!p.name,
  );
  const statementRows = statementsResult.data ?? [];
  const providerIds = Array.from(new Set(statementRows.map((s) => s.provider_id).filter((id): id is string => !!id)));
  const statementProvidersResult = providerIds.length
    ? await supabase.from("lab_provider_directory").select("id, name").in("id", providerIds)
    : { data: [] as { id: string; name: string | null }[], error: null };
  const providerNameById = new Map((statementProvidersResult.data ?? []).map((p) => [p.id, p.name]));

  const statements = statementRows.map((s) => ({
    id: s.id,
    reference: s.reference,
    period_start: s.period_start,
    period_end: s.period_end,
    invoiced_total_kobo: s.invoiced_total_kobo,
    expected_total_kobo: s.expected_total_kobo,
    status: s.status,
    currency: s.currency,
    provider_name: providerNameById.get(s.provider_id) ?? null,
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
        loadFailed={anyQueryFailed([providersResult, statementsResult, statementProvidersResult])}
        accessNotice={partnerStatementAccessNotice(profile?.role)}
      />
    </div>
  );
}

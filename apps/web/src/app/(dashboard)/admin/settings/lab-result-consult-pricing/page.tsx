import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LabResultConsultPricingManager, type PriceRow } from "./lab-result-consult-pricing-manager";

/**
 * Admin control for the self-arranged lab-result consultation fee (founder
 * rule, 2026-08-30 — see docs/CLAUDE_SPRINT_HISTORY_ARCHIVE.md). Precedent
 * check first: no admin UI exists for video_visit_prices either (the table
 * this one was cloned from) — a plain SQL UPDATE was the only way to change
 * that price. The closest REAL admin price-editor precedent is
 * /admin/settings/diaspora-pricing (a derived-currency-rate editor, too
 * specific to reuse directly) — this page borrows its RBAC gate shape
 * instead: proxy.ts already blocks non-admins from /admin/**, this is
 * defence in depth, same as every other admin/settings page.
 */
export default async function LabResultConsultPricingPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");

  const supabase = await createClient();

  const [{ data: prices }, { data: organisations }] = await Promise.all([
    supabase
      .from("lab_result_consult_prices")
      .select("id, organisation_id, amount_minor, currency, is_enabled, updated_at, updated_by")
      .order("organisation_id", { ascending: true, nullsFirst: true }),
    supabase.from("organisations").select("id, name").order("name"),
  ]);

  const orgNameById = new Map((organisations ?? []).map((o) => [o.id, o.name]));
  const rows: PriceRow[] = (prices ?? []).map((p) => ({
    id: p.id,
    organisationId: p.organisation_id,
    organisationName: p.organisation_id ? orgNameById.get(p.organisation_id) ?? "Unknown org" : null,
    amountMinor: p.amount_minor,
    currency: p.currency,
    isEnabled: p.is_enabled,
    updatedAt: p.updated_at,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Lab-result consultation fee"
        description="The one-off fee a patient pays to unlock uploading a self-arranged lab result, which also books a 15-minute doctor walkthrough. One platform-default price, with optional per-organisation overrides."
      />
      <LabResultConsultPricingManager
        rows={rows}
        organisations={(organisations ?? []).map((o) => ({ id: o.id, name: o.name }))}
      />
    </div>
  );
}

import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { loose } from "@/lib/clinician/loose-client";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ActionForm } from "@/components/partner-portal/action-form";
import { recordComplaintAction, reinstatePartnerAction, resolveComplaintAction, suspendPartnerAction, verifySourcingAction } from "@/lib/partner-network/actions";
import { COMPLAINT_CATEGORIES, COMPLAINT_LABEL, LICENCE_LABEL, PARTNER_KIND_LABEL, breachLabel, overviewSchema } from "@/lib/partner-network/model";

export const metadata = { title: "Partner quality" };
export const dynamic = "force-dynamic";

const complaintsSchema = z.array(z.object({ id: z.string().uuid(), partner_kind: z.string(), partner_id: z.string().uuid(), category: z.string(), note: z.string().nullable(), state: z.string(), created_at: z.string() }));
const sourcingSchema = z.array(z.object({ partner_id: z.string().uuid(), partner_name: z.string(), is_active: z.boolean(), statement: z.string().nullable(), declared_at: z.string().nullable(), verified_at: z.string().nullable(), review_due_at: z.string().nullable(), is_verified: z.boolean().nullable() }));

/**
 * Partner quality (S74, 21.7). A nightly rule scores every active laboratory, pharmacy and clinic and takes a partner out of NEW work when it breaches
 * the rules the CMO owns. An admin or the CMO can pause or reinstate with a written reason; an expired licence cannot be reinstated until it is renewed.
 */
export default async function AdminPartnerQualityPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const supabase = loose(await createClient());
  const [ov, cm, so] = await Promise.all([
    supabase.rpc("partner_quality_overview"),
    supabase.from("partner_complaints").select("id, partner_kind, partner_id, category, note, state, created_at").eq("state", "open").order("created_at", { ascending: true }),
    supabase.rpc("admin_pharmacy_sourcing"),
  ]);
  const overview = ov.error ? null : overviewSchema.safeParse(ov.data);
  const complaints = cm.error ? null : complaintsSchema.safeParse(cm.data);
  const sourcing = so.error ? null : sourcingSchema.safeParse(so.data);
  const nameOf = (kind: string, id: string) => (overview?.success ? overview.data.find((r) => r.partner_kind === kind && r.partner_id === id)?.partner_name : null) ?? "A partner";

  return (
    <div className="space-y-6">
      <PageHeader title="Partner quality" description="How each laboratory, pharmacy and clinic is doing, and which are paused from new work. Work already in progress is never taken away." />
      <Card>
        <CardHeader><CardTitle>Partners</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {!overview?.success && <p role="alert" className="text-sm text-red-600">The partners could not be loaded. This is not the same as there being none.</p>}
          {overview?.success && overview.data.length === 0 && <p className="text-sm text-charcoal-ink/60">No partners yet.</p>}
          {overview?.success && overview.data.map((r) => (
            <div key={`${r.partner_kind}-${r.partner_id}`} className="space-y-2 border-b border-charcoal-ink/10 pb-4 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{r.partner_name ?? "Unnamed"} <span className="text-charcoal-ink/60">({PARTNER_KIND_LABEL[r.partner_kind]}{r.is_active ? "" : ", not active"})</span></span>
                <span className="flex items-center gap-2">
                  {r.score !== null && <span className="font-semibold">{r.score.toFixed(1)}</span>}
                  <Badge variant={r.work_state === "suspended" ? "red" : "green"}>{r.work_state === "suspended" ? "Paused" : "Open"}</Badge>
                </span>
              </div>
              <p className="text-xs text-charcoal-ink/60">
                Licence: {LICENCE_LABEL[r.licence_state ?? ""] ?? "Not worked out yet"}. Complaints upheld: {r.complaints_upheld ?? 0}, open: {r.complaints_open ?? 0}.
                {r.pct_within_target !== null ? ` On time: ${r.pct_within_target}% of ${r.orders_measured}.` : ""}
                {r.breaches.length > 0 ? ` Needs attention: ${r.breaches.map(breachLabel).join(", ")}.` : ""}
              </p>
              {r.work_state === "suspended" ? (
                <details><summary className="cursor-pointer text-brand-green">Reinstate for new work</summary>
                  <div className="mt-2"><ActionForm action={reinstatePartnerAction} hidden={{ kind: r.partner_kind, partner: r.partner_id }} fields={[{ name: "reason", label: "Why (at least 20 characters)", kind: "textarea" }]} submitLabel="Reinstate" variant="outline" successText="Reinstated. The rule will not pause them again for the review period." /></div>
                </details>
              ) : (
                <details><summary className="cursor-pointer text-charcoal-ink/70">Pause from new work</summary>
                  <div className="mt-2"><ActionForm action={suspendPartnerAction} hidden={{ kind: r.partner_kind, partner: r.partner_id }} fields={[{ name: "reason", label: "Why (at least 20 characters)", kind: "textarea" }]} submitLabel="Pause" variant="outline" successText="Paused." /></div>
                </details>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Open complaints</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          {!complaints?.success && <p role="alert" className="text-red-600">Complaints could not be loaded.</p>}
          {complaints?.success && complaints.data.length === 0 && <p className="text-charcoal-ink/60">No open complaints.</p>}
          {complaints?.success && complaints.data.map((c) => (
            <div key={c.id} className="space-y-2 border-b border-charcoal-ink/10 pb-3">
              <p><span className="font-medium">{nameOf(c.partner_kind, c.partner_id)}</span>: {COMPLAINT_LABEL[c.category as keyof typeof COMPLAINT_LABEL] ?? c.category}{c.note ? `. ${c.note}` : ""}</p>
              <ActionForm action={resolveComplaintAction} hidden={{ id: c.id }} compact fields={[
                { name: "outcome", label: "Outcome", kind: "select", options: [{ value: "upheld", label: "Upheld" }, { value: "dismissed", label: "Not upheld" }] },
                { name: "note", label: "Why", placeholder: "At least 10 characters" },
              ]} submitLabel="Resolve" variant="outline" />
            </div>
          ))}
          {overview?.success && (
            <details><summary className="cursor-pointer text-brand-green">Record a complaint</summary>
              <div className="mt-2 max-w-md">
                <p className="mb-2 text-xs text-charcoal-ink/60">Never write a patient's name or a result here. Use the category and a short note about the partner.</p>
                <ActionForm action={recordComplaintAction} fields={[
                  { name: "kind", label: "Kind of partner", kind: "select", options: [{ value: "lab", label: "Laboratory" }, { value: "pharmacy", label: "Pharmacy" }, { value: "clinic", label: "Clinic" }] },
                  { name: "partner", label: "Partner", kind: "select", options: overview.data.map((r) => ({ value: r.partner_id, label: `${r.partner_name ?? "Unnamed"} (${PARTNER_KIND_LABEL[r.partner_kind]})` })) },
                  { name: "category", label: "What kind of complaint", kind: "select", options: COMPLAINT_CATEGORIES.map((c) => ({ value: c, label: COMPLAINT_LABEL[c] })) },
                  { name: "note", label: "Short note (optional)", required: false },
                ]} submitLabel="Record" successText="Recorded." />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Pharmacy sourcing checks</CardTitle></CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-charcoal-ink/70">A pharmacy declares which NAFDAC-registered suppliers it buys from. You check the declaration against its invoices and the NAFDAC register, then record what you checked. It is a check of sources, not of any one batch.</p>
          {!sourcing?.success && <p role="alert" className="text-red-600">The sourcing list could not be loaded.</p>}
          {sourcing?.success && sourcing.data.map((p) => (
            <div key={p.partner_id} className="space-y-2 border-b border-charcoal-ink/10 pb-3">
              <p className="flex items-center gap-2"><span className="font-medium">{p.partner_name}</span><Badge variant={p.is_verified ? "green" : p.declared_at ? "amber" : "grey"}>{p.is_verified ? "Checked" : p.declared_at ? "Waiting for a check" : "Not declared"}</Badge></p>
              {p.statement && <p className="text-charcoal-ink/80">{p.statement}</p>}
              {p.declared_at && !p.is_verified && (
                <ActionForm action={verifySourcingAction} hidden={{ partner: p.partner_id }} fields={[{ name: "note", label: "What you checked (at least 20 characters)", kind: "textarea" }]} submitLabel="Record the check" variant="outline" successText="Recorded." />
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

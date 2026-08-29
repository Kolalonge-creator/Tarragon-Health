import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DeactivatePolicyButton,
  RetentionPolicyForm,
  type DocumentRetentionPolicyRow,
} from "./retention-policy-form";
import { DOCUMENT_TYPE_LABELS } from "@/lib/validation/document-retention-policies";

/**
 * Admin configuration for how long each document type is retained
 * (public.document_retention_policies) — read-only for any org-staff
 * account, write-gated to admin by RLS (private.is_admin()). At most one
 * policy row per (organisation_id, document_type); this page never deletes
 * a policy, only deactivates it, matching the platform's archive-don't-
 * delete ethos.
 */
export default async function DocumentRetentionSettingsPage() {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") {
    redirect("/admin");
  }

  const supabase = await createClient();
  const { data: policies } = await supabase
    .from("document_retention_policies")
    .select("id, document_type, retention_years, basis, active, updated_at")
    .eq("organisation_id", profile.organisation_id ?? "")
    .order("document_type", { ascending: true });

  const policyRows = (policies as DocumentRetentionPolicyRow[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Document retention
        </h1>
        <p className="text-charcoal-ink/60">
          How long each type of patient document is kept before it can be archived, and why. Any
          clinician can see this configuration; only an admin can change it. Deactivating a policy
          never deletes it — the record stays on file.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {policyRows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">
              No retention policies set for this organisation yet.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border border-mist-grey/40">
              <table className="w-full text-sm">
                <thead className="bg-mist-grey/40 text-left text-charcoal-ink/70">
                  <tr>
                    <th className="p-2">Document type</th>
                    <th className="p-2">Retention</th>
                    <th className="p-2">Basis</th>
                    <th className="p-2">Status</th>
                    <th className="p-2">Last updated</th>
                    <th className="p-2" />
                  </tr>
                </thead>
                <tbody>
                  {policyRows.map((policy) => (
                    <tr key={policy.id} className="border-t border-mist-grey/30 align-top">
                      <td className="p-2 font-medium">
                        {DOCUMENT_TYPE_LABELS[policy.document_type] ?? policy.document_type}
                      </td>
                      <td className="p-2">
                        {policy.retention_years} year{policy.retention_years === 1 ? "" : "s"}
                      </td>
                      <td className="p-2 max-w-sm text-charcoal-ink/70">{policy.basis}</td>
                      <td className="p-2">
                        <Badge variant={policy.active ? "green" : "grey"}>
                          {policy.active ? "Active" : "Inactive"}
                        </Badge>
                      </td>
                      <td className="p-2 text-xs text-charcoal-ink/50">
                        {new Date(policy.updated_at).toLocaleString("en-GB")}
                      </td>
                      <td className="p-2">
                        {policy.active && <DeactivatePolicyButton policyId={policy.id} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <RetentionPolicyForm policies={policyRows} />
    </div>
  );
}

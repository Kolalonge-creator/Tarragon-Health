import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasAnyPermission } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { CreateEmployerForm } from "./create-employer-form";

const VERIFICATION_BADGE: Record<string, { variant: "green" | "grey" | "amber" | "red"; label: string }> = {
  unverified: { variant: "grey", label: "Unverified" },
  pending: { variant: "amber", label: "Pending review" },
  verified: { variant: "green", label: "Verified" },
  rejected: { variant: "red", label: "Rejected" },
};

/**
 * Module 26 §26.3 — the Tarragon-side half of employer onboarding
 * (registration -> verification -> contract -> billing -> go live). Mirrors
 * the shape of /admin/settings/members' institution-org creation, but as its
 * own console since the employer platform now has enough surface (roster,
 * benefits, campaigns, billing) to deserve one.
 */
export default async function AdminEmployersPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");

  const allowed = await hasAnyPermission("orgs.manage", "orgs.corporate.manage");
  if (!allowed) redirect("/admin");

  const svc = createServiceRoleClient();
  const { data: orgs } = await svc
    .from("organisations")
    .select("id, name, is_active, employer_accounts(verification_status, onboarding_step, went_live_at)")
    .eq("type", "corporate")
    .order("name");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employers"
        description="Module 26: register, verify, contract and go live for each employer account."
      />

      <CreateEmployerForm />

      <Card>
        <CardHeader>
          <CardTitle>All employers</CardTitle>
          <CardDescription>{(orgs ?? []).length} registered.</CardDescription>
        </CardHeader>
        <CardContent>
          {(orgs ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No employers registered yet.</p>
          ) : (
            <ul className="divide-y divide-charcoal-ink/10">
              {(orgs ?? []).map((org) => {
                const account = org.employer_accounts;
                const meta = VERIFICATION_BADGE[account?.verification_status ?? "unverified"];
                return (
                  <li key={org.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/admin/employers/${org.id}`} className="text-sm text-clinical-navy hover:underline">
                      {org.name}
                    </Link>
                    <div className="flex items-center gap-2">
                      <Badge variant={meta.variant}>{meta.label}</Badge>
                      <Badge variant={account?.went_live_at ? "green" : "grey"}>
                        {account?.went_live_at ? "Live" : (account?.onboarding_step ?? "registration")}
                      </Badge>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { ProtocolApiManager } from "./protocol-api-manager";

/**
 * Admin surface for the Protocol API licensing play (founder ask,
 * 2026-07-31): license the escalation/risk/protocol machinery to smaller
 * clinics, state PHCs, or NGOs -- WITHOUT them becoming a Tarragon
 * patient-serving tenant. Every read/write here goes through the
 * admin_* RPCs in protocol_api_usage_log's migration (20260802205424),
 * not direct table access -- a licensee org typically has no Tarragon
 * login of its own, so Tarragon's admin acts on its behalf across the
 * org boundary the way admin_link_lab_partner already established.
 */
export default async function ProtocolApiSettingsPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (!(await hasPermission("integrations.manage"))) redirect("/admin");

  const supabase = await createClient();
  const { data: partners, error: partnersError } = await supabase.rpc("admin_list_protocol_partners");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Protocol API"
        description={
          <>
            License Tarragon&apos;s validated, stateless classifiers (BP triage, FINDRISC diabetes
            screening, cardiovascular-risk stratification) to a partner clinic, state PHC, or NGO --
            without giving them a patient-serving tenant on this platform. Every call is stateless:
            no patient record is created or touched, only the call itself is logged. See{" "}
            <code className="rounded bg-mist-grey/60 px-1 py-0.5 text-xs">
              docs/INTEGRATIONS_API.md
            </code>{" "}
            for the partner-facing spec.
          </>
        }
      />
      {partnersError ? (
        <LoadFailure>
          The protocol API partners could not be loaded. This is not a report that none are
          licensed, and no issued key is visible here. Reload before adding a partner that may
          already exist.
        </LoadFailure>
      ) : (
        <ProtocolApiManager partners={partners ?? []} />
      )}
    </div>
  );
}

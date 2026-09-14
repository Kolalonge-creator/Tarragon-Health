"use server";

import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createServiceRoleClient } from "@/lib/supabase/service-role";

/**
 * Audit entry for a CSV export of the full patient roster — the export
 * itself happens client-side (already-fetched rows, no further PII leaves
 * the server), so this is purely a "who exported this, and how many rows"
 * record. Re-checks super-admin server-side rather than trusting the caller;
 * a non-admin's click here writes nothing and the browser download still
 * only ever contained whatever that caller's own page load returned.
 */
export async function logPatientDirectoryExport(rowCount: number): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile || profile.role !== "admin") return;

  const svc = createServiceRoleClient();
  await svc.from("audit_log").insert({
    actor_id: profile.id,
    organisation_id: profile.organisation_id,
    action: "admin.patient_directory_exported",
    entity_type: "patient_directory",
    entity_id: null,
    event: { patient_count: rowCount },
  });
}

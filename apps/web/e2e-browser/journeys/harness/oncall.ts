// S85 journey harness: an on-call team for a test organisation.
//
// Mirrors the fixture the S19 DB proof builds (packages/db/tests/s19_red_event_paging.sql): a chief medical officer, a primary
// and a backup on-call clinician, each credentialed and ready, and a rota covering now. The users are created with real
// passwords so the journey can sign in as the paged clinician. All rows are is_test.
//
// The rota is written by calling the public RPC under a simulated chief medical officer session (the RPC refuses anyone else),
// which is the same route a real rota edit takes.

import { createUser, type TestUser } from "./sessions";
import { sql, lit } from "./sql";

export interface OnCallTeam {
  readonly admin: TestUser;
  readonly cmo: TestUser;
  readonly primary: TestUser;
  readonly backup: TestUser;
}

function staffInsert(orgId: string, adminId: string, userId: string, label: string, tier: "chief_medical_officer" | "senior_medical_officer"): string {
  const cmo = tier === "chief_medical_officer";
  return `
    with s as (
      insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
          license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
      values (${lit(orgId)}, ${lit(userId)}, ${lit(`S85 ${label}`)}, 'MDCN', ${lit(`S85-${label}-${userId.slice(0, 8)}`)}, true, 'active',
          now(), ${lit(adminId)}, '${tier}'::public.doctor_tier, '${cmo ? "contracted" : "employed"}'::public.staff_employment_type, 2,
          ${cmo}, ${cmo ? lit(adminId) : "null"}, true)
      returning id)
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test)
      select ${lit(orgId)}, id, 'on_call', ${lit(adminId)}, true from s;
    insert into public.on_call_readiness (clinician_id, checklist_version, organisation_id, items, is_test)
      values (${lit(userId)}, private.readiness_version(), ${lit(orgId)}, private.readiness_items(), true);
  `;
}

export async function seedOnCallTeam(runId: string, orgId: string): Promise<OnCallTeam> {
  const admin = await createUser(runId, "ops-admin", { role: "admin", organisationId: orgId });
  const cmo = await createUser(runId, "cmo", { role: "clinician", organisationId: orgId });
  const primary = await createUser(runId, "oncall-primary", { role: "clinician", organisationId: orgId });
  const backup = await createUser(runId, "oncall-backup", { role: "clinician", organisationId: orgId });
  sql(`
    begin;
    ${staffInsert(orgId, admin.id, cmo.id, "cmo", "chief_medical_officer")}
    ${staffInsert(orgId, admin.id, primary.id, "primary", "senior_medical_officer")}
    ${staffInsert(orgId, admin.id, backup.id, "backup", "senior_medical_officer")}
    select set_config('request.jwt.claims', json_build_object('sub', ${lit(cmo.id)}, 'role', 'authenticated')::text, true);
    select set_config('request.jwt.claim.role', 'authenticated', true);
    set local role authenticated;
    select public.set_on_call_rota(now() - interval '1 minute', now() + interval '10 hours', ${lit(primary.id)}, ${lit(backup.id)}, null);
    reset role;
    commit;
  `);
  return { admin, cmo, primary, backup };
}

-- ===== consent_records =====
alter table consent_records enable row level security;
create policy consent_records_select on consent_records for select using (
  private.is_own_or_dependant(patient_id)
  or private.can_see_patient(patient_id)
  or granted_to_profile_id = auth.uid()
  or private.actor_role() in ('ops_admin','superadmin')
);
create policy consent_records_insert on consent_records for insert with check (
  private.is_own_or_dependant(patient_id)
  or private.actor_role() in ('clinician','coordinator','ops_admin','superadmin')
);
create policy consent_records_revoke on consent_records for update using (
  private.is_own_or_dependant(patient_id) or private.actor_role() = 'superadmin'
);

-- ===== proof_log ===== (patient-facing; write path is triggers only, per I10 -- no insert policy
-- for any role, so direct client inserts are always denied regardless of role)
alter table proof_log enable row level security;
create policy proof_log_own on proof_log for select using (
  private.is_own_or_dependant(patient_id)
);
create policy proof_log_staff on proof_log for select using (
  private.can_see_patient(patient_id)
);
-- I4 exact worked example from spec §6.2: consent-at-query-time, no cache to invalidate.
create policy funder_reads_summary on proof_log
for select using (
  exists (
    select 1 from consent_records c
    where c.patient_id = proof_log.patient_id
      and c.scope = 'funder_summary'
      and c.granted_to_profile_id = auth.uid()
      and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > now())
  )
);


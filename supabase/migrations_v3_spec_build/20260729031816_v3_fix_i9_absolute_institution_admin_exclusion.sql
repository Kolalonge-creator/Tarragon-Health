-- I9 is absolute ("Zero rows on every patient-scoped table... no exceptions" -- its own
-- invariant, not just a role-default). A consent grant (I4/§6.2) must never be able to route
-- around it -- an institution_admin account must never see individual proof_log/consent_records
-- rows even if a patient's consent_records row happens to name that profile as grantee. Defence
-- in depth for exactly the product promise §13 makes ("Tarragon does not share individual health
-- records with your employer").
drop policy funder_reads_summary on proof_log;
create policy funder_reads_summary on proof_log
for select using (
  private.actor_role() <> 'institution_admin'
  and exists (
    select 1 from consent_records c
    where c.patient_id = proof_log.patient_id
      and c.scope = 'funder_summary'
      and c.granted_to_profile_id = auth.uid()
      and c.revoked_at is null
      and (c.expires_at is null or c.expires_at > now())
  )
);

drop policy consent_records_select on consent_records;
create policy consent_records_select on consent_records for select using (
  private.actor_role() <> 'institution_admin' and (
    private.is_own_or_dependant(patient_id)
    or private.can_see_patient(patient_id)
    or granted_to_profile_id = auth.uid()
    or private.actor_role() = 'ops_admin'
  )
);

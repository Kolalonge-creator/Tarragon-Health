-- Results and escalations join the consented read set, and the two tables that
-- were quietly bypassing the consent are brought under it.
--
-- Founder decision, 2026-07-31, on the two surfaces deliberately held back by
-- 20260731181143: "they should be able to see it but with consent accepted by
-- the patient." So the answer is the same switch, not a second one.
--
-- The rule this settles on, worth stating once: a consented supporter's read
-- set is a SUBSET of what the patient can already see of themselves. Every
-- table below was already `patient_id = auth.uid() or is_org_staff(...)`, so
-- nothing here shows a supporter anything the patient could not open on their
-- own dashboard today. It is not a clinician view.
--
-- Two real holes found while doing this, both closed here:
--
--   lab_analyte_readings (20260720120002, for the lipid module's family view)
--   patient_timeline     (20260730114201, the proof_log funder-read gap)
--
-- both already admitted ANY profile_access grantee with no consent at all.
-- Left alone they would have made the switch a fiction: a patient could answer
-- "No, they cannot" and their next of kin would still read their lipid panel
-- and a full chronological record of every abnormal result, medication change
-- and escalation. Both are re-pointed at the same predicate. This is a
-- tightening, and it costs a live feature nothing today — profile_access has 0
-- rows, so there is no grantee anywhere to lose access.
--
-- private.can_read_clinical also gains the one case that cannot consent for
-- itself: a child provisioned with no login of their own
-- (addChildDependentAction sets profiles.is_dependent_account). Their guardian
-- holds 'manage' precisely because the child cannot answer a yes/no prompt, so
-- for that account the manage grant IS the consent. Without this branch,
-- tightening lab_analyte_readings and patient_timeline would have silently
-- broken a parent's view of their own child's record.
create or replace function private.can_read_clinical(p_patient uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1
    from public.profile_access pa
    join public.profiles p on p.id = pa.profile_id
    where pa.profile_id = p_patient
      and pa.grantee_user_id = (select auth.uid())
      and (
        pa.clinical_access
        -- A child with no login cannot be asked. Their guardian's 'manage'
        -- grant stands in for the consent, and only for that shape of account.
        or (pa.permission_level = 'manage' and p.is_dependent_account)
      )
  );
$$;

-- The two surfaces the founder asked for.
drop policy if exists screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists escalations_select on public.escalations;
create policy escalations_select on public.escalations
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- clinician_alerts carries the severity and the title an escalation hangs off,
-- so "escalation reasoning" is incoherent without it — an escalation on its own
-- reads as a row with no subject.
drop policy if exists clinician_alerts_select on public.clinician_alerts;
create policy clinician_alerts_select on public.clinician_alerts
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

-- And the two that were bypassing the switch.
drop policy if exists lab_analyte_readings_select on public.lab_analyte_readings;
create policy lab_analyte_readings_select on public.lab_analyte_readings
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

drop policy if exists patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id)
  );

do $$
declare
  v_read  int;
  v_write int;
  v_loose int;
begin
  select count(*) into v_read
  from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and tablename in ('vitals_readings', 'care_plans', 'medications',
                      'screening_schedules', 'lab_orders', 'patient_risk_scores',
                      'screening_results', 'escalations', 'clinician_alerts',
                      'lab_analyte_readings', 'patient_timeline')
    and qual like '%can_read_clinical%';
  if v_read <> 11 then
    raise exception 'expected 11 consent-gated read policies, found %', v_read;
  end if;

  -- Still never a write path to the RECORD.
  --
  -- The first version of this check (20260731181143) allowed no write policy at
  -- all, and this migration is where it correctly failed: care_messages and
  -- care_message_threads gained consent-gated INSERT policies in
  -- 20260731181318 so a supporter can ask a question. Posting a message is not
  -- editing a record — the thread is append-only, the patient is notified of
  -- every message, and the supporter still cannot close a conversation. Those
  -- two tables are named here explicitly so the check stays exact rather than
  -- being relaxed into uselessness: any OTHER write policy picking this
  -- predicate up is still a failure.
  select count(*) into v_write
  from pg_policies
  where schemaname = 'public'
    and cmd <> 'SELECT'
    and tablename not in ('care_messages', 'care_message_threads')
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%can_read_clinical%';
  if v_write > 0 then
    raise exception 'can_read_clinical must never gate a write policy on a record table, found %', v_write;
  end if;

  -- ...and the conversation write it IS allowed to gate must stay INSERT-only,
  -- so a supporter can add to a thread and never close or alter one.
  select count(*) into v_write
  from pg_policies
  where schemaname = 'public'
    and cmd in ('UPDATE', 'DELETE', 'ALL')
    and tablename in ('care_messages', 'care_message_threads')
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%can_read_clinical%';
  if v_write > 0 then
    raise exception 'a supporter must not be able to change or close a conversation, found % policy(ies)', v_write;
  end if;

  -- No clinical table may still admit a bare profile_access grantee: that is
  -- exactly the hole this migration exists to close, and the check that will
  -- catch the next person reopening it.
  select count(*) into v_loose
  from pg_policies
  where schemaname = 'public'
    and cmd = 'SELECT'
    and tablename in ('lab_analyte_readings', 'patient_timeline')
    and qual like '%profile_access%'
    and qual not like '%can_read_clinical%';
  if v_loose > 0 then
    raise exception '% policy(ies) still admit a grantee with no consent', v_loose;
  end if;
end $$;

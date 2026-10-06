-- S21 (part 7): two founder decisions on 2026-10-06.
--
-- OQ-161, scribe consent: the PATIENT'S in-app answer is the only consent (INV-11). S23's public.scribe_consents stays as the audit and
-- retention record, but a clinician can no longer create a granted row from nothing:
--   1. a granted row is accepted only while the patient has allowed the AI note-taker for a live consultation with that clinician
--      (public.scribe_may_start), and is tied to that encounter (new column encounter_id, stamped by the trigger, never by the client);
--   2. when the patient withdraws in the app, every consent row for that encounter is revoked and its captured transcript is deleted
--      in the same transaction (S23's own cleanup did this from the clinician's screen; it now cannot depend on the clinician).
-- A recorded decline (granted = false) needs no precondition. Row counts at writing: scribe_consents 0, scribe_transcripts 0,
-- consultation_scribe_consents 0, so nothing is converted.
--
-- OQ-159, chart access after Finish: a clinician who finished a consultation can still open that patient's chart until a signed note
-- exists for it, for at most chartAccessAfterFinishMaxHours (72, PROPOSED, consultation policy v2). One clause on
-- private.clinician_has_patient_access; the body below is the live definition read on 2026-10-06 (after S16 and S19) plus that clause.

-- ---------------------------------------------------------------------------
-- 1. Policy v2 (versioned, PROPOSED): v1 plus the cap
-- ---------------------------------------------------------------------------
-- policy-v2-additions-begin
update public.consultation_policy_config set is_active = false where version = 1 and is_active;
insert into public.consultation_policy_config (version, is_active, config, note)
select 2, true, config || $json${"chartAccessAfterFinishMaxHours":72}$json$::jsonb,
       'S21 PROPOSED v2: v1 plus chartAccessAfterFinishMaxHours (OQ-159, founder 2026-10-06: until a signed note exists, capped at 72 hours).'
  from public.consultation_policy_config where version = 1;
-- policy-v2-additions-end

-- ---------------------------------------------------------------------------
-- 2. OQ-161: a granted scribe consent needs the patient's own in-app answer
-- ---------------------------------------------------------------------------
alter table public.scribe_consents add column encounter_id uuid references public.encounters (id) on delete restrict;
create index scribe_consents_encounter_idx on public.scribe_consents (encounter_id) where encounter_id is not null;
comment on column public.scribe_consents.encounter_id is
  'S21 (OQ-161): the consultation the patient allowed the AI note-taker for. Stamped by trigger from the patient''s own in-app answer; a granted row cannot exist without it.';

create function private.require_patient_scribe_answer() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_enc uuid;
begin
  -- the client never supplies this
  new.encounter_id := null;
  if new.granted then
    select e.id into v_enc
      from public.encounters e
     where e.patient_id = new.patient_id
       and public.scribe_may_start(e.id)
       and (
         new.encounter_note_id is null
         or exists (select 1 from public.clinical_encounter_notes n
                     where n.id = new.encounter_note_id and n.patient_id = new.patient_id
                       and n.video_consultation_id is not null and n.video_consultation_id = e.video_consultation_id)
       )
     order by e.scheduled_at desc nulls last
     limit 1;
    if v_enc is null then
      raise exception 'The patient has not allowed the AI note-taker for a live consultation with you in the app.' using errcode = '42501';
    end if;
    new.encounter_id := v_enc;
  end if;
  return new;
end;
$$;
revoke all on function private.require_patient_scribe_answer() from public, anon, authenticated;

-- named to sort after scribe_consents_attribution, which stamps the clinician first
create trigger scribe_consents_require_patient_answer before insert on public.scribe_consents
  for each row execute function private.require_patient_scribe_answer();

-- the patient's withdrawal revokes the audit rows and removes the transcript, whoever is on the screen
create function private.revoke_scribe_on_patient_withdrawal() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.granted is false and old.granted is true then
    delete from public.scribe_transcripts t
     where t.scribe_consent_id in (select c.id from public.scribe_consents c where c.encounter_id = new.encounter_id);
    update public.scribe_consents set revoked_at = now()
     where encounter_id = new.encounter_id and granted and revoked_at is null;
  end if;
  return new;
end;
$$;

revoke all on function private.revoke_scribe_on_patient_withdrawal() from public, anon, authenticated;
create trigger consultation_scribe_consents_revoke_on_withdrawal after update of granted on public.consultation_scribe_consents
  for each row execute function private.revoke_scribe_on_patient_withdrawal();

-- ---------------------------------------------------------------------------
-- 3. OQ-159: chart access after Finish, until a signed note exists, capped
-- ---------------------------------------------------------------------------
create or replace function private.clinician_has_patient_access(p_patient uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select
    (select auth.uid()) is not null
    and p_patient is not null
    and private.is_org_staff((select pr.organisation_id from public.profiles pr where pr.id = p_patient))
    and (
      -- today's care-team assignment (clinician, clinical director, care coordinator)
      exists (
        select 1 from public.care_team_assignment cta
         where cta.patient_id = p_patient
           and (select auth.uid()) in (cta.clinician_id, cta.clinical_director_id, cta.care_coordinator_id)
      )
      -- an open escalation routed to me
      or exists (
        select 1 from public.escalations e
         where e.patient_id = p_patient
           and e.assigned_doctor_id = (select auth.uid())
           and e.status in ('open', 'under_review')
      )
      -- an unresolved alert I am responsible for (or the backup)
      or exists (
        select 1 from public.clinician_alerts a
          join public.clinical_staff cs on cs.id in (a.responsible_clinician_id, a.backup_clinician_id)
         where a.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and a.status in ('open', 'acknowledged', 'snoozed')
      )
      -- a consultation in progress, or an upcoming one that has not ended (a stale booked row never ties a clinician)
      or exists (
        select 1 from public.appointments ap
         where ap.patient_id = p_patient
           and ap.clinician_id = (select auth.uid())
           and (
                ap.status = 'in_progress'
             or (ap.status in ('scheduled', 'booked', 'confirmed', 'checked_in') and ap.ends_at >= now())
           )
      )
      -- S21 (OQ-159, INV-12): a consultation I finished with this patient, until a signed note exists for it, for at most the policy cap
      or exists (
        select 1 from public.encounters en
         where en.patient_id = p_patient
           and en.clinician_id = (select auth.uid())
           and en.status = 'completed'
           and en.ended_at >= now() - make_interval(hours => coalesce((private.consult_policy() ->> 'chartAccessAfterFinishMaxHours')::integer, 0))
           -- an encounter with no link to a note (neither a video consultation nor an async consult) gets no access here: nothing could end it
           and (en.video_consultation_id is not null or en.async_consult_id is not null)
           and not exists (
                 select 1 from public.clinical_encounter_notes n
                  where n.patient_id = en.patient_id
                    and n.status = 'finalized'
                    and ((n.video_consultation_id is not null and n.video_consultation_id = en.video_consultation_id)
                      or (n.async_consult_id is not null and n.async_consult_id = en.async_consult_id))
               )
      )
      -- a video consultation I started or am due to host that has not ended
      or exists (
        select 1 from public.video_consultations vc
         where vc.patient_id = p_patient
           and vc.initiated_by = (select auth.uid())
           and vc.status in ('scheduled', 'started')
           and vc.ended_at is null
      )
      -- an active clinical task pushed to me, claimed by me, or offered to me as the named clinician (S16, INV-12)
      or exists (
        select 1 from public.clinical_tasks ct
         where ct.patient_id = p_patient
           and (
                (ct.state = 'offered_to_lead' and (select auth.uid()) in (ct.pushed_to, ct.lead_clinician_id))
             or (ct.state in ('claimed', 'escalated') and ct.claimed_by = (select auth.uid()))
           )
      )
      -- an open red event page I have ACKNOWLEDGED (S19, INV-12): being paged is not enough, taking responsibility is; closed
      -- pages and pages past the access window do not count
      or exists (
        select 1 from public.pages pg
         where pg.patient_id = p_patient and pg.closed_at is null
           and pg.acknowledged_by = (select auth.uid())
      )
      -- an open specialist referral assigned to me
      or exists (
        select 1 from public.specialist_referrals sr
          join public.clinical_staff cs on cs.id = sr.assigned_specialist_id
         where sr.patient_id = p_patient
           and cs.profile_id = (select auth.uid())
           and sr.status not in ('closed', 'declined', 'completed', 'draft')
      )
    );
$function$;

do $$
begin
  if (select count(*) from public.consultation_policy_config where is_active) <> 1
     or not exists (select 1 from public.consultation_policy_config where is_active and version = 2 and config ? 'chartAccessAfterFinishMaxHours') then
    raise exception 'S21g: policy v2 must be the one active policy and carry the chart access cap';
  end if;
  if has_function_privilege('anon', 'private.require_patient_scribe_answer()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.require_patient_scribe_answer()', 'EXECUTE')
     or has_function_privilege('anon', 'private.revoke_scribe_on_patient_withdrawal()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.revoke_scribe_on_patient_withdrawal()', 'EXECUTE') then
    raise exception 'S21g: a trigger function is executable by a signed-in or anonymous user';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.scribe_consents'::regclass and tgname = 'scribe_consents_require_patient_answer')
     or not exists (select 1 from pg_trigger where tgrelid = 'public.consultation_scribe_consents'::regclass and tgname = 'consultation_scribe_consents_revoke_on_withdrawal') then
    raise exception 'S21g: the scribe consent triggers are missing';
  end if;
  if has_function_privilege('anon', 'private.clinician_has_patient_access(uuid)', 'EXECUTE') then
    raise exception 'S21g: anon can execute clinician_has_patient_access';
  end if;
end $$;

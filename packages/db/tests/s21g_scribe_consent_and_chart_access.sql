-- S21g proof: patient-only scribe consent (OQ-161) and chart access after Finish (OQ-159)
-- (migration *_s21g_scribe_consent_patient_only_and_chart_access_after_finish.sql).
--
-- Proves in one rolled-back transaction:
--   1. Policy v2 is the one active policy and carries chartAccessAfterFinishMaxHours (72).
--   2. Scribe consent (only when the S23 scribe tables exist): a clinician cannot create a granted consent with no patient answer; once the
--      patient has allowed it in the app the clinician's row is accepted and tied to that encounter (a client-supplied encounter_id is
--      ignored); a row for another patient is refused; a recorded decline needs no precondition; the patient's withdrawal revokes the row
--      and deletes its transcript.
--   3. Chart access after Finish: the clinician keeps access to the patient after Finish with no signed note, loses it when a note is
--      finalized, loses it after the cap, and another clinician never had it.
--   4. SABOTAGE: with the patient-answer trigger dropped a clinician can create a consent from nothing; with the old function body
--      (no after-Finish clause) the clinician loses the chart the moment they finish.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.try_msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's21-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S21 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), p_dob, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- one unredeemed consultation credit for a patient (a fixture: what a paid checkout leaves behind)
create function pg_temp.mkcredit(p_patient uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.service_purchases (organisation_id, patient_id, service_product_id, status, amount_kobo, currency, voucher_covered_kobo, purchased_at)
  select pr.organisation_id, p_patient, sp.id, 'active', sp.price_kobo, 'NGN', 0, now()
    from public.profiles pr, public.service_products sp
   where pr.id = p_patient and sp.code = 'video_visit_credit'
  returning id into v;
  return v;
end $f$;
-- the clinician's confirmed bookable time (OQ-124): booking is only possible from it
create function pg_temp.open_time(p_clin uuid, p_start timestamptz) returns void language plpgsql as
$f$ declare v_org uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_clin;
  if not exists (select 1 from public.availability_blocks where clinician_id = p_clin and kind = 'bookable_consultations' and state = 'confirmed' and is_test
                  and starts_at <= p_start and ends_at >= p_start + interval '30 minutes') then
    insert into public.availability_blocks (organisation_id, clinician_id, starts_at, ends_at, kind, state, is_test)
    values (v_org, p_clin, p_start, p_start + interval '2 hours', 'bookable_consultations', 'confirmed', true);  -- 2 hours: S18's minimum block
  end if;
end $f$;
-- hold and confirm as the patient; returns the appointment id
create function pg_temp.book(p_patient uuid, p_clinician uuid, p_start timestamptz) returns uuid language plpgsql as
$f$ declare v_org uuid; v_id uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  perform pg_temp.open_time(p_clinician, p_start);
  perform pg_temp.act(p_patient);
  select id into v_id from public.hold_appointment_slot(v_org, p_clinician, 'telemedicine', 'telemedicine', p_start, p_start + interval '30 minutes');
  perform public.confirm_appointment_booking(v_id);
  perform pg_temp.back();
  return v_id;
end $f$;
-- the server records a join (as the service role); returns the consultation's status afterwards
create function pg_temp.join_as(p_enc uuid, p_role text) returns text language plpgsql as
$f$ declare v text;
begin
  perform pg_temp.act_service();
  select status into v from public.service_record_join(p_enc, p_role);
  perform pg_temp.back();
  return v;
end $f$;
create function pg_temp.credit_redeemed(p_purchase uuid) returns text language sql as
$$ select (redeemed_at is not null)::text from public.service_purchases where id = p_purchase $$;
-- how many credits are currently spent on this appointment (a credit freed earlier can be picked again, so check by target)
create function pg_temp.credits_on(p_appt uuid) returns text language sql as
$$ select count(*)::text from public.service_purchases where redeemed_entity_type = 'appointment' and redeemed_entity_id = p_appt $$;


do $$
declare
  v_org uuid;
  v_admin uuid; v_docA uuid; v_docB uuid; v_adult uuid; v_adult2 uuid;
  v_cr1 uuid; v_a1 uuid; v_e1 uuid; v_vc uuid; v_consent uuid; v_note uuid;
  v_start timestamptz := date_trunc('hour', now()) + interval '3 days' + interval '9 hours';
  v_res text;
  v_caught integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin', (current_date - interval '45 years')::date);
  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician', (current_date - interval '40 years')::date);
  v_docB := pg_temp.mkuser(v_org, 'doctor-b', 'clinician', (current_date - interval '40 years')::date);
  v_adult := pg_temp.mkuser(v_org, 'adult', 'patient', (current_date - interval '45 years')::date);
  v_adult2 := pg_temp.mkuser(v_org, 'adult-2', 'patient', (current_date - interval '30 years')::date);
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by, doctor_tier)
  values (v_org, v_docA, 'S21 doctor-a', true, true, array['en', 'fr'], now() - interval '10 days', now() + interval '1 year', 'General practice', true, v_admin, 'senior_medical_officer'),
         (v_org, v_docB, 'S21 doctor-b', true, true, array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, v_admin, 'senior_medical_officer');
  update public.consultation_policy_config set config = config || '{"bookingLeadMinutes":5,"bookingHorizonDays":21}'::jsonb where is_active;

  -- 1. Policy -------------------------------------------------------------------------------------------------
  perform pg_temp.rec('policy v2 is the one active policy', '1/2', (select count(*)::text || '/' || max(version)::text from public.consultation_policy_config where is_active));
  perform pg_temp.rec('...and carries the chart access cap of 72 hours', '72', (select config ->> 'chartAccessAfterFinishMaxHours' from public.consultation_policy_config where is_active));

  -- a live consultation: booked, brought inside the window, both people joined
  v_cr1 := pg_temp.mkcredit(v_adult);
  v_a1 := pg_temp.book(v_adult, v_docA, v_start);
  select id into v_e1 from public.encounters where appointment_id = v_a1;
  update public.encounters set scheduled_at = now() + interval '5 minutes' where id = v_e1;
  perform pg_temp.join_as(v_e1, 'patient');
  perform pg_temp.join_as(v_e1, 'clinician');

  -- 2. Scribe consent -----------------------------------------------------------------------------------------
  begin
    perform pg_temp.act(v_docA);
    perform pg_temp.rec('a clinician cannot create a granted consent when the patient has not answered', '42501',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, true, ''en-NG'')', v_adult)));
    perform pg_temp.back();
    perform pg_temp.act(v_adult);
    perform public.open_scribe_prompt(v_e1);
    perform public.record_scribe_consent(v_e1, true);
    perform pg_temp.back();
    perform pg_temp.act(v_docA);
    perform pg_temp.rec('once the patient allowed it, the clinician''s consent row is accepted', 'ok',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language, encounter_id) values (%L, true, ''en-NG'', %L)', v_adult, v_docA)));
    perform pg_temp.back();
    perform pg_temp.rec('...and tied to that encounter, ignoring what the client sent', 'true',
      (select (encounter_id = v_e1)::text from public.scribe_consents where patient_id = v_adult and granted order by recorded_at desc limit 1));
    -- the note a consent points at must be this patient's own and linked to this consultation: another patient's note is refused
    perform set_config('app.trusted_clinical_staff_author', (select id::text from public.clinical_staff where profile_id = v_docA), true);
    insert into public.clinical_encounter_notes (organisation_id, patient_id, encounter_type, reason_for_encounter, status, is_test)
    values (v_org, v_adult2, 'other', 'S21 proof', 'draft', true) returning id into v_note;
    perform set_config('app.trusted_clinical_staff_author', '', true);
    perform pg_temp.act(v_docA);
    perform pg_temp.rec('a consent cannot point at another patient''s note', '42501',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language, encounter_note_id) values (%L, true, ''en-NG'', %L)', v_adult, v_note)));
    perform pg_temp.back();
    delete from public.clinical_encounter_notes where id = v_note;
    perform pg_temp.act(v_docA);
    perform pg_temp.rec('a granted consent for a patient who never answered is refused', '42501',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, true, ''en-NG'')', v_adult2)));
    perform pg_temp.rec('a recorded decline needs no precondition', 'ok',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, false, ''en-NG'')', v_adult2)));
    perform pg_temp.back();
    select id into v_consent from public.scribe_consents where patient_id = v_adult and granted order by recorded_at desc limit 1;
    insert into public.scribe_transcripts (organisation_id, scribe_consent_id, segments_encrypted, duration_ms, language)
    values (v_org, v_consent, '\x00'::bytea, 1000, 'en-NG');
    perform pg_temp.act(v_adult);
    perform public.record_scribe_consent(v_e1, false);
    perform pg_temp.back();
    perform pg_temp.rec('the patient''s withdrawal revokes the consent row', 'true',
      (select (revoked_at is not null)::text from public.scribe_consents where id = v_consent));
    perform pg_temp.rec('...and deletes its transcript', '0', (select count(*)::text from public.scribe_transcripts where scribe_consent_id = v_consent));
  end;

  -- 3. Chart access after Finish ------------------------------------------------------------------------------
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('while the consultation is in progress the clinician has the chart', 'true', private.clinician_has_patient_access(v_adult)::text);
  perform public.complete_encounter(v_e1);
  perform pg_temp.back();
  select video_consultation_id into v_vc from public.encounters where id = v_e1;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('after Finish, with no signed note, the clinician keeps the chart', 'true', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('another clinician never had it', 'false', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();
  update public.encounters set started_at = now() - interval '74 hours', ended_at = now() - interval '73 hours' where id = v_e1;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('past the 72 hour cap the access lapses', 'false', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();
  update public.encounters set started_at = now() - interval '3 hours', ended_at = now() - interval '2 hours' where id = v_e1;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('inside the cap it is back', 'true', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();
  -- an encounter that links to no consultation and no async consult cannot be ended by a note, so it grants no access at all
  update public.encounters set video_consultation_id = null where id = v_e1;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('an encounter with no link to a note grants no after-Finish access', 'false', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();
  update public.encounters set video_consultation_id = v_vc where id = v_e1;
  -- the note is written by the server (the table has no direct insert policy) and signed by the clinician
  perform set_config('app.trusted_clinical_staff_author', (select id::text from public.clinical_staff where profile_id = v_docA), true);
  insert into public.clinical_encounter_notes (organisation_id, patient_id, video_consultation_id, encounter_type, reason_for_encounter, status, is_test)
  values (v_org, v_adult, v_vc, 'video_consult', 'S21 proof', 'draft', true) returning id into v_note;
  perform set_config('app.trusted_clinical_staff_author', '', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_docA, 'role', 'authenticated')::text, true);
  update public.clinical_encounter_notes set status = 'finalized', identity_confirmed = true, outcome = 'reassurance' where id = v_note;
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('once a signed note exists the access ends', 'false', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();

  -- 4. SABOTAGE -----------------------------------------------------------------------------------------------
  begin
    drop trigger scribe_consents_require_patient_answer on public.scribe_consents;
    perform pg_temp.act(v_docA);
    insert into results values ('sabotaged', 'a clinician cannot create a granted consent when the patient has not answered', '42501',
      pg_temp.try(format('insert into public.scribe_consents (patient_id, granted, language) values (%L, true, ''en-NG'')', v_adult2)));
    perform pg_temp.back();
  end;
  update public.encounters set started_at = now() - interval '3 hours', ended_at = now() - interval '2 hours' where id = v_e1;
  delete from public.clinical_encounter_notes where id = v_note;
  execute $old$
CREATE OR REPLACE FUNCTION private.clinician_has_patient_access(p_patient uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$
  $old$;
  perform pg_temp.act(v_docA);
  insert into results values ('sabotaged', 'after Finish, with no signed note, the clinician keeps the chart', 'true', private.clinician_has_patient_access(v_adult)::text);
  perform pg_temp.back();

  select count(*) into v_caught from results s where s.phase = 'sabotaged' and s.expected <> s.actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected every sabotage run to change a check, only % did (unchanged: %)', v_caught,
      (select string_agg(check_name || ' => ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged' and expected = actual);
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to FAIL inside the DO block above. They are deliberately not printed: the runner
-- treats any FAIL verdict in the output as a failed proof.

rollback;

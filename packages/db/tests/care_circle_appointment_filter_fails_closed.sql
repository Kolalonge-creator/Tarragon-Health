begin;
create temp table results (phase text, check_name text, expected text, actual text);
grant all on results to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccaf-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'Ccp ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
-- a real invite and a real acceptance, so the membership is made exactly the way the product makes it
create function pg_temp.join_with(p_pat uuid, p_sup uuid, p_perms text[]) returns uuid language plpgsql as $f$
declare r text; v_tok text;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite('email', %L, 'Daughter', %L::text[])::text$q$,
                                  (select email from auth.users where id = p_sup), p_perms::text));
  if r like 'ERR:%' then raise exception 'fixture: invite failed %', r; end if;
  v_tok := r::jsonb ->> 'token';
  r := pg_temp.q_as(p_sup, format($q$select public.accept_care_circle_invite(%L)::text$q$, v_tok));
  if r like 'ERR:%' then raise exception 'fixture: accept failed %', r; end if;
  return (select id from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup and state = 'active');
end $f$;
create function pg_temp.view(p_sup uuid, p_pat uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_sup, format('select public.circle_supporter_view(%L::uuid)::text', p_pat))::jsonb $$;
create function pg_temp.consent(p_pat uuid, p_on boolean) returns void language sql as
$$ select private.record_consent_cell(p_pat, (select organisation_id from public.profiles where id = p_pat), true, 'vitals', 'care_circle_sharing',
                                     p_on, 'patient', null, p_pat) $$;
create function pg_temp.appt(p_org uuid, p_pat uuid, p_days int, p_type text, p_reason text, p_ref uuid) returns uuid language sql as
$$ insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, reason, specialist_referral_id)
   values (p_org, p_pat, now() + make_interval(days => p_days), now() + make_interval(days => p_days) + interval '30 minutes', 'scheduled',
           p_type::public.appointment_type, 'telemedicine', p_reason, p_ref) returning id $$;
create function pg_temp.next_day(p_sup uuid, p_pat uuid) returns text language sql as
$$ select coalesce(round(extract(epoch from ((pg_temp.view(p_sup, p_pat) #>> '{appointments,next_at}')::timestamptz - now())) / 86400)::text, 'none') $$;
-- the Phase 1 filter, kept only to prove these checks would catch a return to it
create function pg_temp.old_filter() returns void language plpgsql as $f$ begin
  execute $q$create or replace function private.circle_appointment_shareable(p_type public.appointment_type, p_reason text, p_service text, p_referral uuid)
    returns boolean language sql stable set search_path = '' as $b$
    select p_type is distinct from 'therapy'::public.appointment_type and p_type is distinct from 'laboratory'::public.appointment_type
       and p_type is distinct from 'imaging'::public.appointment_type
       and private.confidential_domain_of_text(coalesce(p_reason, '') || ' ' || coalesce(p_service, '')) is null $b$$q$;
end $f$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; sup uuid; doc uuid; ref_gyn uuid; ref_eye uuid; ref_words uuid; a uuid; r text;
begin
  pat := pg_temp.mkuser(v_org, 'patient'); sup := pg_temp.mkuser(v_org, 'daughter'); doc := pg_temp.mkuser(v_org, 'doctor');
  perform pg_temp.join_with(pat, sup, array['appointments']);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pat, activation_note = 'ccaf proof' where key = 'care_circle_digest';
  perform pg_temp.consent(pat, true);
  -- the referral trigger needs a real clinical-tier doctor in the session (auth.uid()); RLS is not in play as postgres
  update public.profiles set role = 'clinician' where id = doc;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, credential_type, credential_number,
                                     license_verified_at, license_expires_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at)
  values (v_org, doc, 'Ccaf Doctor', true, 'senior_medical_officer', 'MDCN', 'CCAF-' || substr(doc::text, 1, 6), now(), now() + interval '1 year',
          'Probe', 'CCAF', now() + interval '1 year');
  perform set_config('request.jwt.claims', json_build_object('sub', doc, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', doc::text, true);
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, set_by) values (v_org, pat, 'ob_gyn', doc) returning id into ref_gyn;
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, set_by) values (v_org, pat, 'ophthalmology', doc) returning id into ref_eye;
  insert into public.specialist_referrals (organisation_id, patient_id, specialist_type, set_by, referral_reason)
  values (v_org, pat, 'other', doc, 'antenatal booking') returning id into ref_words;
  perform pg_temp.back();

  -- A. the filter itself
  perform pg_temp.ck('A1 specialist, no reason, no service, no referral: hidden', 'false', private.circle_appointment_shareable('specialist', null, null, null)::text);
  perform pg_temp.ck('A2 procedure with only spaces: hidden', 'false', private.circle_appointment_shareable('procedure', '   ', '', null)::text);
  perform pg_temp.ck('A3 specialist with a plain reason: shown', 'true', private.circle_appointment_shareable('specialist', 'Eye check', null, null)::text);
  perform pg_temp.ck('A4 blank GP visit: still shown (not a specialist)', 'true', private.circle_appointment_shareable('gp', null, null, null)::text);
  perform pg_temp.ck('A5 blank specialist linked to an eye referral: shown', 'true', private.circle_appointment_shareable('specialist', null, null, ref_eye)::text);
  perform pg_temp.ck('A6 specialist linked to an ob_gyn referral, harmless reason: hidden', 'false', private.circle_appointment_shareable('specialist', 'Follow up', null, ref_gyn)::text);
  perform pg_temp.ck('A7 referral whose reason names a sensitive subject: hidden', 'false', private.circle_appointment_shareable('specialist', null, null, ref_words)::text);
  perform pg_temp.ck('A8 therapy still hidden', 'false', private.circle_appointment_shareable('therapy', 'Chat', null, null)::text);
  perform pg_temp.ck('A9 the Phase 1 three-argument filter is gone', '0',
    (select count(*)::text from pg_proc where proname = 'circle_appointment_shareable' and pronargs = 3));
  perform pg_temp.ck('A10 a signed-in user cannot call the filter', 'false',
    has_function_privilege('authenticated', 'private.circle_appointment_shareable(public.appointment_type, text, text, uuid)', 'EXECUTE')::text);

  -- B. what the family member actually sees: the earliest appointments are the hidden kinds, the first shareable one is day 5
  perform pg_temp.appt(v_org, pat, 1, 'specialist', null, null);
  perform pg_temp.appt(v_org, pat, 2, 'specialist', 'Follow up', ref_gyn);
  perform pg_temp.appt(v_org, pat, 3, 'procedure', '', null);
  perform pg_temp.appt(v_org, pat, 4, 'specialist', null, ref_words);
  perform pg_temp.appt(v_org, pat, 5, 'specialist', null, ref_eye);
  perform pg_temp.ck('B1 the next appointment family see is the eye referral on day 5', '5', pg_temp.next_day(sup, pat));
  r := pg_temp.q_as(sup, format('select public.circle_weekly_digest(%L::uuid)::text', pat));
  perform pg_temp.ck('B2 the weekly digest agrees (day 5)', '5',
    coalesce(round(extract(epoch from ((r::jsonb #>> '{appointments,next_at}')::timestamptz - now())) / 86400)::text, 'none'));
  update public.appointments set status = 'completed', completed_at = now() - interval '2 days',
         scheduled_for = now() - interval '2 days', ends_at = now() - interval '2 days' + interval '30 minutes'
   where patient_id = pat and specialist_referral_id = ref_gyn;
  r := pg_temp.q_as(sup, format('select public.circle_supporter_timeline(%L::uuid)::text', pat));
  perform pg_temp.ck('B3 the attended ob_gyn appointment is not on the family timeline', '0',
    (select count(*)::text from jsonb_array_elements(coalesce(r::jsonb -> 'events', r::jsonb)) e where e ->> 'kind' like 'appointment%'));

  -- S. sabotage: put the Phase 1 filter back and the same checks must fail
  begin
    perform pg_temp.old_filter();
    r := pg_temp.next_day(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 Phase 1 filter restored: family see the blank specialist on day 1 (flips B1)', '1', r);
  begin
    perform pg_temp.old_filter();
    r := pg_temp.q_as(sup, format('select public.circle_supporter_timeline(%L::uuid)::text', pat));
    r := (select count(*)::text from jsonb_array_elements(coalesce(r::jsonb -> 'events', r::jsonb)) e where e ->> 'kind' like 'appointment%');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 Phase 1 filter restored: the ob_gyn visit reaches the timeline (flips B3)', '1', r);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_appointment_filter: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 15 then raise exception 'care_circle_appointment_filter: fewer checks ran than expected'; end if;
end $$;
rollback;

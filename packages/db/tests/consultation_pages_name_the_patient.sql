-- Proof: the consultation pages name the patient (migration 20261103212717_consultation_pages_name_the_patient.sql).
--
-- In one rolled-back transaction:
--   1. Fixture: an organisation, two doctors, one patient (a test account), one encounter assigned to doctor A.
--   2. Doctor A: my_clinician_encounters() returns the encounter with patient_id, the full name and patient_is_test;
--      consultation_patient_header(encounter) returns the same three fields.
--   3. Doctor B (same organisation, not assigned): the list has no row for that encounter; the header is null.
--   4. The patient: the header is null (a patient is never told the clinician's view). anon cannot execute either function.
--   5. SABOTAGE: (a) the header loses its clinician filter, so doctor B reads the name; (b) the list stops returning the
--      full name, so doctor A's check flips. Each must change a check, or the test is vacuous.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_name text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'cpn-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, p_name, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  return v;
end $f$;
-- the three fields the pages read from one list row, as one string
create function pg_temp.row_of(p_list jsonb, p_encounter uuid) returns text language sql as
$$ select string_agg((r ->> 'patient_id') || '/' || coalesce(r ->> 'patient_full_name', 'null') || '/' || (r ->> 'patient_is_test'), ';')
     from jsonb_array_elements(p_list) r where r ->> 'encounter_id' = p_encounter::text $$;

do $$
declare
  v_org uuid; v_docA uuid; v_docB uuid; v_patient uuid; v_enc uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;

  v_docA := pg_temp.mkuser(v_org, 'doctor-a', 'clinician', 'CPN Doctor A');
  v_docB := pg_temp.mkuser(v_org, 'doctor-b', 'clinician', 'CPN Doctor B');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient', 'Adaeze Okonkwo-Test');

  insert into public.encounters (organisation_id, patient_id, clinician_id, type, scheduled_at, policy_version, is_test)
  values (v_org, v_patient, v_docA, 'video', date_trunc('day', now()) + interval '22 hours', 1, true)
  returning id into v_enc;

  -- 2. The assigned doctor ------------------------------------------------------------------------------------
  perform pg_temp.act(v_docA);
  perform pg_temp.rec('doctor A: the list names the patient in full, with their id and test flag', v_patient::text || '/Adaeze Okonkwo-Test/true',
    pg_temp.row_of(public.my_clinician_encounters(), v_enc));
  perform pg_temp.rec('doctor A: the first name still comes along (older readers)', 'Adaeze',
    (select string_agg(r ->> 'patient_first_name', ';') from jsonb_array_elements(public.my_clinician_encounters()) r where r ->> 'encounter_id' = v_enc::text));
  perform pg_temp.rec('doctor A: the header for the encounter', v_patient::text || '/Adaeze Okonkwo-Test/true',
    (select (h ->> 'patient_id') || '/' || (h ->> 'patient_full_name') || '/' || (h ->> 'patient_is_test') from public.consultation_patient_header(v_enc) h));
  perform pg_temp.back();

  -- 3. Another doctor in the same organisation ---------------------------------------------------------------
  perform pg_temp.act(v_docB);
  perform pg_temp.rec('doctor B: no row for that encounter', 'null', coalesce(pg_temp.row_of(public.my_clinician_encounters(), v_enc), 'null'));
  perform pg_temp.rec('doctor B: the header is null', 'null', coalesce(public.consultation_patient_header(v_enc)::text, 'null'));
  perform pg_temp.back();

  -- 4. The patient and anon ----------------------------------------------------------------------------------
  perform pg_temp.act(v_patient);
  perform pg_temp.rec('the patient: the header is null', 'null', coalesce(public.consultation_patient_header(v_enc)::text, 'null'));
  perform pg_temp.rec('the patient: the clinician list is empty', '[]', public.my_clinician_encounters()::text);
  perform pg_temp.back();
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon cannot execute the header', '42501', pg_temp.try(format('select public.consultation_patient_header(%L)', v_enc)));
  perform pg_temp.rec('anon cannot execute the list', '42501', pg_temp.try('select public.my_clinician_encounters()'));
  perform pg_temp.back();

  -- 5. SABOTAGE ----------------------------------------------------------------------------------------------
  -- (a) the header loses its clinician filter: doctor B now reads the name
  create or replace function public.consultation_patient_header(p_encounter uuid) returns jsonb language sql stable security definer set search_path to '' as $s$
    select jsonb_build_object('patient_id', e.patient_id, 'patient_full_name', p.full_name, 'patient_is_test', coalesce(p.is_test, false))
      from public.encounters e join public.profiles p on p.id = e.patient_id where e.id = p_encounter $s$;
  perform pg_temp.act(v_docB);
  insert into results values ('sabotaged', 'doctor B: the header is null', 'null', coalesce(public.consultation_patient_header(v_enc)::text, 'null'));
  perform pg_temp.back();
  -- (b) the list stops carrying the full name: doctor A's row check flips
  create or replace function public.my_clinician_encounters(p_from timestamptz default null, p_to timestamptz default null) returns jsonb language sql stable security definer set search_path to '' as $s$
    select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.scheduled_at), '[]'::jsonb) from (
      select e.id as encounter_id, e.type, e.status, e.scheduled_at, e.final_media_mode,
             split_part(coalesce(p.full_name, ''), ' ', 1) as patient_first_name, e.patient_id, null::text as patient_full_name, coalesce(p.is_test, false) as patient_is_test
        from public.encounters e join public.profiles p on p.id = e.patient_id
       where e.clinician_id = (select auth.uid()) and e.scheduled_at >= coalesce(p_from, date_trunc('day', now())) and e.scheduled_at < coalesce(p_to, date_trunc('day', now()) + interval '2 days')
       order by e.scheduled_at limit 200) x $s$;
  perform pg_temp.act(v_docA);
  insert into results values ('sabotaged', 'doctor A: the list names the patient in full, with their id and test flag', v_patient::text || '/Adaeze Okonkwo-Test/true',
    pg_temp.row_of(public.my_clinician_encounters(), v_enc));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'consultation_pages_name_the_patient proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then
    raise exception 'VACUOUS TEST: expected both sabotage runs to change a check, only % did', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

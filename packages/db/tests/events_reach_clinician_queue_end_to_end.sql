-- Tarragon Health: events reach the clinician's own queue, end to end (2026-10-30)
--
-- The existing proofs show that an event writes a clinician_alerts row, a
-- notification, an escalation. None of them reads the result back the way the
-- clinician dashboard does: as the clinician, through RLS, with the same
-- filters. A row the page cannot see is the same as no row. This proof closes
-- that gap for the four events that matter most to patient safety:
--
--   E1  critical screening result  -> emergency alert visible to a clinician, with a due
--                                     time and an active in-org responsible clinician.
--                                     Paging for this event is NOT done in SQL: the trigger
--                                     only nudges the abnormal-result-handler Edge Function
--                                     (tested in supabase/functions/abnormal-result-handler/
--                                     clinician-page.test.ts). This proof asserts the nudge
--                                     is still wired, and that the guaranteed alert exists
--                                     without it.
--   E2  red-flag symptom           -> open alert visible to a clinician, one push page per
--                                     clinician in the organisation, and each clinician can
--                                     read their own page
--   E3  boundaries                 -> a clinician in another organisation sees nothing
--
-- Deliberately NOT asserted: whether a patient can read their own clinician_alerts row.
-- The policy lets them (patient_id = auth.uid()); the dashboard does not need that. It is
-- reported as an open question, not frozen into a test.
--
-- Everything is read through a simulated session (request.jwt.claims +
-- set local role authenticated), the way PostgREST runs the page's queries.
-- Fixtures are built here; nothing depends on live data.
--
-- Run: psql "$DATABASE_URL" -f packages/db/tests/events_reach_clinician_queue_end_to_end.sql
-- Wrapped in BEGIN/ROLLBACK. Raises on failure.

begin;

-- Under-18 and dependant guards are not involved: both patients are adults.

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
grant execute on function pg_temp.f(text), pg_temp.act(uuid), pg_temp.back() to public;

do $$
declare
  v_org uuid;
  v_org2 uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_doc2 uuid := gen_random_uuid();
  v_other_org_doc uuid := gen_random_uuid();
  v_pat uuid := gen_random_uuid();
  v_pat_other uuid := gen_random_uuid();
  v_product uuid;
  v_price bigint;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;

  insert into public.organisations (id, name, type) values (v_org2, 'EV Other Org', 'direct_consumer');

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values
    (v_doc, 'ev-doc@example.invalid', 'x', now(), '{}', '{}'),
    (v_doc2, 'ev-doc2@example.invalid', 'x', now(), '{}', '{}'),
    (v_other_org_doc, 'ev-odoc@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat, 'ev-pat@example.invalid', 'x', now(), '{}', '{}'),
    (v_pat_other, 'ev-pat2@example.invalid', 'x', now(), '{}', '{}');

  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values
    (v_doc, v_org, 'clinician', 'EV Doctor One', null),
    (v_doc2, v_org, 'clinician', 'EV Doctor Two', null),
    (v_other_org_doc, v_org2, 'clinician', 'EV Doctor Elsewhere', null),
    (v_pat, v_org, 'patient', 'EV Patient', date '1980-01-01'),
    (v_pat_other, v_org, 'patient', 'EV Patient Two', date '1982-02-02')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role,
    full_name = excluded.full_name, date_of_birth = excluded.date_of_birth;

  insert into public.clinical_staff (organisation_id, profile_id, full_name, doctor_tier, active, employment_type, license_verified_at)
  values
    (v_org, v_doc, 'EV Doctor One', 'senior_medical_officer', true, 'employed', now()),
    (v_org, v_doc2, 'EV Doctor Two', 'senior_medical_officer', true, 'employed', now());

  select id, price_kobo into v_product, v_price
    from public.service_products
   where 'vitals_red_flag_doctor_escalation' = any(features)
   order by code limit 1;
  if v_product is null then raise exception 'no product grants vitals_red_flag_doctor_escalation'; end if;

  insert into public.service_purchases
    (organisation_id, patient_id, purchaser_profile_id, service_product_id, status, amount_kobo, currency, purchased_at, expires_at)
  values (v_org, v_pat, v_pat, v_product, 'active', v_price, 'NGN', now(), now() + interval '84 days');

  if not private.patient_has_feature_access(v_pat, 'vitals_red_flag_doctor_escalation') then
    raise exception 'fixture patient is not entitled, the paging path would not run';
  end if;

  insert into fx values ('org', v_org), ('doc', v_doc), ('doc2', v_doc2), ('odoc', v_other_org_doc), ('pat', v_pat), ('pat2', v_pat_other);
end $$;

create temp table res (k text, v text);
grant all on res to public;

-- ---------------------------------------------------------------- fire the events (as the system)
do $$
declare v_result uuid;
begin
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values (pg_temp.f('org'), pg_temp.f('pat'), 'critical', 'hba1c', array['glucose'])
  returning id into v_result;
  insert into fx values ('e1_result', v_result);

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, description)
  values (pg_temp.f('org'), pg_temp.f('pat'), 'chest_pain', 9, 'EV red flag');
end $$;

-- ---------------------------------------------------------------- E1 structural: the edge nudge is still wired
do $$
declare v_src text;
begin
  select p.prosrc into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private' and p.proname = 'handle_abnormal_screening_result';
  if v_src is null or v_src !~ 'abnormal-result-handler' then
    raise exception 'FAIL E1: the screening trigger no longer calls the abnormal-result-handler Edge Function, so nobody is paged for a critical result';
  end if;
end $$;

-- ---------------------------------------------------------------- read as the clinician, the way the page does
create function pg_temp.as_clinician_checks() returns void language plpgsql as
$f$
declare
  v_n integer;
  v_orgdocs integer;
  v_resp uuid;
begin
  perform pg_temp.act(pg_temp.f('doc'));

  select count(*) into v_n from public.clinician_alerts
   where screening_result_id = pg_temp.f('e1_result') and level = 'emergency' and status = 'open';
  if v_n <> 1 then raise exception 'FAIL E1: clinician sees % open emergency alerts for the critical result, expected 1', v_n; end if;

  select count(*) into v_n from public.clinician_alerts
   where screening_result_id = pg_temp.f('e1_result') and sla_due_at is null;
  if v_n <> 0 then raise exception 'FAIL E1: the alert has no due time, the dashboard cannot rank it'; end if;

  select responsible_clinician_id into v_resp from public.clinician_alerts
   where screening_result_id = pg_temp.f('e1_result');
  if v_resp is null then raise exception 'FAIL E1: the alert has no responsible clinician, it sits in nobody''s queue'; end if;

  select count(*) into v_n from public.clinician_alerts
   where patient_id = pg_temp.f('pat') and screening_result_id is null and status = 'open';
  if v_n <> 1 then raise exception 'FAIL E2: clinician sees % open symptom alerts, expected 1', v_n; end if;

  perform pg_temp.back();
end $f$;
select pg_temp.as_clinician_checks();

-- the responsible clinician is a real, active clinician in the same organisation
do $$
declare v_ok boolean;
begin
  select exists (
    select 1 from public.clinician_alerts a
    join public.clinical_staff cs on cs.id = a.responsible_clinician_id or cs.profile_id = a.responsible_clinician_id
    where a.screening_result_id = pg_temp.f('e1_result')
      and cs.active and cs.organisation_id = pg_temp.f('org')) into v_ok;
  if not v_ok then raise exception 'FAIL E1: the responsible clinician is not an active clinician in the patient''s organisation'; end if;
end $$;

-- ---------------------------------------------------------------- E2 paging reaches every clinician
do $$
declare v_docs integer; v_n integer; v_channel text;
begin
  select count(*) into v_docs from public.profiles where organisation_id = pg_temp.f('org') and role = 'clinician';
  select count(distinct recipient_id) into v_n from public.notifications
   where escalation_pathway = 'symptom_red_flag' and escalation_hop = 1 and source_table = 'clinician_alerts'
     and source_id in (select id from public.clinician_alerts where patient_id = pg_temp.f('pat') and screening_result_id is null);
  if v_n <> v_docs then raise exception 'FAIL E2: % of % clinicians were paged for the red-flag symptom', v_n, v_docs; end if;
  select distinct channel::text into v_channel from public.notifications
   where escalation_pathway = 'symptom_red_flag' and escalation_hop = 1
     and source_id in (select id from public.clinician_alerts where patient_id = pg_temp.f('pat') and screening_result_id is null);
  if v_channel <> 'push' then raise exception 'FAIL E2: first hop is %, expected push', v_channel; end if;
end $$;

-- each clinician can read the page addressed to them
create function pg_temp.own_page_check() returns void language plpgsql as
$f$
declare v_n integer;
begin
  perform pg_temp.act(pg_temp.f('doc'));
  select count(*) into v_n from public.notifications
   where recipient_id = pg_temp.f('doc') and escalation_pathway = 'symptom_red_flag';
  perform pg_temp.back();
  if v_n <> 1 then raise exception 'FAIL E2: the clinician can read % of their own pages, expected 1', v_n; end if;
end $f$;
select pg_temp.own_page_check();

-- ---------------------------------------------------------------- E3 boundary, with a control
create function pg_temp.boundary_check() returns void language plpgsql as
$f$
declare v_other integer; v_same integer;
begin
  perform pg_temp.act(pg_temp.f('doc2'));
  select count(*) into v_same from public.clinician_alerts where patient_id = pg_temp.f('pat');
  perform pg_temp.back();
  perform pg_temp.act(pg_temp.f('odoc'));
  select count(*) into v_other from public.clinician_alerts where patient_id = pg_temp.f('pat');
  perform pg_temp.back();
  if v_same < 2 then raise exception 'FAIL E3 control: a second clinician in the same organisation sees % alerts, the boundary test would pass vacuously', v_same; end if;
  if v_other <> 0 then raise exception 'FAIL E3: a clinician in another organisation sees % of this patient''s alerts', v_other; end if;
end $f$;
select pg_temp.boundary_check();

select 'events_reach_clinician_queue_end_to_end: all checks passed' as result;

rollback;

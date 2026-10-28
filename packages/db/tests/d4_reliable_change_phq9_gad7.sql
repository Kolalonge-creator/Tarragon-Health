-- ===========================================================================
-- Proof: 20261028061352_d4_reliable_change_phq9_gad7.sql (D4: reliable change for PHQ-9 and GAD-7; INV-10, INV-13, S75a single minimum-cell rule).
--
--   1. DORMANT UNTIL SIGNED: the seeded config is inactive and unsigned; until the CMO signs, the report says awaiting_cmo_signature and shows no number.
--      Only the Chief Medical Officer signs (an admin, a clinician, a patient, anon are refused); a signed config cannot be edited, re-signed, deleted or
--      inserted active.
--   2. THE FIGURES: exact counts for a fixture. A fall of exactly the points is a reliable improvement and one point less is not; a rise of exactly the
--      points is a reliable deterioration; the four categories add up to the group; the group is the one the response report counts (a baseline under 5,
--      a test account and a person with no follow-up are handled as the response report does); response and remission appear beside it for the same group.
--   3. THE ONE MINIMUM-CELL RULE: a group under the minimum is withheld whole; a small non-zero category is withheld together with a neighbour so it cannot be
--      subtracted; a category of zero is shown as zero.
--   4. ROLES: admin and CMO can read; a clinician who is not the CMO, a patient and anon cannot. The report is audited.
--   5. SAFETY SCANS: no function added here reads a single answer or the safety flag; no hand-written minimum comparison; explicit search_path; anon cannot
--      execute; no policy was added to the mental health snapshot table (it stays patient-only at row level).
--   6. SABOTAGE: the classification replaced by one that never finds a change (the count checks must flip); the withholding helpers replaced by ones that never
--      withhold (the small-cell checks must flip). A proof that cannot fail is not a proof.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. The platform minimum is lowered to 3 on the outcome_config under test.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
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
create function pg_temp.j_as(p_uid uuid, p_sql text) returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := jsonb_build_object('err', sqlstate); end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
create function pg_temp.at_day(d date, h integer default 12) returns timestamptz language sql as $$ select (d::timestamp + make_interval(hours => h)) at time zone 'Africa/Lagos' $$;
create function pg_temp.anchor() returns date language sql as $$ select pg_temp.today() - 220 $$;

create function pg_temp.mkuser(p_label text, p_role text, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'd4-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, p_role::public.user_role, 'D4 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set role = excluded.role, is_active = true, is_test = excluded.is_test, phone = excluded.phone;
  return v;
end $f$;
-- a Member who joined 220 days ago (every day, 180 included, has closed with its grace)
create function pg_temp.mkmember(p_label text, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_label, 'patient', p_test); v_org uuid := (select organisation_id from public.profiles where id = v);
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, starts_at, is_test) values (v_org, v, 'purchase', pg_temp.at_day(pg_temp.anchor()), p_test);
  return v;
end $f$;
create function pg_temp.screen(p uuid, p_instr text, p_score integer, p_offset integer) returns void language sql as
$$ insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses, created_at)
   values ((select organisation_id from public.profiles where id = p), p, p_instr, p_score, 'minimal', '{}'::jsonb, pg_temp.at_day(pg_temp.anchor() + p_offset)) $$;
-- a Member with a baseline total near joining and (optionally) a total near day 90, then the day-90 snapshot under outcome_config v4
create function pg_temp.person(p_label text, p_instr text, p_base integer, p_d90 integer, p_test boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkmember(p_label, p_test);
begin
  perform pg_temp.screen(v, p_instr, p_base, 2);
  if p_d90 is not null then perform pg_temp.screen(v, p_instr, p_d90, 90); end if;
  perform private.outcome_mh_compute(v, p_instr, 90, 4);
  return v;
end $f$;
-- the report body as a row of text, one key
create function pg_temp.cat(p_report jsonb, p_key text, p_field text) returns text language sql as
$$ select c ->> p_field from jsonb_array_elements(p_report #> '{reliable_change,categories}') c where c ->> 'key' = p_key $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_cmo uuid;
begin
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('clin', pg_temp.mkuser('clin', 'clinician'));
  perform pg_temp.setf('patient', pg_temp.mkuser('patient', 'patient'));
  v_cmo := pg_temp.mkuser('cmo', 'clinician');
  perform pg_temp.setf('cmo', v_cmo);
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, status, doctor_tier, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_cmo, 'D4 CMO', true, true, 'active', 'chief_medical_officer', array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, pg_temp.f('admin'));
  set local session_replication_role = origin;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Dormant until signed, and who signs
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('1a the seeded config is version 1, inactive and unsigned', '1|false|false',
    (select version::text || '|' || is_active::text || '|' || (approved_at is not null)::text from public.outcome_reliable_change_config order by version limit 1));
  perform pg_temp.ck('1b nothing can be read from the signed accessor while unsigned', 'true', (private.reliable_change_config() is null)::text);
  perform pg_temp.ck('1c an admin gets awaiting_cmo_signature and no number', 'awaiting_cmo_signature|true|no_figure',
    coalesce(pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$) ->> 'reason', 'x') || '|' ||
    coalesce(pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$) ->> 'withheld', 'x') || '|' ||
    case when pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$) ? 'reliable_change' then 'figure' else 'no_figure' end);
  perform pg_temp.ck('1d an admin cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.sign_outcome_reliable_change_config(1)::text $q$));
  perform pg_temp.ck('1e a clinician who is not the CMO cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.sign_outcome_reliable_change_config(1)::text $q$));
  perform pg_temp.ck('1f a patient cannot sign', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.sign_outcome_reliable_change_config(1)::text $q$));
  perform pg_temp.ck('1g anon cannot sign', '42501', pg_temp.try_anon($q$ select public.sign_outcome_reliable_change_config(1) $q$));
  perform pg_temp.ck('1h a new config cannot be inserted active or signed', '42501',
    pg_temp.try($q$ insert into public.outcome_reliable_change_config (version, is_active, effective_from, config) values (2, true, current_date, '{}'::jsonb) $q$));
end $$;

-- the report with the definitions signed but no measures active: says so, no number
do $$
begin
  perform pg_temp.ck('1i the CMO signs', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_reliable_change_config(1)::text $q$), 'null'));
  perform pg_temp.ck('1j signed and active, approved by the CMO', 'true|true',
    (select (is_active)::text || '|' || (approved_by = pg_temp.f('cmo'))::text from public.outcome_reliable_change_config where version = 1));
  perform pg_temp.ck('1k signing again is refused', 'ERR:23514', pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_reliable_change_config(1)::text $q$));
  perform pg_temp.ck('1l a signed config cannot be edited', '23514', pg_temp.try($q$ update public.outcome_reliable_change_config set config = '{}'::jsonb where version = 1 $q$));
  perform pg_temp.ck('1m a signed config cannot have its signature removed', '23514', pg_temp.try($q$ update public.outcome_reliable_change_config set approved_at = null where version = 1 $q$));
  perform pg_temp.ck('1n a version is never deleted', '23514', pg_temp.try($q$ delete from public.outcome_reliable_change_config where version = 1 $q$));
  perform pg_temp.ck('1o with the definitions signed but the S75 measures not active, the report says measures_not_active', 'measures_not_active',
    coalesce(pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$) ->> 'reason', 'x'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. The S75 measures v4 active, the minimum lowered to 3 for the fixture
-- ---------------------------------------------------------------------------------------------------------------------------------
update public.outcome_config set is_active = false where version = 2;
update public.outcome_config set is_active = true where version = 4;
set local session_replication_role = replica;
update public.outcome_config set config = jsonb_set(config, '{min_cell}', '3') where is_active;
set local session_replication_role = origin;

do $$
declare i integer; p uuid;
begin
  set local session_replication_role = replica;
  -- PHQ-9, reliable change = 6 points. Group: 14 people with a baseline of 5 or more and a day-90 snapshot.
  --   improvement (4): 14 -> 8 (a fall of exactly 6), 15 -> 4 x3
  --   no reliable change (4): 12 -> 7 (a fall of 5, one short), 12 -> 12, 10 -> 14 (a rise of 4), 11 -> 9
  --   deterioration (3): 8 -> 14 (a rise of exactly 6) x3
  --   no follow-up (3): baseline 12, nothing at day 90
  perform pg_temp.person('p1', 'phq9', 14, 8);
  for i in 1 .. 3 loop perform pg_temp.person('p2' || i, 'phq9', 15, 4); end loop;
  perform pg_temp.person('p3', 'phq9', 12, 7); perform pg_temp.person('p4', 'phq9', 12, 12); perform pg_temp.person('p5', 'phq9', 10, 14); perform pg_temp.person('p6', 'phq9', 11, 9);
  for i in 1 .. 3 loop perform pg_temp.person('p7' || i, 'phq9', 8, 14); end loop;
  for i in 1 .. 3 loop perform pg_temp.person('p8' || i, 'phq9', 12, null); end loop;
  -- not in the group: a baseline of 3 (not applicable to response), and a test account that improved a lot
  perform pg_temp.person('p9', 'phq9', 3, 0);
  perform pg_temp.person('pt', 'phq9', 20, 4, true);
  -- GAD-7, reliable change = 4 points. Group: 9 people.
  --   improvement (4): 10 -> 5 (a fall of 5);  no reliable change (4): 9 -> 8;  deterioration (1): 6 -> 10 (a rise of exactly 4);  no follow-up (0)
  for i in 1 .. 4 loop perform pg_temp.person('g1' || i, 'gad7', 10, 5); end loop;
  for i in 1 .. 4 loop perform pg_temp.person('g2' || i, 'gad7', 9, 8); end loop;
  perform pg_temp.person('g3', 'gad7', 6, 10);
  set local session_replication_role = origin;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. The figures
-- ---------------------------------------------------------------------------------------------------------------------------------
create function pg_temp.figures(p_phase text) returns void language plpgsql as
$f$
declare r jsonb := pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$); g jsonb := pg_temp.j_as(pg_temp.f('cmo'), $q$ select public.mental_health_reliable_change_report('gad7', 90) $q$);
begin
  perform pg_temp.sk(p_phase, '2a PHQ-9 day 90: the group is 14 (baseline of 5 or more, not a test account), shown', '14|false', (r #>> '{reliable_change,n}') || '|' || (r #>> '{reliable_change,suppressed}'));
  perform pg_temp.sk(p_phase, '2b PHQ-9: 4 reliable improvement (a fall of exactly 6 counts, a fall of 5 does not)', '4', pg_temp.cat(r, 'reliable_improvement', 'n'));
  perform pg_temp.sk(p_phase, '2c PHQ-9: 4 no reliable change', '4', pg_temp.cat(r, 'no_reliable_change', 'n'));
  perform pg_temp.sk(p_phase, '2d PHQ-9: 3 reliable deterioration (a rise of exactly 6 counts)', '3', pg_temp.cat(r, 'reliable_deterioration', 'n'));
  perform pg_temp.sk(p_phase, '2e PHQ-9: 3 with no follow-up score, shown as missing and counted in the group', '3', pg_temp.cat(r, 'insufficient_data', 'n'));
  perform pg_temp.sk(p_phase, '2f PHQ-9: the four categories add up to the group', '14',
    (select sum((c ->> 'n')::integer)::text from jsonb_array_elements(r #> '{reliable_change,categories}') c));
  perform pg_temp.sk(p_phase, '2g PHQ-9: percent of the group for improvement', '28.6', pg_temp.cat(r, 'reliable_improvement', 'pct_of_group'));
  perform pg_temp.sk(p_phase, '2h PHQ-9: the points used are the signed config''s', '6|1', (r ->> 'reliable_change_points') || '|' || (r ->> 'reliable_change_config_version'));
  perform pg_temp.sk(p_phase, '2i PHQ-9: response and remission appear beside it for the same group (14 people each)', '14|14|3|3',
    (r #>> '{response,n}') || '|' || (r #>> '{remission,n}') || '|' || (r #>> '{response,reached}') || '|' || (r #>> '{remission,reached}'));
  perform pg_temp.sk(p_phase, '2j the fixed descriptive, not causal wording and no comparison group', 'true|none|true',
    ((r ->> 'note') ~ 'descriptive, not causal')::text || '|' || (r ->> 'comparison_group') || '|' || (r ->> 'not_a_causal_claim'));
  perform pg_temp.sk(p_phase, '2k GAD-7 (4 points): the group is 9, the CMO can read it too', '9', g #>> '{reliable_change,n}');
  perform pg_temp.sk(p_phase, '2l GAD-7: a fall of 5 is a reliable improvement', '4', pg_temp.cat(g, 'reliable_improvement', 'n'));
  perform pg_temp.sk(p_phase, '2m GAD-7: a rise of exactly 4 is a reliable deterioration, but 1 person is a small cell: withheld', 'true', coalesce(pg_temp.cat(g, 'reliable_deterioration', 'suppressed'), 'null'));
  perform pg_temp.sk(p_phase, '2n GAD-7: the small category is withheld together with a neighbour, so it cannot be subtracted (at least 2 withheld)', 'true',
    ((select count(*) from jsonb_array_elements(g #> '{reliable_change,categories}') c where (c ->> 'suppressed')::boolean) >= 2)::text);
  perform pg_temp.sk(p_phase, '2o GAD-7: a category of zero is shown as zero, not withheld', '0|false', pg_temp.cat(g, 'insufficient_data', 'n') || '|' || pg_temp.cat(g, 'insufficient_data', 'suppressed'));
  perform pg_temp.sk(p_phase, '2p a month with nobody in it is withheld whole', 'true|under_minimum',
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90, date '2000-01-01', date '2000-01-31') $q$) #>> '{reliable_change,suppressed}') || '|' ||
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90, date '2000-01-01', date '2000-01-31') $q$) #>> '{reliable_change,reason}'));
end $f$;
select pg_temp.figures('real');

do $$
begin
  perform pg_temp.ck('3a day 0 is refused (there is no change at the start)', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 0)::text $q$));
  perform pg_temp.ck('3b an instrument that is not PHQ-9 or GAD-7 is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('hba1c', 90)::text $q$));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. Roles and the audit trail
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('4a a clinician who is not the CMO is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), $q$ select public.mental_health_reliable_change_report('phq9', 90)::text $q$));
  perform pg_temp.ck('4b a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), $q$ select public.mental_health_reliable_change_report('phq9', 90)::text $q$));
  perform pg_temp.ck('4c anon cannot execute', 'false', has_function_privilege('anon', 'public.mental_health_reliable_change_report(text,integer,date,date)', 'EXECUTE')::text);
  perform pg_temp.ck('4d the report is audited with the admin as the actor', 'true',
    (exists (select 1 from public.audit_log where action = 'outcomes.mental_health_reliable_change_report' and actor_id = pg_temp.f('admin')))::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Scans
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_fns text[] := array['private.reliable_change_class', 'private.reliable_change_config', 'public.mental_health_reliable_change_report', 'public.sign_outcome_reliable_change_config', 'private.outcome_reliable_change_config_guard'];
        v_item text; v_hand text; v_nosp text; v_anon text;
begin
  select string_agg(s, ', ') into v_item from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* 'item_responses|crisis_flagged');
  perform pg_temp.ck('5a no function added here reads a single answer or the safety flag', 'none', coalesce(v_item, 'none'));
  select string_agg(s, ', ') into v_hand from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.prosrc ~* '(between 1 and|>= *v_min\M|< *v_min\M|< *p_min\M|>= *p_min\M|min_cohort_size *[<>])');
  perform pg_temp.ck('5b no hand-written minimum comparison', 'none', coalesce(v_hand, 'none'));
  select string_agg(s, ', ') into v_nosp from unnest(v_fns) s
   where not exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and p.proconfig is not null and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
  perform pg_temp.ck('5c every function sets an explicit search_path', 'none', coalesce(v_nosp, 'none'));
  select string_agg(s, ', ') into v_anon from unnest(v_fns) s
   where exists (select 1 from pg_proc p where (p.pronamespace::regnamespace::text || '.' || p.proname) = s and has_function_privilege('anon', p.oid, 'EXECUTE'));
  perform pg_temp.ck('5d anon can execute none of them', 'none', coalesce(v_anon, 'none'));
  perform pg_temp.ck('5e the mental health snapshot table still has exactly its one patient-own policy', '1',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename = 'outcome_mh_snapshots'));
  perform pg_temp.ck('5f the config table is not readable by a patient or a non-CMO clinician', '0|0',
    coalesce(pg_temp.q_as(pg_temp.f('patient'), 'select count(*)::text from public.outcome_reliable_change_config'), 'null') || '|' ||
    coalesce(pg_temp.q_as(pg_temp.f('clin'), 'select count(*)::text from public.outcome_reliable_change_config'), 'null'));
  perform pg_temp.ck('5g the report returns no person: no patient id appears in the JSON', 'false',
    (pg_temp.j_as(pg_temp.f('admin'), $q$ select public.mental_health_reliable_change_report('phq9', 90) $q$)::text ~ '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. SABOTAGE: the classification never finds a change -> the count checks must flip; the helpers never withhold -> the small-cell checks must flip
-- ---------------------------------------------------------------------------------------------------------------------------------
create or replace function private.reliable_change_class(p_baseline integer, p_score integer, p_points integer) returns text
language sql immutable set search_path = '' as $$ select case when p_baseline is null or p_score is null then 'insufficient_data' else 'no_reliable_change' end $$;
select pg_temp.figures('sabotaged-class');
create or replace function private.reliable_change_class(p_baseline integer, p_score integer, p_points integer) returns text
language sql immutable set search_path = ''
as $$
  select case when p_baseline is null or p_score is null or p_points is null or p_points < 1 then 'insufficient_data'
              when p_score - p_baseline <= -p_points then 'reliable_improvement'
              when p_score - p_baseline >= p_points then 'reliable_deterioration'
              else 'no_reliable_change' end
$$;

create or replace function private.suppress_cell(p_n bigint, p_categories bigint[] default null, p_min integer default null) returns text
language sql stable security definer set search_path = '' as $$ select null::text $$;
create or replace function private.suppress_groups(p_groups jsonb, p_min integer default null) returns jsonb
language sql stable security definer set search_path = ''
as $$ select coalesce(jsonb_agg(g || jsonb_build_object('suppressed', false, 'reason', null)), '[]'::jsonb) from jsonb_array_elements(p_groups) g $$;
select pg_temp.figures('sabotaged-cell');

do $$
declare v_bad integer; v_flipped integer; v_names text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'D4 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged-class' and s.expected is distinct from s.actual and s.check_name ~ '^2(b|c|d|g)';
  if v_flipped < 4 then raise exception 'VACUOUS TEST: a classification that finds no change flipped % of 4 count checks (%)', v_flipped, v_names; end if;
  select count(*), string_agg(check_name, '; ') into v_flipped, v_names from results s
   where s.phase = 'sabotaged-cell' and s.expected is distinct from s.actual and s.check_name ~ '^2(m|n|p)';
  if v_flipped < 3 then raise exception 'VACUOUS TEST: helpers that never withhold flipped % of 3 small-cell checks (%)', v_flipped, v_names; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
select 'SABOTAGE ' || check_name as check_name, expected, actual, case when expected is distinct from actual then 'PASS' else 'FAIL' end as result
  from results where (phase = 'sabotaged-class' and check_name ~ '^2(b|c|d|g)') or (phase = 'sabotaged-cell' and check_name ~ '^2(m|n|p)') order by check_name;

rollback;

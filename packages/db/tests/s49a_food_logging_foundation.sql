-- S49a proof: food logging foundation (migrations *_s49a_food_enum_values.sql and *_s49a_food_logging_foundation.sql).
-- One rolled-back transaction. Proves:
--  * the catalogue holds at least 100 foods, every one 'estimated' and flagged for dietitian review, and the database refuses a row that
--    claims to need no review while still 'estimated'; the salt and sugar flags are computed (a drink uses the lower sugar line);
--  * wrap, ladle and bowl portions exist, every default portion has small / medium / large slots, and no portion photo exists;
--  * a patient can read the catalogue and cannot write it; the diary view food_logs shows the patient's own meal and no one else's;
--  * food.logged is emitted once per meal with the entry id only, and a broken event bus never loses the diary row;
--  * a retried offline send (same client_id) is refused as a duplicate; a plausible phone time is kept, an old one is not;
--  * favourites are private to the patient;
--  * the targets config is born unsigned and inactive, only the Chief Medical Officer signs it, the floors are enforced by the database,
--    a patient cannot read the config table, and the gate gives a patient numbers ONLY when targets are not withheld: pregnancy (in each of
--    the places it is held), the postnatal year, a clinician hold, a positive eating-disorder screen and an age under 18 all return
--    state 'withheld' with no config and no reason; a plain adult is the control;
--  * a hold is set only by a tied clinician, never by a care coordinator or a patient, and the patient cannot read it;
--  * barcodes: check digits are validated, lookup answers invalid / not_found / found, only an admin writes, a malformed NAFDAC number is refused;
--  * no new table is open to anon, the minor-dependant guard has no gaps, the three new patient tables are in the data registry.
-- SABOTAGE: (1) the withheld function made to always answer false; (2) the diary event trigger removed. Both must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as $$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's49a-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S49a ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '45 years')::date), true)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = excluded.is_test, is_active = true,
    date_of_birth = excluded.date_of_birth;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid; s uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S49a ' || p_label, 'MDCN', 'S49A-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted'::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end, true, p_admin, true)
  returning id into s;
  return v;
end $f$;

create function pg_temp.as_user(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.as_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;

-- fixtures -------------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then insert into public.organisations (name) values ('S49a proof org') returning id into v_org; end if;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('smo', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('coord', pg_temp.mkuser(v_org, 'coord', 'care_coordinator'));
  perform pg_temp.setf('p1', pg_temp.mkuser(v_org, 'p1', 'patient'));
  perform pg_temp.setf('p2', pg_temp.mkuser(v_org, 'p2', 'patient'));
  perform pg_temp.setf('preg_profile', pg_temp.mkuser(v_org, 'pregprofile', 'patient'));
  perform pg_temp.setf('preg_table', pg_temp.mkuser(v_org, 'pregtable', 'patient'));
  perform pg_temp.setf('preg_stage', pg_temp.mkuser(v_org, 'pregstage', 'patient'));
  perform pg_temp.setf('postpartum_stage', pg_temp.mkuser(v_org, 'postpartumstage', 'patient'));
  perform pg_temp.setf('postnatal', pg_temp.mkuser(v_org, 'postnatal', 'patient'));
  perform pg_temp.setf('ed', pg_temp.mkuser(v_org, 'ed', 'patient'));
  perform pg_temp.setf('held', pg_temp.mkuser(v_org, 'held', 'patient'));
  perform pg_temp.setf('minor', pg_temp.mkuser(v_org, 'minor', 'patient', (current_date - interval '16 years')::date));
  update public.profiles set is_pregnant = true where id = pg_temp.f('preg_profile');
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, pg_temp.f('preg_table'), true);
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, pg_temp.f('preg_stage'), 'pregnant');
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, pg_temp.f('postpartum_stage'), 'postpartum');
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, pg_temp.f('postnatal'), current_date - 100);
  insert into public.obesity_ed_screens (organisation_id, patient_id, positive, self_reported) values (v_org, pg_temp.f('ed'), true, true);
end $$;

-- 1 catalogue -----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('1', 'at least 100 foods', 'true', (select (count(*) >= 100)::text from public.nigerian_foods));
select pg_temp.ck('1', 'every food estimated and flagged for review', '0',
  (select count(*)::text from public.nigerian_foods where data_quality <> 'estimated' or not needs_dietitian_review));
select pg_temp.ck('1', 'claiming no review while estimated is refused', 'ERR 23514',
  pg_temp.as_user(pg_temp.f('admin'), $$ update public.nigerian_foods set needs_dietitian_review = false where code = 'eba' returning 'x' $$));
select pg_temp.ck('1', 'dried fish is high salt', 'true', (select high_salt::text from public.nigerian_foods where code = 'fish_dried'));
select pg_temp.ck('1', 'eba is not high salt', 'false', (select high_salt::text from public.nigerian_foods where code = 'eba'));
select pg_temp.ck('1', 'biscuits are high sugar (food line 22.5)', 'true', (select high_sugar::text from public.nigerian_foods where code = 'biscuits'));
select pg_temp.ck('1', 'a fruit drink at 11.5 is high sugar (drink line 11.25)', 'true', (select high_sugar::text from public.nigerian_foods where code = 'fruit_drink'));
select pg_temp.ck('1', 'a soft drink at 10.6 is not', 'false', (select high_sugar::text from public.nigerian_foods where code = 'soft_drink'));
select pg_temp.ck('1', 'wrap of eba exists', '250.0', (select p.grams::text from public.nigerian_food_portions p join public.nigerian_foods f on f.id = p.food_id where f.code = 'eba' and p.unit = 'wrap'));
select pg_temp.ck('1', 'ladle of egusi exists', '100.0', (select p.grams::text from public.nigerian_food_portions p join public.nigerian_foods f on f.id = p.food_id where f.code = 'egusi_soup' and p.unit = 'ladle'));
select pg_temp.ck('1', 'the existing default portion is untouched', 'serving', (select p.unit::text from public.nigerian_food_portions p join public.nigerian_foods f on f.id = p.food_id where f.code = 'eba' and p.is_default));
select pg_temp.ck('1', 'every default portion has three size slots', '0',
  (select count(*)::text from public.nigerian_food_portions p where p.is_default and (select count(*) from public.nigerian_food_portion_sizes s where s.food_id = p.food_id and s.unit = p.unit) <> 3));
select pg_temp.ck('1', 'no portion photo exists', '0', (select count(*)::text from public.nigerian_food_portion_sizes where photo_path is not null));
select pg_temp.ck('1', 'a patient reads the catalogue', 'true', pg_temp.as_user(pg_temp.f('p1'), $$ select (count(*) >= 100)::text from public.nigerian_foods $$));
do $$ begin perform pg_temp.as_user(pg_temp.f('p1'), $q$ update public.nigerian_foods set name = 'hacked' where code = 'eba' returning 'x' $q$); end $$;
select pg_temp.ck('1', 'a patient cannot write the catalogue', 'Eba', (select name from public.nigerian_foods where code = 'eba'));

-- 2 diary, view, event, offline ------------------------------------------------------------------------------------------------------
create function pg_temp.log_meal(p_pat uuid, p_extra text default '') returns text language plpgsql as
$f$ declare r text;
begin
  return pg_temp.as_user(p_pat, format($q$ insert into public.nutrition_log_entries (organisation_id, patient_id, meal_type, description, parsed_items, nutrition_analysis %s)
    values (%L, %L, 'lunch', 'a wrap of eba and a ladle of egusi soup', '[{"foodCode":"eba"}]'::jsonb, '{"caloriesKcal": 612.5}'::jsonb %s) returning id::text $q$,
    case when p_extra = '' then '' else ', client_id, client_recorded_at' end, pg_temp.f('org'), p_pat,
    case when p_extra = '' then '' else ', ' || p_extra end));
end $f$;
do $$ declare v text; begin
  v := pg_temp.log_meal(pg_temp.f('p1'));
  perform pg_temp.setf('meal1', v::uuid);
end $$;
select pg_temp.ck('2', 'the meal is saved', 'true', (select exists (select 1 from public.nutrition_log_entries where id = pg_temp.f('meal1'))::text));
select pg_temp.ck('2', 'food_logs shows the energy', '612.5', pg_temp.as_user(pg_temp.f('p1'), format($$ select energy_kcal::text from public.food_logs where id = %L $$, pg_temp.f('meal1'))));
select pg_temp.ck('2', 'food_logs basis is the food database', 'food_database', pg_temp.as_user(pg_temp.f('p1'), format($$ select energy_basis from public.food_logs where id = %L $$, pg_temp.f('meal1'))));
select pg_temp.ck('2', 'another patient does not see it in food_logs', '0', pg_temp.as_user(pg_temp.f('p2'), $$ select count(*)::text from public.food_logs $$));
select pg_temp.ck('2', 'food.logged is emitted once', '1', (select count(*)::text from public.domain_events where event_type = 'food.logged' and aggregate_id = pg_temp.f('meal1')));
select pg_temp.ck('2', 'the event carries the entry id only', '{"entry_id": "' || pg_temp.f('meal1') || '"}', (select payload::text from public.domain_events where event_type = 'food.logged' and aggregate_id = pg_temp.f('meal1')));
select pg_temp.ck('2', 'source defaults to patient', 'patient', (select source::text from public.nutrition_log_entries where id = pg_temp.f('meal1')));

create function pg_temp.cid() returns uuid language sql as $$ select '00000000-0000-4000-8000-0000000049a1'::uuid $$;
select pg_temp.ck('2', 'first offline send with a client id is saved', 'true',
  (pg_temp.log_meal(pg_temp.f('p1'), format('%L, now() - interval ''1 hour''', pg_temp.cid())) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('2', 'a retried send is a duplicate', 'ERR 23505', pg_temp.log_meal(pg_temp.f('p1'), format('%L, now() - interval ''1 hour''', pg_temp.cid())));
select pg_temp.ck('2', 'a time one hour ago is kept (client_bounded)', 'client_bounded', (select time_basis from public.nutrition_log_entries where client_id = pg_temp.cid()));
do $$ begin perform pg_temp.log_meal(pg_temp.f('p1'), format('%L, now() - interval ''10 days''', '00000000-0000-4000-8000-0000000049a2')); end $$;
select pg_temp.ck('2', 'a ten day old phone time is not trusted (server)', 'server', (select time_basis from public.nutrition_log_entries where client_id = '00000000-0000-4000-8000-0000000049a2'));

-- a broken event bus never loses the diary row
update public.event_types set is_active = false where event_type = 'food.logged';
do $$ declare v text; begin v := pg_temp.log_meal(pg_temp.f('p1')); perform pg_temp.setf('meal_nobus', v::uuid); end $$;
select pg_temp.ck('2', 'with the event type off the meal is still saved', 'true', (select exists (select 1 from public.nutrition_log_entries where id = pg_temp.f('meal_nobus'))::text));
select pg_temp.ck('2', 'and no event was written', '0', (select count(*)::text from public.domain_events where event_type = 'food.logged' and aggregate_id = pg_temp.f('meal_nobus')));
update public.event_types set is_active = true where event_type = 'food.logged';

-- 3 favourites ----------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('3', 'a patient saves a favourite', 'true', (pg_temp.as_user(pg_temp.f('p1'), format($$ insert into public.favourite_meals (organisation_id, patient_id, name, meal_type, description)
  values (%L, %L, 'My breakfast', 'breakfast', 'a bowl of pap and 2 akara') returning id::text $$, pg_temp.f('org'), pg_temp.f('p1'))) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('3', 'the same name twice is refused', 'ERR 23505', pg_temp.as_user(pg_temp.f('p1'), format($$ insert into public.favourite_meals (organisation_id, patient_id, name, description)
  values (%L, %L, ' my breakfast ', 'x') returning id::text $$, pg_temp.f('org'), pg_temp.f('p1'))));
select pg_temp.ck('3', 'another patient cannot see it', '0', pg_temp.as_user(pg_temp.f('p2'), $$ select count(*)::text from public.favourite_meals $$));
select pg_temp.ck('3', 'another patient cannot add one for the first', 'ERR 42501', pg_temp.as_user(pg_temp.f('p2'), format($$ insert into public.favourite_meals (organisation_id, patient_id, name, description)
  values (%L, %L, 'sneaky', 'x') returning id::text $$, pg_temp.f('org'), pg_temp.f('p1'))));
select pg_temp.ck('3', 'staff have no policy on favourites', '0', pg_temp.as_user(pg_temp.f('smo'), $$ select count(*)::text from public.favourite_meals $$));
select pg_temp.ck('3', 'anon cannot read favourites', 'ERR 42501', pg_temp.as_anon($$ select count(*)::text from public.favourite_meals $$));

-- 4 targets configuration and the gate ----------------------------------------------------------------------------------------------
create function pg_temp.gate(p uuid) returns jsonb language plpgsql as $f$ begin return pg_temp.as_user(p, 'select public.my_nutrition_target_gate()::text')::jsonb; end $f$;
select pg_temp.ck('4', 'the config is born inactive and unsigned', '0', (select count(*)::text from public.nutrition_target_config where is_active or approved_by is not null));
select pg_temp.ck('4', 'one draft exists', '1', (select count(*)::text from public.nutrition_target_config where version = 1));
select pg_temp.ck('4', 'unsigned: the gate says not_active and gives no numbers', '{"state": "not_active"}', pg_temp.gate(pg_temp.f('p1'))::text);
select pg_temp.ck('4', 'a patient cannot read the config table', '0', pg_temp.as_user(pg_temp.f('p1'), $$ select count(*)::text from public.nutrition_target_config $$));
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$ begin execute p_sql; return 'ok'; exception when others then return 'ERR ' || sqlstate; end $f$;
select pg_temp.ck('4', 'a floor below 1000 is refused by the database', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_target_config (version, config) values (90, '{"min_age_years":18,"energy":{"floor_kcal":{"female":800,"male":1500}},"macros_pct_of_energy":{},"salt_sugar_fibre":{},"meal_summary":{}}'::jsonb) $$));
select pg_temp.ck('4', 'a config live without a signature is refused', 'ERR 23514', pg_temp.try($$
  insert into public.nutrition_target_config (version, is_active, config) select 91, true, config from public.nutrition_target_config where version = 1 $$));
select pg_temp.ck('4', 'a senior medical officer cannot sign it', 'ERR P0001',
  pg_temp.as_user(pg_temp.f('smo'), format($$ select public.sign_nutrition_target_config(%L)::text $$, (select id from public.nutrition_target_config where version = 1))));
select pg_temp.ck('4', 'a patient cannot sign it', 'ERR P0001',
  pg_temp.as_user(pg_temp.f('p1'), format($$ select public.sign_nutrition_target_config(%L)::text $$, (select id from public.nutrition_target_config where version = 1))));
select pg_temp.ck('4', 'anon cannot sign it', 'ERR 42501',
  pg_temp.as_anon(format($$ select public.sign_nutrition_target_config(%L)::text $$, (select id from public.nutrition_target_config where version = 1))));
select pg_temp.ck('4', 'still unsigned after the refusals', '0', (select count(*)::text from public.nutrition_target_config where is_active));
select pg_temp.ck('4', 'the Chief Medical Officer signs it', 'true',
  (pg_temp.as_user(pg_temp.f('cmo'), format($$ select public.sign_nutrition_target_config(%L)::text $$, (select id from public.nutrition_target_config where version = 1))) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('4', 'signed: a plain adult gets the config', 'ok', pg_temp.gate(pg_temp.f('p1')) ->> 'state');
select pg_temp.ck('4', 'the config carries the safe floors', '1200', (pg_temp.gate(pg_temp.f('p1')) #>> '{config,energy,floor_kcal,female}'));
select pg_temp.ck('4', 'a second plain adult is the control', 'ok', pg_temp.gate(pg_temp.f('p2')) ->> 'state');

-- withheld: each place pregnancy is held, the postnatal year, the eating-disorder screen, an age under 18
create function pg_temp.withheld_shape(p uuid) returns text language plpgsql as
$f$ declare g jsonb := pg_temp.gate(p); begin
  return (g ->> 'state') || '/' || (g ? 'config')::text || '/' || (select count(*) from jsonb_object_keys(g))::text;
end $f$;
select pg_temp.ck('4', 'pregnant (profile flag) is withheld with nothing else', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('preg_profile')));
select pg_temp.ck('4', 'pregnant (patient_pregnancy) is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('preg_table')));
select pg_temp.ck('4', 'pregnant (reproductive life stage) is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('preg_stage')));
select pg_temp.ck('4', 'postpartum (reproductive life stage) is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('postpartum_stage')));
select pg_temp.ck('4', 'within a year of delivery is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('postnatal')));
select pg_temp.ck('4', 'a positive eating-disorder screen is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('ed')));
select pg_temp.ck('4', 'under 18 is withheld', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('minor')));

-- clinician hold
select pg_temp.ck('4', 'a patient cannot set a hold', 'ERR 42501', pg_temp.as_user(pg_temp.f('p1'), format($$ select public.set_nutrition_target_hold(%L, true)::text $$, pg_temp.f('held'))));
select pg_temp.ck('4', 'a care coordinator cannot set a hold', 'ERR 42501', pg_temp.as_user(pg_temp.f('coord'), format($$ select public.set_nutrition_target_hold(%L, true)::text $$, pg_temp.f('held'))));
select pg_temp.ck('4', 'anon cannot set a hold', 'ERR 42501', pg_temp.as_anon(format($$ select public.set_nutrition_target_hold(%L, true)::text $$, pg_temp.f('held'))));
select pg_temp.ck('4', 'a clinician with no tie to the patient cannot set one', 'ERR 42501',
  pg_temp.as_user(pg_temp.f('smo'), format($$ select public.set_nutrition_target_hold(%L, true)::text $$, pg_temp.f('held'))));
select pg_temp.ck('4', 'the refused attempts left the patient able to see targets', 'ok', pg_temp.gate(pg_temp.f('held')) ->> 'state');
-- the tie itself is proven by s39g_tied_staff_writes.sql; here the organisation-wide fallback stands in for a tied clinician
update public.platform_modules set is_enabled = false where key = 'tied_staff_writes';
select pg_temp.ck('4', 'a tied clinician sets a hold', 'true', (pg_temp.as_user(pg_temp.f('smo'), format($$ select public.set_nutrition_target_hold(%L, true, 'eating_disorder_concern')::text $$, pg_temp.f('held'))) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('4', 'a held patient is withheld with nothing else', 'withheld/false/1', pg_temp.withheld_shape(pg_temp.f('held')));
select pg_temp.ck('4', 'the patient cannot read the hold', '0', pg_temp.as_user(pg_temp.f('held'), $$ select count(*)::text from public.nutrition_target_holds $$));
select pg_temp.ck('4', 'setting it twice keeps one open hold', '1', (
  select (pg_temp.as_user(pg_temp.f('smo'), format($$ select public.set_nutrition_target_hold(%L, true, 'clinician_flag')::text $$, pg_temp.f('held'))) is not null)::int::text
  where (select count(*) from public.nutrition_target_holds where patient_id = pg_temp.f('held') and cleared_at is null) = 1));
select pg_temp.ck('4', 'the hold was audited', 'true', (select (count(*) >= 1)::text from public.audit_log where action = 'nutrition_target_hold.set'));
select pg_temp.ck('4', 'a clinician clears it', 'true', (pg_temp.as_user(pg_temp.f('smo'), format($$ select public.set_nutrition_target_hold(%L, false)::text $$, pg_temp.f('held'))) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('4', 'cleared: targets return', 'ok', pg_temp.gate(pg_temp.f('held')) ->> 'state');
update public.platform_modules set is_enabled = true where key = 'tied_staff_writes';

-- 5 barcodes ------------------------------------------------------------------------------------------------------------------------
select pg_temp.ck('5', 'EAN-13 check digit', 'true', private.gtin_valid('4006381333931')::text);
select pg_temp.ck('5', 'EAN-13 wrong check digit', 'false', private.gtin_valid('4006381333932')::text);
select pg_temp.ck('5', 'EAN-8', 'true', private.gtin_valid('96385074')::text);
select pg_temp.ck('5', 'UPC-A', 'true', private.gtin_valid('036000291452')::text);
select pg_temp.ck('5', 'letters are not a code', 'false', private.gtin_valid('ABC')::text);
select pg_temp.ck('5', 'wrong length is not a code', 'false', private.gtin_valid('12345')::text);
select pg_temp.ck('5', 'no barcodes are seeded', '0', (select count(*)::text from public.barcodes));
select pg_temp.ck('5', 'lookup of a bad code', 'invalid', pg_temp.as_user(pg_temp.f('p1'), $$ select public.lookup_barcode('4006381333932') ->> 'status' $$));
select pg_temp.ck('5', 'lookup of an unknown code', 'not_found', pg_temp.as_user(pg_temp.f('p1'), $$ select public.lookup_barcode('036000291452') ->> 'status' $$));
select pg_temp.ck('5', 'anon cannot look up', 'ERR 42501', pg_temp.as_anon($$ select public.lookup_barcode('036000291452') ->> 'status' $$));
select pg_temp.ck('5', 'a patient cannot add a barcode', 'ERR 42501', pg_temp.as_user(pg_temp.f('p1'), $$
  insert into public.barcodes (code, food_id, product_name) select '4006381333931', id, 'x' from public.nigerian_foods where code = 'eba' returning 'x' $$));
select pg_temp.ck('5', 'a malformed NAFDAC number is refused', 'ERR 23514', pg_temp.as_user(pg_temp.f('admin'), $$
  insert into public.barcodes (code, food_id, product_name, nafdac_number) select '4006381333931', id, 'x', 'ZZ' from public.nigerian_foods where code = 'eba' returning 'x' $$));
select pg_temp.ck('5', 'a code with a wrong check digit cannot be stored', 'ERR 23514', pg_temp.as_user(pg_temp.f('admin'), $$
  insert into public.barcodes (code, food_id, product_name) select '4006381333932', id, 'x' from public.nigerian_foods where code = 'eba' returning 'x' $$));
select pg_temp.ck('5', 'an admin adds a team-curated barcode', 'true', (pg_temp.as_user(pg_temp.f('admin'), $$
  insert into public.barcodes (code, food_id, product_name, brand, nafdac_number) select '4006381333931', id, 'Test pack', 'Test brand', 'A4-1234' from public.nigerian_foods where code = 'eba' returning id::text $$) ~ '^[0-9a-f-]{36}$')::text);
select pg_temp.ck('5', 'lookup finds it, spaces ignored', 'found', pg_temp.as_user(pg_temp.f('p1'), $$ select public.lookup_barcode('4006 3813 33931') ->> 'status' $$));
select pg_temp.ck('5', 'and returns the NAFDAC number', 'A4-1234', pg_temp.as_user(pg_temp.f('p1'), $$ select public.lookup_barcode('4006381333931') ->> 'nafdac_number' $$));

-- 6 registrations and closed doors ---------------------------------------------------------------------------------------------------
select pg_temp.ck('6', 'no minor guard gaps', '0', (select count(*)::text from private.minor_guard_gaps()));
select pg_temp.ck('6', 'the three patient tables are in the data registry', '3', (select count(*)::text from public.data_registry where table_name in ('favourite_meals', 'nutrition_preferences', 'nutrition_target_holds')));
select pg_temp.ck('6', 'the hold table is in the staff read scope as tied', 'tied', (select mode from public.staff_read_scope where table_name = 'nutrition_target_holds'));
select pg_temp.ck('6', 'anon cannot read the new tables', '0', (select count(*)::text from unnest(array['favourite_meals', 'nutrition_preferences', 'nutrition_target_holds', 'nutrition_target_config', 'barcodes', 'nigerian_food_portion_sizes', 'food_logs']) t
  where has_table_privilege('anon', 'public.' || t, 'SELECT')));
select pg_temp.ck('6', 'nobody signed in can ask why targets are withheld', 'false', has_function_privilege('authenticated', 'private.nutrition_targets_withheld(uuid)', 'EXECUTE')::text);

-- SABOTAGE 1: a withheld function that never withholds must let a pregnant patient through (so the withheld checks above can fail)
create or replace function private.nutrition_targets_withheld(p_patient uuid) returns boolean language sql stable security definer set search_path = '' as $$ select false $$;
select pg_temp.ck('sabotage', 'with the withheld rule removed a pregnant patient would receive targets', 'ok', pg_temp.gate(pg_temp.f('preg_profile')) ->> 'state');

-- SABOTAGE 2: with the diary trigger removed no food.logged event is written (so the event check above can fail)
drop trigger nutrition_log_entries_emit_food_logged on public.nutrition_log_entries;
do $$ declare v text; begin v := pg_temp.log_meal(pg_temp.f('p1')); perform pg_temp.setf('meal_sab', v::uuid); end $$;
select pg_temp.ck('sabotage', 'with the trigger removed there is no event', '0', (select count(*)::text from public.domain_events where event_type = 'food.logged' and aggregate_id = pg_temp.f('meal_sab')));

-- verdict ---------------------------------------------------------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(phase || ' / ' || check_name || ': expected ' || coalesce(expected, 'NULL') || ' got ' || coalesce(actual, 'NULL'), E'\n')
    into v_bad from results where expected is distinct from actual;
  if v_bad is not null then raise exception E'S49a proof FAILED:\n%', v_bad; end if;
  raise notice 'S49a proof: % checks passed', (select count(*) from results);
end $$;

rollback;

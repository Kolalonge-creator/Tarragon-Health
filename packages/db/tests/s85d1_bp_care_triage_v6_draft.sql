-- S85-D1 proof: bp_care_triage v6 (version 3 with the emergency-symptom question from 180/120, founder decision D1) is an UNSIGNED draft that
-- differs from v3 in exactly the version, the extreme line, the note for the CMO and two descriptions; versions 1 to 3 are untouched (v3 still 200/130);
-- while v3 is approved the server grades with v3 and v6 is never used; the older server alert path reads nothing the change touches.
-- One rolled-back transaction. Raises on any failure. Sabotage: (1) the extreme line flipped back to 200/130 must be caught by the 180/120 check,
-- (2) a second difference slipped into v6 must be caught by the "only these differ" check, (3) approving v6 (retiring v3) must change what the
-- grading function returns, proving the "v3 wins while approved" check could fail.
begin;

create or replace function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's85d1-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S85d1 ' || p_label, (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;

-- the same three checks, as one function over the stored rows, so a sabotage can show each one is able to fail
create or replace function pg_temp.v6_checks() returns text[]
language plpgsql as $f$
declare j3 jsonb; j4 jsonb; bad text[] := '{}';
begin
  select rules into j3 from public.triage_rule_sets where code = 'bp_care_triage' and version = 5;
  select rules into j4 from public.triage_rule_sets where code = 'bp_care_triage' and version = 6;
  if j3 is null or j4 is null then return array['rows missing']; end if;
  if (j4 #>> '{params,extreme,systolic}')::int <> 180 or (j4 #>> '{params,extreme,diastolic}')::int <> 120 then bad := bad || array['extreme-not-180-120']; end if;
  if (j4 #>> '{params,severe,systolic}')::int <> 180 or (j4 #>> '{params,severe,diastolic}')::int <> 120
     or (j4 #>> '{params,urgent,systolic}')::int <> 180 or (j4 #>> '{params,urgent,diastolic}')::int <> 110 then bad := bad || array['severe-or-urgent-moved']; end if;
  if (((j4 #- '{params,extreme}') #- '{params,proposedForCmo}') - 'version') #- '{rules}'
       is distinct from (((j3 #- '{params,extreme}') - 'version') #- '{rules}') then bad := bad || array['params-differ-beyond-extreme']; end if;
  if (select jsonb_agg(r - 'description') from jsonb_array_elements(j4 -> 'rules') r)
       is distinct from (select jsonb_agg(r - 'description') from jsonb_array_elements(j3 -> 'rules') r) then bad := bad || array['a-rule-differs']; end if;
  return bad;
end $f$;

do $$
declare
  v1row public.triage_rule_sets%rowtype; v2row public.triage_rule_sets%rowtype; v3row public.triage_rule_sets%rowtype; v6row public.triage_rule_sets%rowtype; v5row public.triage_rule_sets%rowtype;
  v_org uuid; v_admin uuid; v_cmo uuid; bad text[]; g jsonb; fn text; x text;
begin
  select * into v1row from public.triage_rule_sets where code = 'bp_care_triage' and version = 1;
  select * into v2row from public.triage_rule_sets where code = 'bp_care_triage' and version = 2;
  select * into v3row from public.triage_rule_sets where code = 'bp_care_triage' and version = 3;
  select * into v6row from public.triage_rule_sets where code = 'bp_care_triage' and version = 6;
  select * into v5row from public.triage_rule_sets where code = 'bp_care_triage' and version = 5;
  if v3row.id is null or v5row.id is null or v6row.id is null then raise exception 'FAIL 1: bp_care_triage v3, v5 and v6 must all exist'; end if;

  -- v6 is an unsigned draft
  if v6row.status <> 'draft' or v6row.approved_by is not null or v6row.approved_at is not null then
    raise exception 'FAIL 2: v6 must be an unsigned draft, found % / approved_by %', v6row.status, v6row.approved_by;
  end if;
  if v6row.note not ilike '%not signed%' then raise exception 'FAIL 2b: the v6 note must say the CMO has not signed it'; end if;
  if (v6row.rules -> 'code') <> to_jsonb('bp_care_triage'::text) or (v6row.rules -> 'version') <> to_jsonb(6) then
    raise exception 'FAIL 3: the JSON must repeat the row code and version';
  end if;

  -- versions 1 to 3 untouched: still the 200/130 line, not approved by this change
  if (v3row.rules #>> '{params,extreme,systolic}')::int <> 200 or (v3row.rules #>> '{params,extreme,diastolic}')::int <> 130 then
    raise exception 'FAIL 4: v3 must still say 200/130 (a rule set is never edited)';
  end if;
  if (v2row.rules #>> '{params,extreme,systolic}')::int <> 200 or (v1row.rules #>> '{params,extreme,systolic}')::int <> 200 then
    raise exception 'FAIL 4b: v1 and v2 must still say 200/130';
  end if;

  -- v6 differs from v3 only where intended
  bad := pg_temp.v6_checks();
  if cardinality(bad) > 0 then raise exception 'FAIL 5: %', bad; end if;
  if jsonb_array_length(v6row.rules -> 'rules') <> jsonb_array_length(v5row.rules -> 'rules') then raise exception 'FAIL 5b: same number of rules'; end if;
  if (select r ->> 'description' from jsonb_array_elements(v6row.rules -> 'rules') r where r ->> 'id' = 'BP-X1') not like '180/120 or more%'
     or (select r ->> 'description' from jsonb_array_elements(v6row.rules -> 'rules') r where r ->> 'id' = 'BP-X2') not like '180/120 or more%' then
    raise exception 'FAIL 5c: BP-X1 and BP-X2 descriptions must read 180/120';
  end if;
  -- the three open CMO decisions are carried as a PROPOSED note, not decided
  if (select array_agg(k order by k) from jsonb_object_keys(v6row.rules #> '{params,proposedForCmo}') k)
       is distinct from array['recheckWindow','severeHeadacheIsOneSymptom','status','urgentLineIs180Over110'] then
    raise exception 'FAIL 6: the proposedForCmo note must carry exactly the three open decisions and a status';
  end if;
  if (v6row.rules #>> '{params,extremeRecheck,afterMinutes}')::int <> 120 or (v6row.rules #>> '{params,extremeRecheck,windowMinutes}')::int <> 240
     or (v6row.rules #>> '{params,symptomGroups,redFlag}') not like '%severe_headache%' then
    raise exception 'FAIL 6b: the recheck window and the headache symptom must stay as they were';
  end if;

  -- with nothing approved (a fresh local replay) the newest draft is the shadow set; that is the documented hazard of an unapproved newer draft
  if (public.triage_rule_set_for_grading('bp_care_triage') ->> 'version')::int <> 6 then
    raise exception 'FAIL 7: with nothing approved, grading is expected to use the newest draft (shadow)';
  end if;

  -- CONTROL: with v3 approved (as live), grading and the legacy path use v3, never the v6 draft
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, active, license_verified_at, employment_type, indemnity_exempt, indemnity_exempt_by)
  values (v_cmo, v_org, 'S85d1 CMO', 'chief_medical_officer', true, now(), 'employed', true, v_admin)
  on conflict do nothing;
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v3row.id;
  g := public.triage_rule_set_for_grading('bp_care_triage');
  if (g ->> 'version')::int <> 3 or g ->> 'status' <> 'approved' then raise exception 'FAIL 8: while v3 is approved, grading must use v3, got %', g ->> 'version'; end if;
  if (private.approved_bp_rule_params() #>> '{extreme,systolic}')::int <> 200 then raise exception 'FAIL 9: the legacy path must read the approved v3 line (200), not v4'; end if;
  if (select status from public.triage_rule_sets where id = v6row.id) <> 'draft' then raise exception 'FAIL 9b: v6 must still be a draft'; end if;

  -- the older server alert path: no change needed, and it reads nothing that D1 touches
  foreach fn in array array['private.handle_bp_reading_red_flag()', 'private.handle_symptom_red_flag()'] loop
    x := pg_get_functiondef(fn::regprocedure);
    if position('extreme' in x) > 0 then raise exception 'FAIL 10: % must not read params.extreme', fn; end if;
  end loop;
  if private.classify_bp_level(185, 100) <> 'red' or private.classify_bp_level(190, 110) <> 'red'
     or private.classify_bp_level(180, 120) <> 'emergency' or private.classify_bp_level(200, 130) <> 'emergency'
     or private.classify_bp_level(179, 119) <> 'red' then
    raise exception 'FAIL 11: the older alert bands changed (every reading from 160/100 must still raise the Priority 1 alert)';
  end if;

  -- SABOTAGE 1: flip v4's extreme line back to 200/130; the 180/120 check must catch it
  update public.triage_rule_sets set rules = jsonb_set(rules, '{params,extreme}', '{"systolic": 200, "diastolic": 130}'::jsonb) where id = v6row.id;
  bad := pg_temp.v6_checks();
  if not ('extreme-not-180-120' = any (bad)) then raise exception 'VACUOUS TEST: v6 with a 200/130 line was not caught (%)', bad; end if;
  update public.triage_rule_sets set rules = jsonb_set(rules, '{params,extreme}', '{"systolic": 180, "diastolic": 120}'::jsonb) where id = v6row.id;
  if cardinality(pg_temp.v6_checks()) > 0 then raise exception 'sabotage 1 did not restore cleanly'; end if;

  -- SABOTAGE 2: a second difference in v6 (the pregnancy line) must be caught by the "only these differ" check
  update public.triage_rule_sets set rules = jsonb_set(rules, '{params,pregnancy,severeSystolic}', '170'::jsonb) where id = v6row.id;
  bad := pg_temp.v6_checks();
  if not ('params-differ-beyond-extreme' = any (bad)) then raise exception 'VACUOUS TEST: a second difference in v6 was not caught (%)', bad; end if;
  update public.triage_rule_sets set rules = jsonb_set(rules, '{params,pregnancy,severeSystolic}', (v5row.rules #> '{params,pregnancy,severeSystolic}'), false) where id = v6row.id;
  update public.triage_rule_sets set rules = jsonb_set(rules, '{rules}', (select jsonb_agg(case when r ->> 'id' = 'BP-R1' then jsonb_set(r, '{grade}', '"amber"'::jsonb) else r end order by o) from jsonb_array_elements(rules -> 'rules') with ordinality t(r, o))) where id = v6row.id;
  bad := pg_temp.v6_checks();
  if not ('a-rule-differs' = any (bad)) then raise exception 'VACUOUS TEST: lowering BP-R1 in v6 from red to amber was not caught (%)', bad; end if;

  -- SABOTAGE 3: approving v6 (what the CMO's signature would do) must change what grading returns
  update public.triage_rule_sets set status = 'retired' where id = v3row.id;
  update public.triage_rule_sets set status = 'approved', approved_by = v_cmo, approved_at = now() where id = v6row.id;
  g := public.triage_rule_set_for_grading('bp_care_triage');
  if (g ->> 'version')::int <> 6 then raise exception 'VACUOUS TEST: approving v6 did not change which set grades'; end if;

  raise notice 'S85-D1 proof: all checks passed, all three sabotages caught';
end $$;

rollback;

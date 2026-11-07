-- ===========================================================================
-- Proof: PD-06 care plan review dates, action categories and revisions
-- (20261107010945_care_plan_reviews_categories_and_revisions.sql).
--
-- Proves, with simulated sessions: the tied doctor sets review dates and a categorised action with why/when/how, then
-- publishes a revision that needs acknowledgement (the gate opens) and the snapshot carries the action; a care coordinator
-- and an untied doctor cannot publish; nobody can insert or update a revision directly; a supporter with the care-plan
-- category grant can READ the revision but cannot acknowledge it; the patient acknowledges their own (who and when recorded), a second
-- click is harmless, and a change that did not ask for acknowledgement cannot be acknowledged; version numbers climb.
-- SABOTAGE: an acknowledge function without the patient check lets the supporter acknowledge, so check 5 can fail.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures.
-- ===========================================================================

begin;

do $$
declare
  v_org uuid;
  v_pat uuid := gen_random_uuid();
  v_sup uuid := gen_random_uuid();
  v_doc uuid := gen_random_uuid();
  v_untied uuid := gen_random_uuid();
  v_coord uuid := gen_random_uuid();
  v_plan uuid := gen_random_uuid();
  v_rev1 uuid;
  v_rev2 uuid;
  v_row public.care_plan_revisions%rowtype;
  v_n integer;
  v_failed boolean;
  v_other uuid;
  v_pa uuid;
  v_stranger uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'fixture FAIL: no organisation'; end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values
    (v_pat,    'pd06-pat@example.invalid',    'x', now(), '{}', '{}'),
    (v_sup,    'pd06-sup@example.invalid',    'x', now(), '{}', '{}'),
    (v_doc,    'pd06-doc@example.invalid',    'x', now(), '{}', '{}'),
    (v_untied, 'pd06-untied@example.invalid', 'x', now(), '{}', '{}'),
    (v_coord,  'pd06-coord@example.invalid',  'x', now(), '{}', '{}'),
    (v_stranger, 'pd06-stranger@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth) values
    (v_pat,    v_org, 'patient',          'PD06 Patient',     '+2348057760001', '1970-01-01'),
    (v_sup,    v_org, 'patient',          'PD06 Supporter',   '+2348057760002', '1990-01-01'),
    (v_doc,    v_org, 'clinician',        'PD06 Doctor',      '+2348057760003', null),
    (v_untied, v_org, 'clinician',        'PD06 Untied',      '+2348057760004', null),
    (v_coord,  v_org, 'care_coordinator', 'PD06 Coordinator', '+2348057760005', null),
    (v_stranger, v_org, 'patient',        'PD06 Stranger',    '+2348057760006', '1980-01-01')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
    date_of_birth = excluded.date_of_birth;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier) values
    (v_org, v_doc,    'PD06 Doctor',      true, now(), 'senior_medical_officer'),
    (v_org, v_untied, 'PD06 Untied',      true, now(), 'senior_medical_officer'),
    (v_org, v_coord,  'PD06 Coordinator', true, now(), 'care_coordinator');
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, assigned_at)
  values (v_org, v_pat, v_doc, now()) on conflict (patient_id) do update set clinician_id = v_doc;
  -- the supporter holds the care-plan category grant; only the patient may grant a category, so it is made with their claims
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by)
  values (v_pat, v_sup, 'view', v_pat) returning id into v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  update public.profile_access set clinical_access = true where id = v_pa;
  insert into public.profile_access_categories (profile_access_id, category) values (v_pa, 'appointments_care_plan');

  insert into public.care_plans (id, organisation_id, patient_id, condition, status)
  values (v_plan, v_org, v_pat, 'hypertension', 'draft');

  -- 1. the tied doctor sets review dates, adds a categorised action and publishes (the gate opens)
  perform set_config('request.jwt.claims', json_build_object('sub', v_doc, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  update public.care_plans set last_reviewed_at = now(), next_review_at = current_date + 90 where id = v_plan;
  get diagnostics v_n = row_count;
  if v_n <> 1 then execute 'reset role'; raise exception 'FAIL 1a: the tied doctor could not set review dates'; end if;
  insert into public.care_plan_interventions
    (organisation_id, patient_id, care_plan_id, description, category, why_text, when_text, how_text, created_by)
  values (v_org, v_pat, v_plan, 'Check your blood pressure at home', 'monitoring',
          'To see whether the new dose is working', 'Every morning before breakfast', 'Sit quietly for five minutes first', v_doc);
  select public.publish_care_plan_revision(v_plan, 'We added a morning blood pressure check.', true) into v_rev1;
  select public.publish_care_plan_revision(v_plan, 'We moved your next review to three months.', false) into v_rev2;
  execute 'reset role';
  select * into v_row from public.care_plan_revisions where id = v_rev1;
  if v_row.version_number <> 1 or not v_row.needs_acknowledgement or v_row.published_by <> v_doc
     or v_row.plan_snapshot -> 'actions' -> 0 ->> 'category' <> 'monitoring'
     or v_row.plan_snapshot -> 'actions' -> 0 ->> 'when' <> 'Every morning before breakfast'
     or v_row.plan_snapshot ->> 'next_review_at' is null then
    raise exception 'FAIL 1b: revision 1 wrong: %', row_to_json(v_row);
  end if;
  if (select version_number from public.care_plan_revisions where id = v_rev2) <> 2 then
    raise exception 'FAIL 1c: version numbers did not climb';
  end if;

  -- 2. a care coordinator and an untied doctor cannot publish
  foreach v_other in array array[v_coord, v_untied] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin
      perform public.publish_care_plan_revision(v_plan, 'Someone else tried to publish this.', true);
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 2: % published a revision', v_other; end if;
  end loop;

  -- 3. nobody writes a revision directly, not even the tied doctor or the patient
  foreach v_other in array array[v_doc, v_pat] loop
    perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
    execute 'set local role authenticated';
    v_failed := false;
    begin
      update public.care_plan_revisions set acknowledged_at = now(), acknowledged_by = v_pat where id = v_rev1;
    exception when insufficient_privilege then v_failed := true; end;
    if not v_failed then execute 'reset role'; raise exception 'FAIL 3a: % updated a revision directly', v_other; end if;
    v_failed := false;
    begin
      insert into public.care_plan_revisions (organisation_id, patient_id, care_plan_id, version_number, change_summary, plan_snapshot, published_by)
      values (v_org, v_pat, v_plan, 99, 'Direct insert attempt.', '{}', v_other);
    exception when insufficient_privilege then v_failed := true; end;
    execute 'reset role';
    if not v_failed then raise exception 'FAIL 3b: % inserted a revision directly', v_other; end if;
  end loop;

  -- 4. the supporter reads the revisions (same reach as the care plan) but cannot acknowledge
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.care_plan_revisions where care_plan_id = v_plan;
  if v_n <> 2 then execute 'reset role'; raise exception 'FAIL 4a: the supporter read % revisions, expected 2', v_n; end if;
  v_failed := false;
  begin
    perform public.acknowledge_care_plan_revision(v_rev1);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 4b: the supporter acknowledged the patient''s change'; end if;
  if (select acknowledged_at from public.care_plan_revisions where id = v_rev1) is not null then
    raise exception 'FAIL 4c: the supporter''s attempt left an acknowledgement';
  end if;

  -- control: an unrelated patient with no grant reads nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.care_plan_revisions where care_plan_id = v_plan;
  execute 'reset role';
  if v_n <> 0 then raise exception 'FAIL 4d: an unrelated patient read % revisions', v_n; end if;

  -- 5. the patient acknowledges their own change; a second click is harmless; a no-ack change cannot be acknowledged
  perform set_config('request.jwt.claims', json_build_object('sub', v_pat, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  perform public.acknowledge_care_plan_revision(v_rev1);
  perform public.acknowledge_care_plan_revision(v_rev1);
  v_failed := false;
  begin
    perform public.acknowledge_care_plan_revision(v_rev2);
  exception when invalid_parameter_value then v_failed := true; end;
  execute 'reset role';
  if not v_failed then raise exception 'FAIL 5a: a change that did not ask for it was acknowledged'; end if;
  select * into v_row from public.care_plan_revisions where id = v_rev1;
  if v_row.acknowledged_at is null or v_row.acknowledged_by <> v_pat then
    raise exception 'FAIL 5b: the patient''s acknowledgement was not recorded: %', row_to_json(v_row);
  end if;

  -- 6. anon has nothing
  if has_table_privilege('anon', 'public.care_plan_revisions', 'SELECT')
     or has_function_privilege('anon', 'public.acknowledge_care_plan_revision(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.publish_care_plan_revision(uuid, text, boolean)', 'EXECUTE') then
    raise exception 'FAIL 6: anon can reach care_plan_revisions';
  end if;

  -- SABOTAGE: without the patient check the supporter acknowledges, so check 4b would catch it
  update public.care_plan_revisions set acknowledged_at = null, acknowledged_by = null where id = v_rev1;
  create or replace function public.acknowledge_care_plan_revision(p_revision uuid)
  returns boolean language plpgsql security definer set search_path = '' as $sab$
  begin
    update public.care_plan_revisions r set acknowledged_at = now(), acknowledged_by = r.patient_id where r.id = p_revision;
    return true;
  end;
  $sab$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_sup, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  v_failed := false;
  begin
    perform public.acknowledge_care_plan_revision(v_rev1);
  exception when insufficient_privilege then v_failed := true; end;
  execute 'reset role';
  if v_failed then raise exception 'FAIL SABOTAGE: the unchecked version still refused, so check 4b proves nothing'; end if;

  raise notice 'PD-06 care plan revisions proof: all checks and the sabotage passed';
end;
$$;

rollback;

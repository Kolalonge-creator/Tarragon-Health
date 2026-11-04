-- ===========================================================================
-- Proof: D5, pregnancy and STI tests are sensitive for ACCESS (20261104194246_d5_pregnancy_sti_sensitive_access.sql)
--   A. A caregiver holding labs_results sees the patient's ordinary screening schedule, result, order and reading, and NOT the
--      antenatal-booking schedule, a result recorded with no order, an order raised from that schedule, a pregnancy-hormone reading, or a
--      syphilis schedule.
--   B. An emergency clinician (break-glass, another organisation) still sees everything: the founder kept OQ-S98-7.
--   C. The patient still sees everything; the release machinery is untouched (screen_types.sensitive on antenatal_booking stays false).
--   D. The emergency card keeps an STI condition off the card, like a pregnancy one; an ordinary condition is unaffected.
--   SABOTAGE: the screen rule reduced to the catalogue flag (antenatal shows); the analyte rule without pregnancy hormone (hCG shows); the
--   the caregiver branch of screening_results without the screen filter (the caregiver sees the antenatal result).
-- BEGIN/ROLLBACK; mints its own fixtures. Rows are written as the table owner with triggers off, so no result workflow runs.
-- ===========================================================================
begin;
create temp table results (phase text, check_name text, expected text, actual text);
grant all on results to public;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('sabotaged', p_name, p_expected, p_actual) $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.sees(p_uid uuid, p_rel text, p_id uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select case when exists (select 1 from %s where id = %L) then ''yes'' else ''no'' end', p_rel, p_id)) $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'd5-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex, is_test)
  values (v, p_org, p_role::public.user_role, 'D5 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - make_interval(years => 32))::date, 'female'::public.sex, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true,
     phone = excluded.phone, date_of_birth = excluded.date_of_birth, sex = excluded.sex;
  return v;
end $f$;

do $$
declare
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_org_b uuid := gen_random_uuid();
  p uuid; cc uuid; em uuid; a uuid; d text;
  s_hba1c uuid; s_ante uuid; s_syph uuid; r_hba1c uuid; r_ante uuid; o_plain uuid; o_ante uuid; l_hba1c uuid; l_hcg uuid;
begin
  insert into public.organisations (id, name, type) values (v_org_b, 'D5 Org B', 'direct_consumer');
  p := pg_temp.mkuser(v_org, 'patient', 'patient');
  cc := pg_temp.mkuser(v_org, 'caregiver', 'patient');
  em := pg_temp.mkuser(v_org_b, 'emergency', 'clinician');
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, clinical_access, permissions)
  values (p, cc, 'view', p, false, null) returning id into a;
  perform set_config('request.jwt.claims', json_build_object('sub', p::text, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p::text, true);
  set local role authenticated;
  perform public.set_care_access_categories(a, array['labs_results', 'medical_history']::public.care_access_category[]);
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  insert into public.emergency_record_access_grants (requester_id, requester_org_id, patient_id, patient_org_id, reason, expires_at)
  values (em, v_org_b, p, v_org, 'D5 proof fixture', now() + interval '1 hour');

  set local session_replication_role = replica;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, p, (select id from public.screen_types where code = 'hba1c'), 'pending', current_date + 10) returning id into s_hba1c;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, p, (select id from public.screen_types where code = 'antenatal_booking'), 'pending', current_date + 10) returning id into s_ante;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, p, (select id from public.screen_types where code = 'syphilis'), 'pending', current_date + 10) returning id into s_syph;
  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status) values (v_org, p, 'hba1c', 'normal') returning id into r_hba1c;
  insert into public.screening_results (organisation_id, patient_id, screen_type_code, result_status) values (v_org, p, 'antenatal_booking', 'normal') returning id into r_ante;
  insert into public.lab_orders (organisation_id, patient_id, panel_bundle_id, status, origin, fulfilment, total_kobo, ordered_at)
  values (v_org, p, (select id from public.panel_bundles where code = 'single_ferritin'), 'ordered', 'patient_initiated', 'self_arranged', 0, now()) returning id into o_plain;
  insert into public.lab_orders (organisation_id, patient_id, screening_schedule_id, status, origin, fulfilment, total_kobo, ordered_at)
  values (v_org, p, s_ante, 'ordered', 'patient_initiated', 'self_arranged', 0, now()) returning id into o_ante;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at) values (v_org, p, 'hba1c', 5.4, '%', now()) returning id into l_hba1c;
  insert into public.lab_analyte_readings (organisation_id, patient_id, code, value, unit, taken_at) values (v_org, p, 'beta_hcg', 1200, 'mIU/mL', now()) returning id into l_hcg;
  set local session_replication_role = origin;

  -- A. caregiver
  perform pg_temp.ck('A1 caregiver sees the ordinary schedule, result, order and reading', 'yes/yes/yes/yes',
    pg_temp.sees(cc, 'public.screening_schedules', s_hba1c) || '/' || pg_temp.sees(cc, 'public.screening_results', r_hba1c) || '/' ||
    pg_temp.sees(cc, 'public.lab_orders', o_plain) || '/' || pg_temp.sees(cc, 'public.lab_analyte_readings', l_hba1c));
  perform pg_temp.ck('A2 caregiver does not see the antenatal schedule (gap closed: schedules had no filter)', 'no', pg_temp.sees(cc, 'public.screening_schedules', s_ante));
  perform pg_temp.ck('A3 caregiver does not see an antenatal result recorded with no order (gap closed)', 'no', pg_temp.sees(cc, 'public.screening_results', r_ante));
  perform pg_temp.ck('A4 caregiver does not see an order raised from the antenatal schedule', 'no', pg_temp.sees(cc, 'public.lab_orders', o_ante));
  perform pg_temp.ck('A5 caregiver does not see a pregnancy-hormone reading', 'no', pg_temp.sees(cc, 'public.lab_analyte_readings', l_hcg));
  perform pg_temp.ck('A6 caregiver does not see a syphilis schedule', 'no', pg_temp.sees(cc, 'public.screening_schedules', s_syph));
  -- B. emergency access
  perform pg_temp.ck('B1 emergency reader sees the ordinary schedule, result, order and reading', 'yes/yes/yes/yes',
    pg_temp.sees(em, 'public.screening_schedules', s_hba1c) || '/' || pg_temp.sees(em, 'public.screening_results', r_hba1c) || '/' ||
    pg_temp.sees(em, 'public.lab_orders', o_plain) || '/' || pg_temp.sees(em, 'public.lab_analyte_readings', l_hba1c));
  perform pg_temp.ck('B2 an emergency clinician still sees the sensitive rows (OQ-S98-7 kept)', 'yes/yes/yes/yes/yes',
    pg_temp.sees(em, 'public.screening_schedules', s_ante) || '/' || pg_temp.sees(em, 'public.screening_results', r_ante) || '/' ||
    pg_temp.sees(em, 'public.lab_orders', o_ante) || '/' || pg_temp.sees(em, 'public.lab_analyte_readings', l_hcg) || '/' ||
    pg_temp.sees(em, 'public.screening_schedules', s_syph));
  -- C. the patient, and the release machinery
  perform pg_temp.ck('C1 the patient sees all of her own rows', 'yes/yes/yes/yes/yes',
    pg_temp.sees(p, 'public.screening_schedules', s_ante) || '/' || pg_temp.sees(p, 'public.screening_results', r_ante) || '/' ||
    pg_temp.sees(p, 'public.lab_orders', o_ante) || '/' || pg_temp.sees(p, 'public.lab_analyte_readings', l_hcg) || '/' ||
    pg_temp.sees(p, 'public.screening_schedules', s_syph));
  perform pg_temp.ck('C2 release machinery untouched: antenatal_booking is still not flagged sensitive in the catalogue', 'false',
    (select sensitive::text from public.screen_types where code = 'antenatal_booking'));
  -- D. the emergency card
  perform pg_temp.ck('D1 an STI condition is kept off the emergency card; hypertension is not', 'reproductive/reproductive/none',
    coalesce(private.emergency_card_sensitive_condition('Syphilis, treated 2020'), 'none') || '/' ||
    coalesce(private.emergency_card_sensitive_condition('Chlamydia'), 'none') || '/' ||
    coalesce(private.emergency_card_sensitive_condition('Hypertension'), 'none'));
  perform pg_temp.ck('D2 "constipation" is not mistaken for an STI', 'none', coalesce(private.emergency_card_sensitive_condition('Chronic constipation'), 'none'));

  -- ---------------- SABOTAGE ----------------
  begin
    create or replace function private.screen_code_access_sensitive(p_code text) returns boolean
      language sql stable security definer set search_path = '' as
      $f$ select exists (select 1 from public.screen_types st where st.sensitive and lower(st.code) = lower(p_code)) $f$;
    d := pg_temp.sees(cc, 'public.screening_schedules', s_ante);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 screen rule = catalogue flag only: the caregiver DOES see the antenatal schedule (flips A2)', 'yes', d);
  begin
    create or replace function private.analyte_access_sensitive(p_code text) returns boolean
      language sql stable security definer set search_path = '' as
      $f$ select p_code is null or private.lab_analyte_is_sensitive(p_code) or private.is_sensitive_analyte_code(p_code) $f$;
    d := pg_temp.sees(cc, 'public.lab_analyte_readings', l_hcg);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 analyte rule without pregnancy hormone: the caregiver DOES see the hCG reading (flips A5)', 'yes', d);
  begin
    drop policy screening_results_select on public.screening_results;
    create policy screening_results_select on public.screening_results for select to authenticated using (
      private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
      or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
      or ((not private.patient_result_blocked(screen_type_code, result_status))
          and ((patient_id = (select auth.uid()))
               or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
                    or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
                   and not private.lab_order_is_sensitive(lab_order_id)))));
    d := pg_temp.sees(cc, 'public.screening_results', r_ante);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 the pre-D5 result policy (order check only): the caregiver DOES see the antenatal result recorded with no order (flips A3)', 'yes', d);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'd5_pregnancy_sti_sensitive_access: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 15 then raise exception 'd5_pregnancy_sti_sensitive_access: fewer checks ran than expected'; end if;
end $$;
rollback;

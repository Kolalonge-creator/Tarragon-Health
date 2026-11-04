-- ===========================================================================
-- Proof: Care Circle Phase 2, investigations, test values, weight, yearly plan
--   20261104181057_care_circle_p2_investigations_weight_plan.sql
--
--   I. investigation_status: one row per everyday test in the plan with the right stage (due, overdue, requested, result_received,
--      awaiting_review, reviewed, done), a follow-up flag, and NO value. A sensitive test (HIV) and a reproductive one that is not flagged
--      sensitive (antenatal booking) never appear. A report the doctor has not reviewed is never "reviewed".
--   V. investigation_values (D2): only released AND reviewed results; never an HIV analyte, never pregnancy hormone, never a held result;
--      the lab's range and an in/out-of-range answer, nothing else.
--   W. weekly_weight_trend: weekly averages and a direction; gone when the sharing consent is withdrawn.
--   P. care_plan_progress: done / due / overdue counts of everyday tests only, and the next due date.
--   G. A supporter without the new permissions gets none of the new blocks; the patient's preview shows them; invites accept the new keys.
--   SABOTAGE: the test allow-list opened (HIV shows), the analyte filter opened (HIV value shows), an unreviewed result labelled reviewed.
-- BEGIN/ROLLBACK; fixtures are written as the table owner with triggers off (session_replication_role), so the proof does not depend on
-- the ordering, upload and release machinery, which have their own proofs.
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
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ccp2-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, 'Ccp ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.view(p_sup uuid, p_pat uuid) returns jsonb language sql as
$$ select pg_temp.q_as(p_sup, format('select public.circle_supporter_view(%L::uuid)::text', p_pat))::jsonb $$;
create function pg_temp.stage(v jsonb, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'stage' from jsonb_array_elements(coalesce(v -> 'investigations', '[]')) e where e ->> 'code' = p_code), 'absent') $$;
create function pg_temp.val(v jsonb, p_code text) returns text language sql as
$$ select coalesce((select e ->> 'value' from jsonb_array_elements(coalesce(v -> 'results', '[]')) e where e ->> 'code' = p_code), 'absent') $$;
-- a schedule for one test; returns its id
create function pg_temp.sched(p_pat uuid, p_code text, p_status text, p_due date) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into public.screening_schedules (id, organisation_id, patient_id, screen_type_id, status, due_date)
  values (v, (select organisation_id from public.profiles where id = p_pat), p_pat, (select id from public.screen_types where code = p_code),
          p_status::public.screening_status, p_due);
  return v;
end $f$;
create function pg_temp.order_for(p_pat uuid, p_sched uuid, p_status text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into public.lab_orders (id, organisation_id, patient_id, screening_schedule_id, status, total_kobo)
  values (v, (select organisation_id from public.profiles where id = p_pat), p_pat, p_sched, p_status::public.lab_order_status, 0);
  return v;
end $f$;
create function pg_temp.result(p_pat uuid, p_order uuid, p_state text, p_reviewed boolean) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into public.lab_results (id, organisation_id, patient_id, lab_order_id, panel_code, source, submitted_by_kind, received_at, release_state,
                                  release_reason, reviewed_at, released_at, is_test)
  values (v, (select organisation_id from public.profiles where id = p_pat), p_pat, p_order, 'membership_annual', 'pdf_upload', 'tarragon_team',
          now() - interval '2 days', p_state, case when p_state = 'released' then 'clinician_review' end, case when p_reviewed then now() - interval '1 day' end,
          case when p_state = 'released' then now() - interval '1 day' end, true);
  return v;
end $f$;
create function pg_temp.item(p_pat uuid, p_result uuid, p_code text, p_value numeric, p_low numeric, p_high numeric) returns void language sql as $$
  insert into public.lab_result_items (lab_result_id, organisation_id, patient_id, analyte_code, value_numeric, unit, ref_low, ref_high, flag, is_test)
  values (p_result, (select organisation_id from public.profiles where id = p_pat), p_pat, p_code, p_value, 'u', p_low, p_high,
          case when p_low is null or p_high is null then 'normal' when p_value < p_low then 'low' when p_value > p_high then 'high' else 'normal' end, true)
$$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; sup uuid; old uuid; v jsonb; r text; d text;
  s_hba1c uuid; s_lipid uuid; s_kft uuid; s_tft uuid; s_fbc uuid; s_hiv uuid; s_ante uuid; s_lft uuid;
  o_lipid uuid; o_tft uuid; o_fbc uuid; o_hiv uuid; o_lft uuid; r_fbc uuid; r_tft uuid; r_hiv uuid;
  v_all text[] := array['investigation_status', 'investigation_values', 'weekly_weight_trend', 'care_plan_progress'];
begin
  pat := pg_temp.mkuser(v_org, 'patient'); sup := pg_temp.mkuser(v_org, 'son'); old := pg_temp.mkuser(v_org, 'daughter');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, sup, 'Son', v_all, now() + interval '30 days', true),
         (v_org, pat, old, 'Daughter', array['appointments', 'weekly_bp_trend'], now() + interval '30 days', true);

  set local session_replication_role = replica;
  s_hba1c := pg_temp.sched(pat, 'hba1c', 'pending', current_date + 20);                       -- due
  s_lipid := pg_temp.sched(pat, 'lipid_panel', 'booked', current_date + 5);                  -- upload not reviewed
  s_kft   := pg_temp.sched(pat, 'kft', 'completed', current_date - 30);                       -- done
  s_tft   := pg_temp.sched(pat, 'tft', 'booked', current_date + 3);                           -- result held for review
  s_fbc   := pg_temp.sched(pat, 'fbc', 'booked', current_date + 2);                           -- released and reviewed
  s_lft   := pg_temp.sched(pat, 'lft', 'overdue', current_date - 10);                         -- overdue, requested
  s_hiv   := pg_temp.sched(pat, 'hiv', 'pending', current_date + 10);                         -- sensitive
  s_ante  := pg_temp.sched(pat, 'antenatal_booking', 'pending', current_date + 10);           -- reproductive, not flagged sensitive
  o_lipid := pg_temp.order_for(pat, s_lipid, 'ordered');
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source, acknowledgement_status)
  values (v_org, pat, o_lipid, 'x/lipid.pdf', 'lipid.pdf', 'application/pdf', 10, 'patient', 'new');
  o_tft := pg_temp.order_for(pat, s_tft, 'resulted');
  r_tft := pg_temp.result(pat, o_tft, 'awaiting_review', false);
  perform pg_temp.item(pat, r_tft, 'tsh', 2.1, 0.4, 4.0);
  o_fbc := pg_temp.order_for(pat, s_fbc, 'resulted');
  r_fbc := pg_temp.result(pat, o_fbc, 'released', true);
  perform pg_temp.item(pat, r_fbc, 'hba1c', 7.4, 4.0, 5.6);
  perform pg_temp.item(pat, r_fbc, 'haemoglobin', 13.2, 12.0, 16.0);
  perform pg_temp.item(pat, r_fbc, 'hiv_screen', 0, null, null);
  perform pg_temp.item(pat, r_fbc, 'beta_hcg', 2, 0, 5);
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source,
                                           acknowledgement_status, reviewed_at)
  values (v_org, pat, o_fbc, 'x/fbc.pdf', 'fbc.pdf', 'application/pdf', 10, 'patient', 'action_required', now());
  o_lft := pg_temp.order_for(pat, s_lft, 'ordered');
  o_hiv := pg_temp.order_for(pat, s_hiv, 'resulted');
  r_hiv := pg_temp.result(pat, o_hiv, 'released', true);
  perform pg_temp.item(pat, r_hiv, 'hiv', 1, null, null);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, taken_at, source)
  values (v_org, pat, 'weight', 82.0, now() - interval '20 days', 'device'), (v_org, pat, 'weight', 80.4, now() - interval '1 day', 'device');
  set local session_replication_role = origin;
  perform private.record_consent_cell(pat, v_org, true, 'vitals', 'care_circle_sharing', true, 'patient', null, pat);

  v := pg_temp.view(sup, pat);
  -- I. investigation status
  perform pg_temp.ck('I1 a test not yet requested is due', 'due', pg_temp.stage(v, 'hba1c'));
  perform pg_temp.ck('I2 an uploaded report the doctor has not looked at is result_received, not reviewed', 'result_received', pg_temp.stage(v, 'lipid_panel'));
  perform pg_temp.ck('I3 a completed test is done', 'done', pg_temp.stage(v, 'kft'));
  perform pg_temp.ck('I4 a result held for review is awaiting_review', 'awaiting_review', pg_temp.stage(v, 'tft'));
  perform pg_temp.ck('I5 a released, reviewed result is reviewed, and its follow-up flag is carried', 'reviewed/true',
    pg_temp.stage(v, 'fbc') || '/' || (select e ->> 'follow_up' from jsonb_array_elements(v -> 'investigations') e where e ->> 'code' = 'fbc'));
  perform pg_temp.ck('I6 an overdue test that has been requested shows requested', 'requested', pg_temp.stage(v, 'lft'));
  perform pg_temp.ck('I7 an HIV test never appears, not even as due', 'absent', pg_temp.stage(v, 'hiv'));
  perform pg_temp.ck('I8 an antenatal booking (not flagged sensitive) never appears', 'absent', pg_temp.stage(v, 'antenatal_booking'));
  perform pg_temp.ck('I9 a status row carries no value, only code, stage, due date and follow-up', 'code,due_date,follow_up,stage',
    (select string_agg(k, ',' order by k) from jsonb_object_keys(v -> 'investigations' -> 0) k));
  -- V. values
  perform pg_temp.ck('V1 a released, reviewed value is shown with its range and an in-range answer', '7.4/false/4.0/5.6',
    pg_temp.val(v, 'hba1c') || '/' || (select (e ->> 'in_range') || '/' || (e ->> 'ref_low') || '/' || (e ->> 'ref_high')
                                        from jsonb_array_elements(v -> 'results') e where e ->> 'code' = 'hba1c'));
  perform pg_temp.ck('V2 an ordinary value from the same result is shown', '13.2', pg_temp.val(v, 'haemoglobin'));
  perform pg_temp.ck('V3 an HIV analyte never appears (in a mixed panel or its own)', 'absent/absent', pg_temp.val(v, 'hiv_screen') || '/' || pg_temp.val(v, 'hiv'));
  perform pg_temp.ck('V4 pregnancy hormone never appears', 'absent', pg_temp.val(v, 'beta_hcg'));
  perform pg_temp.ck('V5 a value held for review never appears', 'absent', pg_temp.val(v, 'tsh'));
  -- W. weight
  perform pg_temp.ck('W1 weight shows weekly averages and a direction', 'true/lower',
    ((select count(*) from jsonb_array_elements(v #> '{weight_trend,weeks}') e where e ->> 'kg' is not null) = 2)::text || '/' || (v #>> '{weight_trend,direction}'));
  -- P. yearly plan
  perform pg_temp.ck('P1 plan progress counts everyday tests only (done kft; due hba1c, lipid, tft, fbc; overdue lft)', '1/4/1',
    (v #>> '{plan_progress,done}') || '/' || (v #>> '{plan_progress,due}') || '/' || (v #>> '{plan_progress,overdue}'));
  perform pg_temp.ck('P2 the next due date is the earliest upcoming everyday test (fbc), not the overdue one', (current_date + 2)::text, v #>> '{plan_progress,next_due}');
  -- G. who gets the blocks
  v := pg_temp.view(old, pat);
  perform pg_temp.ck('G1 a supporter without the new permissions gets none of the new blocks', 'false/false/false/false',
    (v ? 'investigations')::text || '/' || (v ? 'results')::text || '/' || (v ? 'weight_trend')::text || '/' || (v ? 'plan_progress')::text);
  r := pg_temp.q_as(pat, format('select public.circle_preview_permissions(%L::text[])::text', array['investigation_status']));
  perform pg_temp.ck('G2 the patient''s preview shows the investigations block before inviting', 'true', (r::jsonb ? 'investigations')::text);
  perform pg_temp.ck('G3 an invite with the new permissions is accepted', 'true',
    (pg_temp.q_as(pat, format($q$select public.create_care_circle_invite('email', 'ccp2-new@example.invalid', 'Niece', %L::text[])::text$q$,
                             array['investigation_status', 'care_plan_progress'])) like '{%')::text);
  perform private.record_consent_cell(pat, v_org, true, 'vitals', 'care_circle_sharing', false, 'patient', null, pat);
  v := pg_temp.view(sup, pat);
  perform pg_temp.ck('W2 sharing consent withdrawn: no weight; tests (not readings) still shown', 'false/true', (v ? 'weight_trend')::text || '/' || (v ? 'investigations')::text);
  perform private.record_consent_cell(pat, v_org, true, 'vitals', 'care_circle_sharing', true, 'patient', null, pat);

  -- ---------------- SABOTAGE ----------------
  begin
    create or replace function private.circle_screen_shareable(p_code text, p_sensitive boolean) returns boolean
      language sql immutable set search_path = '' as $f$ select true $f$;
    v := pg_temp.view(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 allow-list opened: the HIV test IS listed (flips I7)', 'reviewed', pg_temp.stage(v, 'hiv'));
  begin
    create or replace function private.circle_analyte_shareable(p_code text) returns boolean
      language sql stable set search_path = '' as $f$ select true $f$;
    v := pg_temp.view(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 analyte filter opened: the HIV value IS shown (flips V3)', '1', pg_temp.val(v, 'hiv'));
  begin
    select pg_get_functiondef('private.circle_care_blocks(uuid, text[])'::regprocedure) into d;
    d := replace(d, 'when d.id is not null then ''result_received''', 'when d.id is not null then ''reviewed''');
    if d = pg_get_functiondef('private.circle_care_blocks(uuid, text[])'::regprocedure) then raise exception 'sabotage S3 did not change the function'; end if;
    execute d;
    v := pg_temp.view(sup, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 an unreviewed upload labelled reviewed (flips I2)', 'reviewed', pg_temp.stage(v, 'lipid_panel'));
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_p2_investigations: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 24 then raise exception 'care_circle_p2_investigations: fewer checks ran than expected'; end if;
end $$;
rollback;

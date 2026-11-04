-- Proof: OD-05, a free outreach attendee's uploaded result goes to a doctor only when abnormal or not shown to be normal
-- (migration *_outreach_free_results_abnormal_only.sql).
--   A. Hold: a free attendee's own upload raises no alert and waits ('awaiting_confirmation'); a paid attendee's upload is
--      reviewed as before (alert at upload, nothing held).
--   B. Normal: every row read cleanly, confirmed by the patient and in the signed range -> screened normal, no alert.
--   C. To a doctor, each on its own: a number out of range; an HIV result on the report; a row the patient did not confirm;
--      a suspected critical value from the reading (at once, before any confirmation); a confirmed test not on the panel.
--      Each creates an alert linked to the document.
--   D. Safety net: still waiting after 7 days -> to a doctor; waiting less than 7 days -> untouched.
--   E. Privacy: the patient reads their own screening row; another patient reads none.
--   F. SABOTAGE: the free-order test forced false (the upload is reviewed at once again, so A was the hold); the
--      not-confirmed check removed (the omitted row now screens normal, so C3 was that check).
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; perform set_config('request.jwt.claims', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'ofr-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, sex)
  values (v, p_org, p_role::public.user_role, 'OFR ' || p_label, '+23482' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '40 years')::date, true, 'female')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = true, is_active = true,
    phone = excluded.phone, full_name = excluded.full_name, sex = excluded.sex;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR ' || sqlstate || ':' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the patient's own upload against an order, then the automatic reading of it
create function pg_temp.upload(p_patient uuid, p_order uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.lab_result_documents (organisation_id, patient_id, lab_order_id, file_path, original_filename, mime_type, file_size_bytes, source)
  select organisation_id, p_patient, p_order, p_patient || '/' || gen_random_uuid() || '.pdf', 'report.pdf', 'application/pdf', 1000, 'patient'
    from public.profiles where id = p_patient
  returning id into v;
  return v;
end $f$;
create function pg_temp.read(p_doc uuid, p_rows jsonb) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.lab_report_extractions (organisation_id, patient_id, document_id, status, rows, report_date)
  select organisation_id, patient_id, id, 'extracted', p_rows, current_date from public.lab_result_documents where id = p_doc
  returning id into v;
  return v;
end $f$;
-- the patient confirms numbers, then the deferred screen fires (as at commit)
create function pg_temp.confirm(p_patient uuid, p_extraction uuid, p_readings jsonb) returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.q_as(p_patient, format($q$select public.confirm_my_lab_report(%L, %L::jsonb, current_date)::text$q$, p_extraction, p_readings));
  set constraints all immediate;
  set constraints all deferred;
  return r;
end $f$;
create function pg_temp.state(p_doc uuid) returns text language sql as
$$ select coalesce((select state || '|' || coalesce(reason, '') from public.outreach_result_screenings where document_id = p_doc), 'none')
       || '|alert=' || (select (clinician_alert_id is not null)::text from public.lab_result_documents where id = p_doc) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_runner uuid; v_payer uuid; v_pf uuid; v_pp uuid; v_other uuid;
  v_free uuid; v_paid uuid; v_slot uuid; v_order_f uuid; v_order_p uuid; v_doc uuid; v_ext uuid; v_r text;
  ok_rows constant jsonb := '[{"code":"fasting_glucose","value":90,"unit":"mg/dL","status":"ready","reportedLabel":"FBS"},
                              {"code":"hba1c","value":5.2,"unit":"percent","status":"ready","reportedLabel":"HbA1c"}]';
  ok_confirm constant jsonb := '[{"code":"fasting_glucose","value":90},{"code":"hba1c","value":5.2}]';
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then select id into v_org from public.organisations order by created_at limit 1; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_payer := pg_temp.mkuser(v_org, 'payer', 'patient');
  v_pf := pg_temp.mkuser(v_org, 'free', 'patient');
  v_pp := pg_temp.mkuser(v_org, 'paid', 'patient');
  v_other := pg_temp.mkuser(v_org, 'other', 'patient');

  v_free := (pg_temp.q_as(v_admin, format($q$select public.create_outreach_day('outreach_free', 'OFR Church', null, 'Yaba', %L, 3) ->> 'screening_day_id'$q$, current_date + 3)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 3, 0)::text$q$, v_free));
  v_slot := (pg_temp.q_as(v_admin, format($q$select public.add_screening_day_slot(%L, 'Free one', null)::text$q$, v_free)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_slot, v_pf));
  v_order_f := (select lab_order_id from public.outreach_enrolments where slot_id = v_slot);

  v_paid := (pg_temp.q_as(v_admin, format($q$select public.create_outreach_day('outreach_paid', 'OFR Ltd', null, 'Ikeja', %L, 1) ->> 'screening_day_id'$q$, current_date + 3)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.confirm_screening_day(%L, 1, 0, %L)::text$q$, v_paid, v_payer));
  update public.screening_days set amount_paid_kobo = total_kobo where id = v_paid;
  v_slot := (pg_temp.q_as(v_admin, format($q$select public.add_screening_day_slot(%L, 'Paid one', null)::text$q$, v_paid)))::uuid;
  v_r := pg_temp.q_as(v_admin, format($q$select public.enrol_outreach_attendee(%L, %L)::text$q$, v_slot, v_pp));
  v_order_p := (select lab_order_id from public.outreach_enrolments where slot_id = v_slot);

  -- ===== A. Hold =====
  v_doc := pg_temp.upload(v_pf, v_order_f);
  perform pg_temp.rec('A1 a free attendee''s upload raises no alert and waits', 'awaiting_confirmation||alert=false', pg_temp.state(v_doc));
  v_doc := pg_temp.upload(v_pp, v_order_p);
  perform pg_temp.rec('A2 a paid attendee''s upload is reviewed as before (alert, nothing held)', 'none|alert=true', pg_temp.state(v_doc));

  -- ===== B. Normal =====
  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, ok_rows);
  v_r := pg_temp.confirm(v_pf, v_ext, ok_confirm);
  perform pg_temp.rec('B1 all rows clean, confirmed and in range: screened normal, no alert', 'screened_normal|all_confirmed_numbers_in_range|alert=false', pg_temp.state(v_doc));

  -- ===== C. To a doctor =====
  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, '[{"code":"fasting_glucose","value":180,"unit":"mg/dL","status":"ready","reportedLabel":"FBS"}]');
  v_r := pg_temp.confirm(v_pf, v_ext, '[{"code":"fasting_glucose","value":180}]');
  perform pg_temp.rec('C1 a number out of range goes to a doctor', 'sent_to_doctor|out_of_range_high|alert=true', pg_temp.state(v_doc));

  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, ok_rows || '[{"code":"hiv_screen","value":null,"valueText":"non-reactive","unit":null,"status":"ready","reportedLabel":"HIV"}]'::jsonb);
  v_r := pg_temp.confirm(v_pf, v_ext, ok_confirm);
  perform pg_temp.rec('C2 an HIV result on the report always goes to a doctor', 'sent_to_doctor|sensitive_test_on_report|alert=true', pg_temp.state(v_doc));

  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, ok_rows);
  v_r := pg_temp.confirm(v_pf, v_ext, '[{"code":"fasting_glucose","value":90}]');
  perform pg_temp.rec('C3 a row the patient did not confirm is not assumed normal', 'sent_to_doctor|row_not_confirmed|alert=true', pg_temp.state(v_doc));

  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, ok_rows);
  update public.lab_report_extractions set critical_suspected = true where id = v_ext;
  perform pg_temp.rec('C4 a suspected critical value goes to a doctor at once, before any confirmation', 'sent_to_doctor|critical_suspected|alert=true', pg_temp.state(v_doc));
  perform pg_temp.rec('C4b ...as an urgent alert', 'urgent_escalation',
    (select a.level::text from public.clinician_alerts a join public.lab_result_documents d on d.clinician_alert_id = a.id where d.id = v_doc));

  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, '[{"code":"urea","value":30,"unit":"mg/dL","status":"ready","reportedLabel":"Urea"}]');
  v_r := pg_temp.confirm(v_pf, v_ext, '[{"code":"urea","value":30}]');
  perform pg_temp.rec('C5 a confirmed test not on the yearly panel goes to a doctor', 'sent_to_doctor|test_not_on_panel|alert=true', pg_temp.state(v_doc));

  -- ===== D. Safety net =====
  v_doc := pg_temp.upload(v_pf, v_order_f);
  update public.outreach_result_screenings set created_at = now() - interval '8 days' where document_id = v_doc;
  perform private.outreach_result_screening_sweep();
  perform pg_temp.rec('D1 still waiting after 7 days goes to a doctor', 'sent_to_doctor|not_screened_within_7_days|alert=true', pg_temp.state(v_doc));
  v_doc := pg_temp.upload(v_pf, v_order_f);
  update public.outreach_result_screenings set created_at = now() - interval '6 days' where document_id = v_doc;
  perform private.outreach_result_screening_sweep();
  perform pg_temp.rec('D2 waiting under 7 days is left alone', 'awaiting_confirmation||alert=false', pg_temp.state(v_doc));
  perform pg_temp.rec('D3 the hourly sweep is scheduled', 'true', exists (select 1 from cron.job where jobname = 'outreach-result-screening-sweep' and active)::text);

  -- ===== E. Privacy =====
  perform pg_temp.rec('E1 the patient reads their own screening rows', 'true',
    ((pg_temp.q_as(v_pf, $q$select count(*)::text from public.outreach_result_screenings$q$))::int >= 7)::text);
  perform pg_temp.rec('E2 another patient reads none', '0', pg_temp.q_as(v_other, $q$select count(*)::text from public.outreach_result_screenings$q$));

  -- ===== F. SABOTAGE =====
  execute $s$ create or replace function private.is_free_outreach_order(p_order uuid) returns boolean language sql stable security definer set search_path = '' as $b$ select false $b$ $s$;
  v_doc := pg_temp.upload(v_pf, v_order_f);
  perform pg_temp.rec('F1 SABOTAGE free-order test forced false: the upload is reviewed at once (so A1 was the hold)', 'none|alert=true', pg_temp.state(v_doc));
  execute $s$ create or replace function private.is_free_outreach_order(p_order uuid) returns boolean language sql stable security definer set search_path = '' as $b$ select true $b$ $s$;
  execute replace(pg_get_functiondef('private.outreach_screen_result(uuid)'::regprocedure),
                  $x$perform private.outreach_send_result_to_doctor(p_document, 'row_not_confirmed'); return 'sent_to_doctor';$x$, 'null;');
  v_doc := pg_temp.upload(v_pf, v_order_f);
  v_ext := pg_temp.read(v_doc, ok_rows);
  v_r := pg_temp.confirm(v_pf, v_ext, '[{"code":"fasting_glucose","value":90}]');
  perform pg_temp.rec('F2 SABOTAGE not-confirmed check removed: the omitted row screens normal (so C3 was that check)', 'screened_normal|all_confirmed_numbers_in_range|alert=false', pg_temp.state(v_doc));

  if exists (select 1 from results where expected is distinct from actual) then
    raise exception 'outreach free results proof FAILED: %', (select string_agg(check_name || ' (expected ' || expected || ', got ' || coalesce(actual, 'null') || ')', E'\n') from results where expected is distinct from actual);
  end if;
  raise notice 'outreach free results abnormal-only: % checks PASSED', (select count(*) from results);
end $$;

select check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict from results order by 1;

rollback;

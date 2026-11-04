-- ===========================================================================
-- Proof: Care Circle Phase 4, family timeline and main/backup contact (20261104211059_care_circle_p4_timeline_contacts.sql)
--   A. Contacts: only the patient sets them; one main and one backup per circle (setting a new main moves it); the label grants nothing
--      (a contact without a permission still gets no block); the person sees their own label; every change is in the sharing history.
--   B. Timeline: a supporter with the matching permissions sees a released doctor's note, an attended and a missed appointment, an
--      everyday test requested and reviewed, and a help request asked for and done, newest first, with a source on each. Never a
--      sensitive appointment, a sensitive test, a request addressed to someone else, or a value. A supporter without those permissions
--      sees none of it; a stranger and a paused circle get "not found".
--   SABOTAGE: the timeline without the test allow-list (an HIV test shows); without the appointment filter (therapy shows); the contact
--   setter without the patient check (a supporter names themself main contact).
-- BEGIN/ROLLBACK; mints its own fixtures. Clinical rows are written as the table owner with triggers off.
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
  values (v, 'ccp4-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient'::public.user_role, initcap(p_label) || ' Ccp', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  update public.profiles set organisation_id = p_org where id = v;
  return v;
end $f$;
create function pg_temp.tl(p_uid uuid, p_pat uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format('select public.circle_supporter_timeline(%L::uuid)::text', p_pat)) $$;
create function pg_temp.kinds(p_tl text) returns text language sql as
$$ select coalesce(string_agg(e ->> 'kind' || coalesce(':' || (e ->> 'code'), ''), ',' order by e ->> 'kind', e ->> 'code'), '')
     from jsonb_array_elements(case when p_tl like '[%' then p_tl::jsonb else '[]'::jsonb end) e $$;

do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  pat uuid; son uuid; dau uuid; out_ uuid; m_son uuid; m_dau uuid; r text; t text; d text; v_staff uuid; v_appt uuid;
  s_hba1c uuid; s_hiv uuid; o_hba1c uuid; o_hiv uuid; tk_mine uuid; tk_other uuid;
begin
  pat := pg_temp.mkuser(v_org, 'patient'); son := pg_temp.mkuser(v_org, 'son'); dau := pg_temp.mkuser(v_org, 'daughter'); out_ := pg_temp.mkuser(v_org, 'stranger');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, son, 'Son', array['doctor_note', 'appointments', 'investigation_status', 'pay_for_care'], now() + interval '30 days', true)
  returning id into m_son;
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, pat, dau, 'Daughter', array['red_alerts'], now() + interval '30 days', true) returning id into m_dau;
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = pat, activation_note = 'p4 proof' where key = 'care_circle_tasks';

  -- A. contacts
  perform pg_temp.ck('A1 the patient names the son main contact and the daughter backup', 'true/true',
    pg_temp.q_as(pat, format('select public.set_circle_contact_role(%L::uuid, ''primary'')::text', m_son)) || '/' ||
    pg_temp.q_as(pat, format('select public.set_circle_contact_role(%L::uuid, ''backup'')::text', m_dau)));
  perform pg_temp.ck('A2 a supporter cannot name themself', 'false', pg_temp.q_as(dau, format('select public.set_circle_contact_role(%L::uuid, ''primary'')::text', m_dau)));
  perform pg_temp.ck('A3 an unknown label is refused', 'ERR:22023', pg_temp.q_as(pat, format('select public.set_circle_contact_role(%L::uuid, ''boss'')::text', m_son)));
  perform pg_temp.q_as(pat, format('select public.set_circle_contact_role(%L::uuid, ''primary'')::text', m_dau));
  perform pg_temp.ck('A4 naming a new main contact moves it: daughter main, son none', 'primary/none',
    (select contact_role from public.care_circle_members where id = m_dau) || '/' || coalesce((select contact_role from public.care_circle_members where id = m_son), 'none'));
  perform pg_temp.ck('A5 the daughter sees her own label; it grants her no block', 'primary/false',
    (pg_temp.q_as(dau, format('select public.circle_supporter_view(%L::uuid)::text', pat))::jsonb ->> 'contact_role') || '/' ||
    (pg_temp.q_as(dau, format('select public.circle_supporter_view(%L::uuid)::text', pat))::jsonb ? 'appointments')::text);
  perform pg_temp.ck('A6 the patient''s circle lists the label', 'primary',
    (select e ->> 'contact_role' from jsonb_array_elements(pg_temp.q_as(pat, 'select public.my_care_circle()::text')::jsonb -> 'members') e where e ->> 'member_id' = m_dau::text));
  perform pg_temp.ck('A7 every label change is in the sharing history', 'true',
    ((select count(*) from public.care_circle_permission_history where patient_id = pat
       and changes && array['contact_primary', 'contact_backup', 'contact_cleared']) >= 4)::text);

  -- B. timeline fixtures
  set local session_replication_role = replica;
  insert into public.clinical_staff (id, organisation_id, full_name, active) values (gen_random_uuid(), v_org, 'Ccp Doctor', false) returning id into v_staff;
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, completed_at)
  values (v_org, pat, now() - interval '10 days', now() - interval '10 days' + interval '30 minutes', 'completed', 'gp', 'telemedicine', now() - interval '10 days') returning id into v_appt;
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, no_show_marked_at)
  values (v_org, pat, now() - interval '5 days', now() - interval '5 days' + interval '30 minutes', 'no_show', 'gp', 'telemedicine', now() - interval '5 days');
  insert into public.appointments (organisation_id, patient_id, scheduled_for, ends_at, status, appointment_type, consultation_method, completed_at)
  values (v_org, pat, now() - interval '3 days', now() - interval '3 days' + interval '30 minutes', 'completed', 'therapy', 'telemedicine', now() - interval '3 days');
  insert into public.family_doctor_notes (organisation_id, patient_id, author_staff_id, appointment_id, body, is_test, released_at, released_by, share_decided_at)
  values (v_org, pat, v_staff, v_appt, 'Ccp note.', true, now() - interval '9 days', pat, now() - interval '9 days');
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, pat, (select id from public.screen_types where code = 'hba1c'), 'booked', current_date + 5) returning id into s_hba1c;
  insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, status, due_date)
  values (v_org, pat, (select id from public.screen_types where code = 'hiv'), 'booked', current_date + 5) returning id into s_hiv;
  insert into public.lab_orders (organisation_id, patient_id, screening_schedule_id, status, total_kobo) values (v_org, pat, s_hba1c, 'resulted', 0) returning id into o_hba1c;
  insert into public.lab_orders (organisation_id, patient_id, screening_schedule_id, status, total_kobo) values (v_org, pat, s_hiv, 'resulted', 0) returning id into o_hiv;
  insert into public.lab_results (organisation_id, patient_id, lab_order_id, panel_code, source, submitted_by_kind, received_at, release_state, release_reason, reviewed_at, released_at, is_test)
  values (v_org, pat, o_hba1c, 'membership_annual', 'pdf_upload', 'tarragon_team', now() - interval '2 days', 'released', 'clinician_review', now() - interval '1 day', now() - interval '1 day', true),
         (v_org, pat, o_hiv, 'membership_annual', 'pdf_upload', 'tarragon_team', now() - interval '2 days', 'released', 'clinician_review', now() - interval '1 day', now() - interval '1 day', true);
  insert into public.care_circle_tasks (organisation_id, patient_id, created_by, kind, state, done_at, is_test)
  values (v_org, pat, pat, 'visit', 'done', now() - interval '1 hour', true) returning id into tk_mine;
  insert into public.care_circle_tasks (organisation_id, patient_id, created_by, kind, recipients, is_test)
  values (v_org, pat, pat, 'transport', array[dau], true) returning id into tk_other;
  set local session_replication_role = origin;

  t := pg_temp.tl(son, pat);
  perform pg_temp.ck('B1 the son sees exactly the events his permissions allow',
    'appointment_attended,appointment_missed,doctor_note_shared,help_done:visit,help_requested:visit,test_requested:hba1c,test_reviewed:hba1c',
    pg_temp.kinds(t));
  perform pg_temp.ck('B2 newest first, each with a source, and no value or text anywhere', 'true/true/false',
    ((t::jsonb -> 0 ->> 'at')::timestamptz >= (t::jsonb -> 1 ->> 'at')::timestamptz)::text || '/' ||
    (select bool_and(e ? 'source') from jsonb_array_elements(t::jsonb) e)::text || '/' ||
    (t ~* 'Ccp note|value|note"|body')::text);
  perform pg_temp.ck('B3 the daughter (alerts only) sees only the request addressed to her', 'help_requested:transport', pg_temp.kinds(pg_temp.tl(dau, pat)));
  perform pg_temp.ck('B4 a stranger gets not found', 'ERR:P0002', pg_temp.tl(out_, pat));
  perform pg_temp.q_as(pat, 'select public.pause_care_circle(false)::text');
  perform pg_temp.ck('B5 a paused circle gives not found', 'ERR:P0002', pg_temp.tl(son, pat));
  perform pg_temp.q_as(pat, 'select public.resume_care_circle()::text');

  -- ---------------- SABOTAGE ----------------
  begin
    create or replace function private.circle_screen_shareable(p_code text, p_sensitive boolean) returns boolean
      language sql immutable set search_path = '' as $f$ select true $f$;
    d := pg_temp.kinds(pg_temp.tl(son, pat));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S1 allow-list opened: the HIV test IS in the timeline (flips B1)', 'true', (d like '%:hiv%')::text);
  begin
    create or replace function private.circle_appointment_shareable(p_type public.appointment_type, p_reason text, p_service text) returns boolean
      language sql immutable set search_path = '' as $f$ select true $f$;
    d := pg_temp.tl(son, pat);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S2 appointment filter opened: three appointments, including therapy (flips B1)', '3',
    (select count(*)::text from jsonb_array_elements(d::jsonb) e where e ->> 'kind' like 'appointment_%'));
  begin
    select pg_get_functiondef('public.set_circle_contact_role(uuid, text)'::regprocedure) into d;
    d := replace(d, 'where id = p_member and patient_id = v_uid and state', 'where id = p_member and state');
    if d = pg_get_functiondef('public.set_circle_contact_role(uuid, text)'::regprocedure) then raise exception 'sabotage S3 did not change the function'; end if;
    execute d;
    d := pg_temp.q_as(son, format('select public.set_circle_contact_role(%L::uuid, ''backup'')::text', m_son));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.sk('S3 patient check removed: a supporter DOES name themself (flips A2)', 'true', d);
end $$;

select phase, check_name, expected, actual, case when expected is not distinct from actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;
do $$
declare n integer;
begin
  select count(*) into n from results where expected is distinct from actual;
  if n > 0 then raise exception 'care_circle_p4_timeline_contacts: % check(s) did not hold', n; end if;
  if (select count(*) from results) < 15 then raise exception 'care_circle_p4_timeline_contacts: fewer checks ran than expected'; end if;
end $$;
rollback;

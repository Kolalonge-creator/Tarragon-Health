-- HR Phase A (migration *_hr_people_phase_a_employment_records.sql; decisions HR-01 to HR-04). One rolled-back transaction.
--
--   1. Shape: anon runs none of the functions; authenticated may read departments and employment rows but never write them,
--      and has no table access at all to staff_sensitive_details.
--   2. A clinician (not admin) cannot record an employment change, read the directory or another person's personal details.
--   3. An admin records an appointment; a second appointment is refused; a non-appointment first record is refused; a
--      leaving change with no note is refused; a reporting loop is refused; a clinician's employed/contracted value is refused
--      (clinical_staff owns it); history rows cannot be updated or deleted, even by the table owner path.
--   4. Reads: the person reads their own rows; their line manager reads them; an unrelated colleague reads none; the
--      directory shows the current job title after a transfer; a future-dated change is not yet current.
--   5. Personal details: the person sets contact and address but not the national ID; an admin sets the ID; an admin's read
--      writes a staff_personal_details.viewed audit row, the person's own read does not; audit rows never carry values.
--   6. SABOTAGE: the employment read policy opened to everyone, and the admin check removed from the write function; the
--      matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'hr-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'HR ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_mgr uuid; v_staff uuid; v_other uuid; v_clin uuid; v_dept uuid; v_dept2 uuid; v_rec uuid;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_mgr := pg_temp.mkuser(v_org, 'manager', 'finance');
  v_staff := pg_temp.mkuser(v_org, 'staff', 'analyst');
  v_other := pg_temp.mkuser(v_org, 'other', 'analyst');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, employment_type, active, is_test)
  values (v_clin, v_org, 'HR clinician', 'senior_medical_officer', 'employed', false, true);
  insert into fx values ('admin', v_admin), ('manager', v_mgr), ('staff', v_staff), ('other', v_other), ('clinician', v_clin);

  -- 1. Shape
  perform pg_temp.rec('anon runs none of the HR functions', '0',
    (select count(*)::text from unnest(array['public.people_directory()', 'public.people_recent_activity(integer)',
       'public.staff_personal_details(uuid)', 'public.set_staff_personal_details(uuid,text,text,text,text,text)',
       'public.save_staff_department(uuid,text,text,uuid,boolean)',
       'public.record_staff_employment_change(uuid,text,date,text,text,text,date,uuid,uuid,text,date,numeric,text,text)']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE')));
  perform pg_temp.rec('authenticated reads but never writes employment rows; no access to sensitive details', 'true|false|false|false',
    has_table_privilege('authenticated', 'public.staff_employment_records', 'SELECT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_employment_records', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_sensitive_details', 'SELECT')::text || '|' ||
    has_function_privilege('authenticated', 'private.staff_current_employment()', 'EXECUTE')::text);

  -- 3. Admin writes
  perform pg_temp.act(v_admin);
  v_dept := public.save_staff_department(null, 'HR proof operations');
  v_dept2 := public.save_staff_department(null, 'HR proof finance');
  perform public.record_staff_employment_change(v_mgr, 'appointment', v_today - 30, 'Finance lead', 'full_time', 'active', v_today - 30,
    v_dept2, null, 'employed');
  perform pg_temp.rec('a first record that is not an appointment is refused', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'transfer', %L, 'Analyst', 'full_time', 'active', %L, null, null, 'employed')$q$, v_staff, v_today, v_today)));
  v_rec := public.record_staff_employment_change(v_staff, 'appointment', v_today - 10, 'Data analyst', 'full_time', 'active', v_today - 10,
    v_dept, v_mgr, 'employed', v_today + 40);
  perform pg_temp.rec('a second appointment while current is refused', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'appointment', %L, 'Analyst', 'full_time', 'active', %L, null, null, 'employed')$q$, v_staff, v_today, v_today)));
  perform pg_temp.rec('leaving with no note is refused', '23514',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'resignation', %L, 'Data analyst', 'full_time', 'left', %L, null, null, 'employed')$q$, v_staff, v_today, v_today - 10)));
  perform pg_temp.rec('a reporting loop is refused', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'manager_change', %L, 'Finance lead', 'full_time', 'active', %L, %L, %L, 'employed')$q$, v_mgr, v_today, v_today - 30, v_dept2, v_staff)));
  perform pg_temp.rec('a clinician''s employed/contracted value is refused here', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'appointment', %L, 'Doctor', 'full_time', 'active', %L, null, null, 'employed')$q$, v_clin, v_today, v_today)));
  perform pg_temp.rec('a clinician without an engagement value is accepted', 'ok',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'appointment', %L, 'Senior medical officer', 'full_time', 'active', %L)$q$, v_clin, v_today, v_today)));
  -- a transfer today and a future-dated promotion
  perform public.record_staff_employment_change(v_staff, 'transfer', v_today, 'Senior data analyst', 'full_time', 'active', v_today - 10,
    v_dept2, v_mgr, 'employed', v_today + 40);
  perform public.record_staff_employment_change(v_staff, 'promotion', v_today + 20, 'Head of data', 'full_time', 'active', v_today - 10,
    v_dept2, v_mgr, 'employed', v_today + 40);
  perform pg_temp.rec('the directory shows the current title (transfer in force, promotion not yet)', 'Senior data analyst|HR proof finance',
    (select job_title || '|' || department_name from public.people_directory() where profile_id = v_staff));
  perform pg_temp.rec('the directory gives the clinician''s engagement from clinical_staff', 'employed',
    (select engagement from public.people_directory() where profile_id = v_clin));
  perform pg_temp.rec('return to work is refused for someone not suspended', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'return_to_work', %L, 'Senior data analyst', 'full_time', 'active', %L, null, %L, 'employed')$q$, v_staff, v_today, v_today - 10, v_mgr)));
  perform public.record_staff_employment_change(v_mgr, 'resignation', v_today, 'Finance lead', 'full_time', 'left', v_today - 30,
    v_dept2, null, 'employed', null, null, null, 'Resigned to relocate abroad.');
  perform pg_temp.rec('a correction cannot bring a leaver back', 'P0001',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'correction', %L, 'Finance lead', 'full_time', 'active', %L, null, null, 'employed')$q$, v_mgr, v_today, v_today - 30)));
  perform pg_temp.rec('the directory reports credentialing''s own verdicts (test row counts as verified; inactive so not cleared)', 'true|false|false',
    (select verification_satisfied::text || '|' || cleared_to_practise::text || '|' || indemnity_required::text
       from public.people_directory() where profile_id = v_clin));
  perform pg_temp.back();
  -- someone with an HR engagement later given a clinical_staff row: clinical_staff wins
  perform pg_temp.act(v_admin);
  perform public.record_staff_employment_change(v_other, 'appointment', v_today - 5, 'Analyst', 'full_time', 'active', v_today - 5,
    null, null, 'employed');
  perform pg_temp.back();
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, employment_type, active, is_test)
  values (v_other, (select organisation_id from public.profiles where id = v_other), 'HR other', 'senior_medical_officer', 'contracted', false, true);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a clinician''s engagement always comes from clinical_staff', 'contracted',
    (select engagement from public.people_directory() where profile_id = v_other));
  perform pg_temp.back();
  delete from public.clinical_staff where profile_id = v_other;
  perform pg_temp.rec('history rows cannot be updated', '42501',
    pg_temp.try(format('update public.staff_employment_records set job_title = %L where id = %L', 'Changed', v_rec)));
  perform pg_temp.rec('history rows cannot be deleted', '42501',
    pg_temp.try(format('delete from public.staff_employment_records where id = %L', v_rec)));

  -- 2. A clinician is not an admin
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('a clinician cannot record an employment change', '42501',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'transfer', %L, 'X', 'full_time', 'active', %L, null, null, 'employed')$q$, v_staff, v_today, v_today)));
  perform pg_temp.rec('a clinician cannot read the directory', '42501', pg_temp.try('select * from public.people_directory()'));
  perform pg_temp.rec('a clinician cannot read another person''s personal details', '42501',
    pg_temp.try(format('select public.staff_personal_details(%L)', v_staff)));
  perform pg_temp.back();

  -- 4. Row reads
  perform pg_temp.act(v_staff);
  perform pg_temp.rec('the person reads their own employment rows', '3',
    (select count(*)::text from public.staff_employment_records where profile_id = v_staff));
  perform pg_temp.back();
  perform pg_temp.act(v_mgr);
  perform pg_temp.rec('the line manager does not read their report''s rows (notes may be disciplinary)', '0',
    (select count(*)::text from public.staff_employment_records where profile_id = v_staff));
  perform pg_temp.back();
  perform pg_temp.act(v_other);
  perform pg_temp.rec('an unrelated colleague reads none', '0',
    (select count(*)::text from public.staff_employment_records where profile_id = v_staff));
  perform pg_temp.rec('an unrelated colleague reads no departments', '0',
    (select count(*)::text from public.staff_departments where id = v_dept));
  perform pg_temp.back();

  -- 5. Personal details
  perform pg_temp.act(v_staff);
  perform public.set_staff_personal_details(v_staff, 'Ada Obi', 'Sister', '+2348031234567', '12 Example Road, Lagos', null);
  perform pg_temp.rec('the person cannot set their national ID', '42501',
    pg_temp.try(format($q$select public.set_staff_personal_details(%L, 'Ada Obi', 'Sister', '+2348031234567', '12 Example Road, Lagos', '12345678901')$q$, v_staff)));
  perform pg_temp.rec('the person reads their own details without an access audit row', 'Ada Obi|0',
    (public.staff_personal_details(v_staff) ->> 'emergency_contact_name') || '|' ||
    (select count(*)::text from public.audit_log where action = 'staff_personal_details.viewed' and entity_id = v_staff));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.set_staff_personal_details(v_staff, 'Ada Obi', 'Sister', '+2348031234567', '12 Example Road, Lagos', '12345678901');
  perform pg_temp.rec('an admin reads the ID', '12345678901', public.staff_personal_details(v_staff) ->> 'national_id_number');
  perform pg_temp.rec('the admin''s read is audited', '1',
    (select count(*)::text from public.audit_log where action = 'staff_personal_details.viewed' and entity_id = v_staff));
  perform public.staff_personal_details(v_staff);
  perform pg_temp.rec('a repeat read by the same admin within 10 minutes is logged once', '1',
    (select count(*)::text from public.audit_log where action = 'staff_personal_details.viewed' and entity_id = v_staff));
  perform pg_temp.rec('a malformed emergency phone is refused', '23514',
    pg_temp.try(format($q$select public.set_staff_personal_details(%L, 'Ada Obi', 'Sister', '08031234567', '12 Example Road, Lagos', '12345678901')$q$, v_staff)));
  perform pg_temp.back();
  perform pg_temp.rec('audit rows for personal details never carry the values', '0',
    (select count(*)::text from public.audit_log where entity_id = v_staff and entity_type = 'staff_sensitive_details'
      and (event::text like '%12345678901%' or event::text like '%Example Road%' or event::text like '%2348031234567%')));
end $$;

-- 6. Sabotage
do $$
declare v_admin uuid; v_staff uuid; v_other uuid; v_today date := (now() at time zone 'Africa/Lagos')::date;
begin
  select id into v_admin from fx where label = 'admin';
  select id into v_staff from fx where label = 'staff';
  select id into v_other from fx where label = 'other';
  -- sabotage 1: the read policy opened to everyone
  drop policy staff_employment_records_read on public.staff_employment_records;
  create policy staff_employment_records_read on public.staff_employment_records for select to authenticated using (true);
  perform pg_temp.act(v_other);
  insert into results values ('sabotaged', 'an unrelated colleague reads none', '0',
    (select count(*)::text from public.staff_employment_records where profile_id = v_staff));
  perform pg_temp.back();
  -- sabotage 2: the admin check removed from the write function
  create or replace function public.record_staff_employment_change(
    p_profile uuid, p_change_kind text, p_effective_from date, p_job_title text, p_work_pattern text, p_employment_status text,
    p_start_date date, p_department uuid default null, p_line_manager uuid default null, p_engagement text default null,
    p_contract_end_date date default null, p_contracted_hours numeric default null, p_work_location text default null,
    p_note text default null) returns uuid
  language plpgsql security definer set search_path = '' as $f$
  declare v_id uuid;
  begin
    insert into public.staff_employment_records (organisation_id, profile_id, change_kind, effective_from, job_title, engagement,
      work_pattern, employment_status, start_date, recorded_by)
    select organisation_id, p_profile, p_change_kind, p_effective_from, p_job_title, p_engagement, p_work_pattern, p_employment_status,
           p_start_date, auth.uid() from public.profiles where id = p_profile
    returning id into v_id;
    return v_id;
  end $f$;
  perform pg_temp.act(v_other);
  insert into results values ('sabotaged', 'a non-admin cannot record an employment change', '42501',
    pg_temp.try(format($q$select public.record_staff_employment_change(%L, 'hours_change', %L, 'X', 'part_time', 'active', %L, null, null, 'employed')$q$, v_staff, v_today, v_today - 10)));
  perform pg_temp.back();
end $$;

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'hr_people_phase_a_employment_records FAILED: %', v_bad; end if;
  if (select count(*) from results where phase = 'real') <> 30 then
    raise exception 'hr_people_phase_a_employment_records: expected 30 checks, got %', (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end end as result
from results order by phase, check_name;

rollback;

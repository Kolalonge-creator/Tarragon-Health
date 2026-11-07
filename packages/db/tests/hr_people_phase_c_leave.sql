-- HR Phase C leave (migration *_hr_people_phase_c_leave.sql; decisions HR-03, HR-04). One rolled-back transaction.
--
--   1. Shape: anon runs nothing; authenticated reads requests but never writes them, and has no access to sickness reasons.
--   2. Requests: only active internal staff ask; no past-dated leave except sick (up to 30 days back); no overlaps.
--   3. Who decides: the line manager (and is told); with no manager, admins (and they are told); never the person themself;
--      a colleague cannot; a reject needs a reason.
--   4. Approving a clinician's leave writes provider_time_off ('leave', reason NULL) and cancels their booking in the period,
--      only when the approver confirmed the same number of cancellations; a stale number is refused and nothing changes.
--   5. The sickness reason: the person and an admin read it (the admin's read is audited); the line manager cannot.
--   6. Reads: the person, their manager and admins see a request; a colleague sees none.
--   7. Cancelling approved leave before it starts removes the time-off row. Requests are never edited directly or deleted.
--   8. SABOTAGE: the self-decision check removed, and the request read policy opened to everyone.
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
  values (v, 'hrc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'HRC ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_admin2 uuid; v_mgr uuid; v_staff uuid; v_col uuid; v_clin uuid; v_patient uuid;
  v_today date := (now() at time zone 'Africa/Lagos')::date; v_req uuid; v_sick uuid; v_creq uuid; v_appt uuid; v_impact integer; v_sreq uuid; v_pappt uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_admin2 := pg_temp.mkuser(v_org, 'admin2', 'admin');
  v_mgr := pg_temp.mkuser(v_org, 'manager', 'finance');
  v_staff := pg_temp.mkuser(v_org, 'staff', 'analyst');
  v_col := pg_temp.mkuser(v_org, 'colleague', 'analyst');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  insert into public.clinical_staff (profile_id, organisation_id, full_name, doctor_tier, employment_type, active, is_test)
  values (v_clin, v_org, 'HRC clinician', 'senior_medical_officer', 'employed', false, true);
  insert into fx values ('admin', v_admin), ('admin2', v_admin2), ('manager', v_mgr), ('staff', v_staff), ('colleague', v_col), ('clinician', v_clin);
  perform pg_temp.act(v_admin);
  perform public.record_staff_employment_change(v_mgr, 'appointment', v_today - 100, 'Finance lead', 'full_time', 'active', v_today - 100, null, null, 'employed');
  perform public.record_staff_employment_change(v_staff, 'appointment', v_today - 50, 'Analyst', 'full_time', 'active', v_today - 50, null, v_mgr, 'employed');
  perform pg_temp.back();

  -- 1. Shape
  perform pg_temp.rec('anon runs none of the leave functions; authenticated cannot write requests or read sickness reasons', '0|false|false|false',
    (select count(*)::text from unnest(array['public.request_leave(text,date,date,text,text)', 'public.cancel_leave(uuid)', 'public.decide_leave(uuid,text,text,integer)',
       'public.leave_request_impact(uuid)', 'public.leave_requests_to_decide()', 'public.leave_sickness_reason(uuid)', 'public.people_leave_requests(date)']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE')) || '|' ||
    has_table_privilege('authenticated', 'public.staff_leave_requests', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_leave_requests', 'UPDATE')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_leave_sickness_reasons', 'SELECT')::text);

  -- 2. Requests
  -- with every other admin switched off and no line manager, an admin's own request is refused at once, with what to do
  update public.profiles set is_active = false where role = 'admin' and organisation_id = v_org and id <> v_admin;
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a request nobody could approve is refused up front', 'P0001',
    pg_temp.try(format($q$select public.request_leave('annual', %L, %L)$q$, v_today + 40, v_today + 41)));
  perform pg_temp.back();
  update public.profiles set is_active = true where id = v_admin2;
  perform pg_temp.act(v_patient);
  perform pg_temp.rec('a patient cannot ask for staff leave', '42501', pg_temp.try(format($q$select public.request_leave('annual', %L, %L)$q$, v_today + 10, v_today + 12)));
  perform pg_temp.back();
  perform pg_temp.act(v_staff);
  perform pg_temp.rec('annual leave in the past is refused', 'P0001', pg_temp.try(format($q$select public.request_leave('annual', %L, %L)$q$, v_today - 3, v_today - 1)));
  v_req := public.request_leave('annual', v_today + 10, v_today + 16, 'Family trip');
  perform pg_temp.rec('an overlapping request is refused', 'P0001', pg_temp.try(format($q$select public.request_leave('study', %L, %L)$q$, v_today + 16, v_today + 18)));
  v_sick := public.request_leave('sick', v_today - 5, v_today - 4, null, 'Flu with fever');
  perform pg_temp.rec('sick leave can be recorded afterwards, with its reason kept', 'Flu with fever', public.leave_sickness_reason(v_sick));
  perform pg_temp.rec('the person cannot decide their own leave', '42501', pg_temp.try(format($q$select public.decide_leave(%L, 'approved')$q$, v_req)));
  perform pg_temp.back();
  perform pg_temp.rec('working days count Monday to Friday', private.leave_working_days(v_today + 10, v_today + 16)::text,
    (select working_days::text from public.staff_leave_requests where id = v_req));
  perform pg_temp.rec('the line manager is told, admins are not', '1|0',
    (select count(*)::text from public.notifications where template = 'staff_leave_requested' and recipient_id = v_mgr and payload ->> 'request_id' = v_req::text) || '|' ||
    (select count(*)::text from public.notifications where template = 'staff_leave_requested' and recipient_id = v_admin and payload ->> 'request_id' = v_req::text));

  -- 3/5/6. Manager and colleague
  perform pg_temp.act(v_col);
  perform pg_temp.rec('a colleague cannot decide', '42501', pg_temp.try(format($q$select public.decide_leave(%L, 'approved')$q$, v_req)));
  perform pg_temp.rec('a colleague reads none of the requests', '0', (select count(*)::text from public.staff_leave_requests where profile_id = v_staff));
  perform pg_temp.back();
  perform pg_temp.act(v_mgr);
  perform pg_temp.rec('the manager sees both requests and has them to decide', '2|2',
    (select count(*)::text from public.staff_leave_requests where profile_id = v_staff) || '|' ||
    (select count(*)::text from public.leave_requests_to_decide() where profile_id = v_staff));
  perform pg_temp.rec('the manager cannot read the sickness reason', '42501', pg_temp.try(format('select public.leave_sickness_reason(%L)', v_sick)));
  perform pg_temp.rec('a reject needs a reason', 'P0001', pg_temp.try(format($q$select public.decide_leave(%L, 'rejected', 'no')$q$, v_req)));
  perform public.decide_leave(v_req, 'approved', null, 0);
  perform pg_temp.back();
  perform pg_temp.rec('approving a non-clinician writes no time-off row and tells the person', 'approved|null|1',
    (select status || '|' || coalesce(provider_time_off_id::text, 'null') from public.staff_leave_requests where id = v_req) || '|' ||
    (select count(*)::text from public.notifications where template = 'staff_leave_decided' and recipient_id = v_staff));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin reads the sickness reason', 'Flu with fever', public.leave_sickness_reason(v_sick));
  perform pg_temp.back();
  perform pg_temp.rec('the admin''s read of the sickness reason is audited', '1',
    (select count(*)::text from public.audit_log where action = 'staff_leave.sickness_reason_viewed' and entity_id = v_sick));

  -- 4. A clinician with no manager: admins are told and decide; the cascade cancels the booking
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, appointment_type, consultation_method, status)
  values (v_org, v_patient, v_clin, (v_today + 21)::timestamp at time zone 'Africa/Lagos' + interval '10 hours',
          (v_today + 21)::timestamp at time zone 'Africa/Lagos' + interval '10 hours 30 minutes', 'gp', 'in_person', 'booked')
  returning id into v_appt;
  perform set_config('tarragon.lead_write', 'on', true);
  insert into public.on_call_rota (organisation_id, starts_at, ends_at, primary_clinician_id, is_test)
  values (v_org, (v_today + 21)::timestamp at time zone 'Africa/Lagos', (v_today + 21)::timestamp at time zone 'Africa/Lagos' + interval '12 hours', v_clin, true);
  perform set_config('tarragon.lead_write', '', true);
  perform pg_temp.act(v_clin);
  v_creq := public.request_leave('annual', v_today + 20, v_today + 22);
  perform pg_temp.back();
  perform pg_temp.rec('with no manager, every active admin is told', '1|1',
    (select count(*)::text from public.notifications where template = 'staff_leave_requested' and recipient_id = v_admin and payload ->> 'request_id' = v_creq::text) || '|' ||
    (select count(*)::text from public.notifications where template = 'staff_leave_requested' and recipient_id = v_admin2 and payload ->> 'request_id' = v_creq::text));
  perform pg_temp.act(v_admin);
  v_impact := public.leave_request_impact(v_creq);
  perform pg_temp.rec('the approver is shown the booking that would be cancelled', '1', v_impact::text);
  perform pg_temp.rec('the approver is shown the on-call shift in the period', '1', public.leave_request_rota_shifts(v_creq)::text);
  perform pg_temp.rec('approval with a stale cancellation count is refused', 'P0001',
    pg_temp.try(format($q$select public.decide_leave(%L, 'approved', null, 0)$q$, v_creq)));
  perform pg_temp.back();
  perform pg_temp.rec('the refused approval changed nothing', 'pending|booked|0',
    (select status from public.staff_leave_requests where id = v_creq) || '|' || (select status::text from public.appointments where id = v_appt) || '|' ||
    (select count(*)::text from public.provider_time_off where clinician_id = v_clin));
  perform pg_temp.act(v_admin);
  perform public.decide_leave(v_creq, 'approved', null, 1);
  perform pg_temp.back();
  perform pg_temp.rec('approval writes the time-off row with no reason, and the booking is cancelled', 'leave|null|provider_cancelled',
    (select t.kind || '|' || coalesce(t.reason, 'null') from public.provider_time_off t join public.staff_leave_requests r on r.provider_time_off_id = t.id where r.id = v_creq)
    || '|' || (select status::text from public.appointments where id = v_appt));
  perform pg_temp.rec('the patient notice carries the neutral default, not the leave type', 'Your provider is on leave for this time',
    (select payload ->> 'reason' from public.notifications where template = 'appointment_provider_cancelled' and payload ->> 'appointment_id' = v_appt::text));

  -- back-dated sick leave for a clinician never touches a past booking, but blocks routing for the days still to come
  insert into public.appointments (organisation_id, patient_id, clinician_id, scheduled_for, ends_at, appointment_type, consultation_method, status)
  values (v_org, v_patient, v_clin, (v_today - 2)::timestamp at time zone 'Africa/Lagos' + interval '10 hours',
          (v_today - 2)::timestamp at time zone 'Africa/Lagos' + interval '10 hours 30 minutes', 'gp', 'in_person', 'booked')
  returning id into v_pappt;
  perform pg_temp.act(v_clin);
  v_sreq := public.request_leave('sick', v_today - 3, v_today + 1);
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('back-dated sick leave counts no past booking', '0', public.leave_request_impact(v_sreq)::text);
  perform public.decide_leave(v_sreq, 'approved', null, 0);
  perform pg_temp.back();
  perform pg_temp.rec('approval leaves the past booking alone and blocks only from now on', 'booked|true',
    (select status::text from public.appointments where id = v_pappt) || '|' ||
    (select (t.starts_at >= now() - interval '1 minute')::text from public.provider_time_off t join public.staff_leave_requests r on r.provider_time_off_id = t.id where r.id = v_sreq));
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('leave that has started cannot be cancelled by the person', 'P0001', pg_temp.try(format('select public.cancel_leave(%L)', v_sreq)));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform public.cancel_leave(v_sreq);
  perform pg_temp.back();

  -- 7. Cancelling and the guard
  perform pg_temp.act(v_clin);
  perform public.cancel_leave(v_creq);
  perform pg_temp.back();
  perform pg_temp.rec('cancelling approved leave before it starts removes the time-off row', 'cancelled|0',
    (select status from public.staff_leave_requests where id = v_creq) || '|' || (select count(*)::text from public.provider_time_off where clinician_id = v_clin));
  perform pg_temp.rec('a request cannot be edited directly', '42501',
    pg_temp.try(format($q$update public.staff_leave_requests set status = 'approved' where id = %L$q$, v_sick)));
  perform pg_temp.rec('a request cannot be deleted', '42501', pg_temp.try(format('delete from public.staff_leave_requests where id = %L', v_sick)));
end $$;

-- 8. Sabotage
do $$
declare v_staff uuid; v_col uuid; v_r uuid;
begin
  select id into v_staff from fx where label = 'staff';
  select id into v_col from fx where label = 'colleague';
  select id into v_r from public.staff_leave_requests where profile_id = v_staff and leave_type = 'sick';
  -- sabotage 1: the self-decision check removed (and the table check relaxed so only the function decides)
  alter table public.staff_leave_requests drop constraint staff_leave_requests_not_self_decided;
  create or replace function private.may_decide_leave(p_request public.staff_leave_requests) returns boolean
  language sql stable security definer set search_path = '' as $f$ select true $f$;
  perform pg_temp.act(v_staff);
  insert into results values ('sabotaged', 'the person cannot decide their own leave', '42501',
    pg_temp.try(format($q$select public.decide_leave(%L, 'approved', null, 0)$q$, v_r)));
  perform pg_temp.back();
  -- sabotage 2: the read policy opened to everyone
  drop policy staff_leave_requests_read on public.staff_leave_requests;
  create policy staff_leave_requests_read on public.staff_leave_requests for select to authenticated using (true);
  perform pg_temp.act(v_col);
  insert into results values ('sabotaged', 'a colleague reads none of the requests', '0',
    (select count(*)::text from public.staff_leave_requests where profile_id = v_staff));
  perform pg_temp.back();
end $$;

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'hr_people_phase_c_leave FAILED: %', v_bad; end if;
  if (select count(*) from results where phase = 'real') <> 30 then
    raise exception 'hr_people_phase_c_leave: expected 30 checks, got %', (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end end as result
from results order by phase, check_name;

rollback;

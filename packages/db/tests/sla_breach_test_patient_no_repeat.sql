-- Tarragon Health: SLA-breach notices for a test patient's alert are sent once, a real patient's alert keeps being chased (2026-10-30)
--
--   1  test patient   day 1 notice is sent; a run on a later day sends nothing more
--   2  real patient   the same later-day run sends a fresh notice (control: the rule must not silence real patients)
--
-- Fixtures built here, wrapped in BEGIN/ROLLBACK, raises on failure.
-- Run: psql "$DATABASE_URL" -f packages/db/tests/sla_breach_test_patient_no_repeat.sql

begin;

create temp table fx (k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sla-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'SLA ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, p_test)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, is_test = p_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkalert(p_patient uuid) returns uuid language plpgsql as $f$
declare v_result uuid; v_alert uuid;
begin
  insert into public.screening_results (organisation_id, patient_id, result_status, screen_type_code, abnormal_flags)
  values ((select organisation_id from public.profiles where id = p_patient), p_patient, 'critical', 'hba1c', array['glucose']) returning id into v_result;
  select id into v_alert from public.clinician_alerts where screening_result_id = v_result;
  if v_alert is null then raise exception 'FAIL setup: the critical result raised no alert'; end if;
  update public.clinician_alerts set sla_due_at = now() - interval '30 hours' where id = v_alert;
  return v_alert;
end $f$;
create function pg_temp.notices(p_alert uuid) returns integer language sql as
$$ select count(*)::integer from public.clinician_alert_sla_breach_notifications where clinician_alert_id = p_alert $$;

do $$
declare v_org uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then raise exception 'no organisation exists, the core migrations did not run'; end if;
  insert into fx values ('testpat', pg_temp.mkuser(v_org, 'testpat', 'patient', true)), ('realpat', pg_temp.mkuser(v_org, 'realpat', 'patient', false));
  insert into fx values ('alertT', pg_temp.mkalert(pg_temp.f('testpat'))), ('alertR', pg_temp.mkalert(pg_temp.f('realpat')));
end $$;

-- day 1: both are told
select private.escalate_overdue_clinician_alerts();
do $$
begin
  if pg_temp.notices(pg_temp.f('alertT')) <> 1 then raise exception 'FAIL 1: the test patient''s alert was not told on day 1'; end if;
  if pg_temp.notices(pg_temp.f('alertR')) <> 1 then raise exception 'FAIL 2: the real patient''s alert was not told on day 1'; end if;
end $$;

-- a later day: move the ledger back one day so the job treats today as a new day
update public.clinician_alert_sla_breach_notifications set notified_on = notified_on - 1
 where clinician_alert_id in (pg_temp.f('alertT'), pg_temp.f('alertR'));
select private.escalate_overdue_clinician_alerts();
do $$
begin
  if pg_temp.notices(pg_temp.f('alertT')) <> 1 then raise exception 'FAIL 1: the test patient''s alert was told again on a later day (% notices)', pg_temp.notices(pg_temp.f('alertT')); end if;
  if pg_temp.notices(pg_temp.f('alertR')) <> 2 then raise exception 'FAIL 2: the real patient''s alert was not chased on a later day (% notices)', pg_temp.notices(pg_temp.f('alertR')); end if;
end $$;

rollback;

select 'sla_breach_test_patient_no_repeat: ok' as result;

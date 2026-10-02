-- S06 proof: offline client time is kept, bounded, and the server time stays
-- the fallback (founder decision S06-1; migration *_s06_offline_client_recorded_time.sql).
--
-- Proves in one rolled-back transaction:
--   1. A client time inside the window is stored as the effective time
--      (symptoms.reported_at, vitals_readings.taken_at) with time_basis
--      'client_bounded', and client_recorded_at is kept untouched.
--   2. Too old, in the future, or absent falls back to server time, basis 'server'.
--   3. received_at is always server time, whatever the client says.
--   4. A spoofed reported_at / taken_at with no client_recorded_at is still
--      overridden (the original no-backdating rule is intact).
--   5. A non-manual vitals source keeps its own taken_at untouched.
--   6. medication_logs' trigger function uses the same resolver.
--   7. SABOTAGE: with the resolver replaced by one that trusts the client
--      unconditionally, checks 2 must flip to FAIL, proving they discriminate.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;

create or replace function pg_temp.run_checks(p_phase text) returns void
language plpgsql as $f$
declare
  v_p uuid;
  v_org uuid;
  v_s record; v_v record; v_old record; v_fut record; v_spoof record; v_dev record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  if v_org is null then
    raise exception 'S06 proof needs one organisation (seed fixture missing)';
  end if;
  v_p := gen_random_uuid();
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 's06-time-' || v_p || '@example.invalid', 'x', now(), '{}', '{}')
  on conflict (id) do nothing;
  insert into public.profiles (id, organisation_id, role, full_name, date_of_birth)
  values (v_p, v_org, 'patient', 'S06 Time Test', (current_date - interval '40 years')::date)
  on conflict (id) do nothing;
  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_recorded_at)
    values (v_org, v_p, 'fatigue', 1, now() - interval '6 hours') returning * into v_s;
  insert into results values (p_phase, 'in-window client time becomes reported_at', 'true',
    (abs(extract(epoch from (v_s.reported_at - (now() - interval '6 hours')))) < 5)::text);
  insert into results values (p_phase, 'in-window basis is client_bounded', 'client_bounded', coalesce(v_s.time_basis, 'null'));
  insert into results values (p_phase, 'client_recorded_at kept untouched', 'true',
    (abs(extract(epoch from (v_s.client_recorded_at - (now() - interval '6 hours')))) < 5)::text);
  insert into results values (p_phase, 'received_at is server time', 'true',
    (abs(extract(epoch from (v_s.received_at - clock_timestamp()))) < 5)::text);

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_recorded_at)
    values (v_org, v_p, 'fatigue', 1, now() - interval '10 days') returning * into v_old;
  insert into results values (p_phase, 'a 10-day-old client time falls back to server time', 'server', coalesce(v_old.time_basis, 'null'));
  insert into results values (p_phase, 'a 10-day-old client time is not stored as reported_at', 'true',
    (v_old.reported_at > now() - interval '1 hour')::text);

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, client_recorded_at)
    values (v_org, v_p, 'fatigue', 1, now() + interval '2 days') returning * into v_fut;
  insert into results values (p_phase, 'a future client time falls back to server time', 'server', coalesce(v_fut.time_basis, 'null'));

  insert into public.symptoms (organisation_id, patient_id, symptom_type, severity, reported_at)
    values (v_org, v_p, 'fatigue', 1, now() - interval '5 days') returning * into v_spoof;
  insert into results values (p_phase, 'spoofed reported_at without a client time is still overridden', 'true',
    (v_spoof.reported_at > now() - interval '1 hour')::text);

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, client_recorded_at)
    values (v_org, v_p, 'weight', 70, 'manual', now() - interval '3 hours') returning * into v_v;
  insert into results values (p_phase, 'manual vitals take the bounded client time', 'true',
    (abs(extract(epoch from (v_v.taken_at - (now() - interval '3 hours')))) < 5)::text);

  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source, taken_at)
    values (v_org, v_p, 'weight', 71, 'device', now() - interval '5 days') returning * into v_dev;
  insert into results values (p_phase, 'non-manual source keeps its own taken_at', 'true',
    (v_dev.taken_at < now() - interval '4 days')::text);
end
$f$;

select pg_temp.run_checks('real');

insert into results values ('real', 'medication_logs trigger uses the resolver', 'true',
  (pg_get_functiondef('private.stamp_medication_log_timestamp'::regproc) like '%resolve_offline_event_time%')::text);

-- Sabotage: trust the client unconditionally.
create or replace function private.resolve_offline_event_time(p_client timestamptz, p_received timestamptz)
returns table (effective_at timestamptz, basis text) language sql as
$$ select coalesce(p_client, p_received), case when p_client is null then 'server' else 'client_bounded' end $$;
select pg_temp.run_checks('sabotaged');

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected <> actual;
  if v_bad > 0 then
    raise exception 'S06 time proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => ' || actual, '; ') from results where phase = 'real' and expected <> actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then
    raise exception 'VACUOUS TEST: sabotaged resolver did not fail any check';
  end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

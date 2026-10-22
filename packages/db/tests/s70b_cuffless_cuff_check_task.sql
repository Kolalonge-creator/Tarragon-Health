-- S70b proof: a high wearable (cuffless) blood pressure estimate gives the person ONE calm "take a cuff reading this week" task and nothing else
-- (migration *_s70b_cuffless_cuff_check_task.sql). One rolled-back transaction. Proves: module born off -> no task; module on -> an amber and a red estimate each make a task on the
-- person's own list (owner patient, kind log_bp, due in 7 days, no number or band in the text); only one open task at a time; a green estimate, an emergency-level estimate and a
-- cuff (manual) reading make none; the task raises no clinician alert of its own; the function never names clinician_alerts.
-- SABOTAGE: the module check removed -> the 'off' check flips; the estimate check removed -> the 'manual makes none' check flips.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.ck(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as $$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
create function pg_temp.mkuser(p_org uuid, p_label text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's70bcc-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, 'patient', 'S70B ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.vit(p_patient uuid, p_org uuid, p_source text, p_sys int, p_dia int) returns void language sql as
$$ insert into public.vitals_readings (organisation_id, patient_id, vital_type, source, taken_at, systolic, diastolic)
   values (p_org, p_patient, 'blood_pressure', p_source::public.vital_source, now(), p_sys, p_dia) $$;
create function pg_temp.module(p_on boolean) returns void language sql as
$$ update public.platform_modules set is_enabled = p_on, enabled_at = case when p_on then now() end, enabled_by = case when p_on then (select id from public.profiles order by created_at limit 1) end where key = 'device_cuffless_cuff_check_task' $$;
create function pg_temp.tasks(p_patient uuid) returns text language sql as
$$ select count(*)::text from public.care_tasks where patient_id = p_patient and source = 'cuffless_estimate' $$;

create function pg_temp.run(p_phase text) returns void language plpgsql as
$f$
declare v_org uuid; a uuid; b uuid; c uuid; d uuid; e uuid; g uuid; h uuid; t record; n_off integer; n_on integer; n_all_before integer; n_em integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  a := pg_temp.mkuser(v_org, p_phase || '-a'); b := pg_temp.mkuser(v_org, p_phase || '-b'); c := pg_temp.mkuser(v_org, p_phase || '-c');
  d := pg_temp.mkuser(v_org, p_phase || '-d'); e := pg_temp.mkuser(v_org, p_phase || '-e'); g := pg_temp.mkuser(v_org, p_phase || '-g'); h := pg_temp.mkuser(v_org, p_phase || '-h');

  perform pg_temp.ck(p_phase, 'the module is born off', 'false', (select is_enabled::text from public.platform_modules where key = 'device_cuffless_cuff_check_task'));
  perform pg_temp.ck(p_phase, 'the days are the proposed 7', '7', private.cuffless_cuff_check_days()::text);

  perform pg_temp.module(false);
  perform pg_temp.vit(a, v_org, 'wearable', 150, 95);
  perform pg_temp.ck(p_phase, 'off: a high wearable estimate makes no task', '0', pg_temp.tasks(a));

  perform pg_temp.module(true);
  perform pg_temp.vit(b, v_org, 'wearable', 150, 95);   -- amber band by the live classifier
  perform pg_temp.ck(p_phase, 'on: an amber estimate makes one task', '1', pg_temp.tasks(b));
  select * into t from public.care_tasks where patient_id = b and source = 'cuffless_estimate';
  perform pg_temp.ck(p_phase, 'the task is the person''s own, kind log_bp, due in about 7 days', 'patient|log_bp|true',
    t.owner_role::text || '|' || t.kind || '|' || (t.due_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour')::text);
  perform pg_temp.ck(p_phase, 'the task text names no number, band or condition', 'false', (t.title || ' ' || coalesce(t.description, '') ~* '[0-9]|pressure is high|hypertens|danger')::text);
  perform pg_temp.vit(b, v_org, 'wearable', 170, 105);
  perform pg_temp.ck(p_phase, 'a second estimate while one is open adds nothing', '1', pg_temp.tasks(b));
  perform pg_temp.vit(c, v_org, 'wearable', 170, 105);   -- red band
  perform pg_temp.ck(p_phase, 'a red estimate makes one task', '1', pg_temp.tasks(c));
  perform pg_temp.vit(d, v_org, 'wearable', 118, 76);
  perform pg_temp.ck(p_phase, 'a normal estimate makes none', '0', pg_temp.tasks(d));
  perform pg_temp.vit(e, v_org, 'wearable', 230, 130);
  perform pg_temp.ck(p_phase, 'an emergency-level estimate makes none (the emergency path owns it)', '0', pg_temp.tasks(e));
  perform pg_temp.vit(g, v_org, 'manual', 150, 95);
  perform pg_temp.ck(p_phase, 'a cuff (manual) reading makes none', '0', pg_temp.tasks(g));
  perform pg_temp.vit(h, v_org, 'wearable', 150, 95);   -- same single amber estimate as patient a, module on
  -- "no clinician alert of its own": the same amber reading, with the task module off (patient a, above) and on (patient h), leaves the SAME number of clinician alerts of any kind
  perform pg_temp.ck(p_phase, 'the task adds no clinician alert: all alerts for the patient are the same with the module on as with it off', 'true',
    ((select count(*) from public.clinician_alerts where patient_id = a) = (select count(*) from public.clinician_alerts where patient_id = h))::text);
  -- an emergency-level estimate with the task module ON still takes its existing emergency path (the BP handler's emergency record), untouched by the task
  perform pg_temp.ck(p_phase, 'an emergency-level wearable estimate with the module on still opens the existing emergency record', 'true',
    (exists (select 1 from public.emergency_events where patient_id = e and source = 'bp_reading' and vital_reading_id is not null))::text);
end $f$;

do $$ begin perform pg_temp.run('real'); end $$;

-- SABOTAGE 1: the module check removed
do $$ declare v text; begin
  select pg_get_functiondef(p.oid) into v from pg_proc p where p.proname = 'cuffless_cuff_check_task' and p.pronamespace = 'private'::regnamespace;
  v := replace(v, 'if not private.module_enabled(''device_cuffless_cuff_check_task'') then return new; end if;', '');
  execute v;
end $$;
do $$ begin perform pg_temp.run('sab_module'); end $$;

-- SABOTAGE 2: the estimate check removed (the trigger WHEN is on the trigger, so also drop it)
do $$ declare v text; begin
  select pg_get_functiondef(p.oid) into v from pg_proc p where p.proname = 'cuffless_cuff_check_task' and p.pronamespace = 'private'::regnamespace;
  v := replace(v, ' or not private.bp_reading_is_estimate(new.source::text)', '');
  execute v;
  drop trigger vitals_readings_v_cuffless_cuff_check_task on public.vitals_readings;
  create trigger vitals_readings_v_cuffless_cuff_check_task after insert on public.vitals_readings for each row when (new.vital_type = 'blood_pressure') execute function private.cuffless_cuff_check_task();
end $$;
do $$ begin perform pg_temp.run('sab_estimate'); end $$;

do $$
declare v_bad integer; v_flip integer; v_ph text;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S70b cuffless task proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  foreach v_ph in array array['sab_module', 'sab_estimate'] loop
    select count(*) into v_flip from results where phase = v_ph and expected is distinct from actual;
    if v_flip < 1 then raise exception 'VACUOUS TEST: sabotage % flipped no check', v_ph; end if;
  end loop;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;

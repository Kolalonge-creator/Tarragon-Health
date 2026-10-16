-- S47d (code review finding 2, chat decision 2026-10-07 + founder two-tier model 2026-10-08). Nothing signed, nothing applied to production.
--
-- The consent matrix made reproductive health, mental health and device data "optional per use" (migration 20261008032719) but only DISPLAYED that: nothing
-- stopped a new record being written without the person's yes. This enforces it where the data is WRITTEN:
--   * a new reproductive-health record (profile, cycle, daily log, pregnancy, postnatal, contraception plan),
--   * a new PHQ-9 / GAD-7 mental-health screen response,
--   * a new device or wearable reading (wearable_readings, and a vitals_readings row whose source is 'wearable')
-- is refused unless private.consent_in_force(patient, <data type>, 'care') is true. The refusal is a clear, stable message the apps map to the consent prompt:
--   SQLSTATE P0001, message 'consent_required:reproductive' | 'consent_required:mental_health' | 'consent_required:device_data'.
-- EXISTING records are untouched and stay readable for care: no care-access function reads the matrix (the S42 proof scans their source) and nothing here adds a
-- reader. Only WRITES consult it. Fixtures and migrations (database role 'none' / postgres) are exempt; every API role (authenticated, service_role, anon) is not,
-- including a SECURITY DEFINER function a patient calls, because the check reads the session role, not the function owner.
--
-- It also makes the matrix the ONE source of truth for device data: the older patient_consents type 'wearable_device_data' (S44) is folded into the matrix cell
-- device_data x care. Counts first (live, read 2026-10-07): that consent type has no published version, so 0 patients hold it; the migration still carries any
-- in-force grant over (0 rows expected). The health-store route and the cloud ingest now ask device_data_consent_in_force instead.

create function private.optional_feature_consent_guard() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_patient uuid; v_type text := tg_argv[0];
begin
  -- migrations, fixtures and ops run with no API role; every API role is checked
  if coalesce(nullif(current_setting('role', true), ''), 'none') in ('none', 'postgres', 'supabase_admin') then return new; end if;
  if tg_table_name = 'wearable_readings' then
    select c.patient_id into v_patient from public.wearable_connections c where c.id = new.connection_id;
  else
    v_patient := new.patient_id;
  end if;
  if v_patient is null then return new; end if;
  if private.consent_in_force(v_patient, v_type, 'care') then return new; end if;
  raise exception 'consent_required:%', v_type using errcode = 'P0001',
    detail = 'This feature needs the person''s permission first. Ask them in the app; nothing was saved.';
end $$;
revoke all on function private.optional_feature_consent_guard() from public, anon, authenticated;

create trigger reproductive_health_profiles_consent before insert on public.reproductive_health_profiles for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger menstrual_cycles_consent           before insert on public.menstrual_cycles           for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger menstrual_daily_logs_consent       before insert on public.menstrual_daily_logs       for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger patient_pregnancy_consent          before insert on public.patient_pregnancy          for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger postnatal_profiles_consent         before insert on public.postnatal_profiles         for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger postnatal_checkins_consent         before insert on public.postnatal_checkins         for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger contraception_plans_consent        before insert on public.contraception_plans        for each row execute function private.optional_feature_consent_guard('reproductive');
create trigger mental_health_screens_consent      before insert on public.mental_health_screens      for each row execute function private.optional_feature_consent_guard('mental_health');
create trigger wearable_readings_consent          before insert on public.wearable_readings          for each row execute function private.optional_feature_consent_guard('device_data');
create trigger vitals_readings_wearable_consent   before insert on public.vitals_readings            for each row when (new.source::text = 'wearable') execute function private.optional_feature_consent_guard('device_data');

-- One source of truth for device data: the matrix. The service role (the health-store route and the cloud ingest) asks this.
create function public.device_data_consent_in_force(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.consent_in_force(p_patient, 'device_data', 'care') $$;
revoke all on function public.device_data_consent_in_force(uuid) from public, anon, authenticated;
grant execute on function public.device_data_consent_in_force(uuid) to service_role;

-- Carry over any person whose old wearable_device_data consent is still in force (latest row accepted, not withdrawn) and who has no matrix decision yet.
insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by, is_test)
select p.organisation_id, pc.patient_id, 'device_data', 'care', 'granted', 2, 'patient', pc.patient_id, p.is_test
  from (select distinct on (patient_id) patient_id, action from public.patient_consents where consent_type = 'wearable_device_data' order by patient_id, created_at desc) pc
  join public.profiles p on p.id = pc.patient_id and p.organisation_id is not null
 where pc.action = 'accepted'
   and not exists (select 1 from public.consent_matrix_events e where e.patient_id = pc.patient_id and e.data_type = 'device_data' and e.purpose = 'care');

comment on function public.device_data_consent_in_force(uuid) is 'S47d: the single answer to "may this person''s device or wearable data be stored". Reads the consent matrix cell device_data x care; the older patient_consents type wearable_device_data is no longer consulted.';

do $$
begin
  if has_function_privilege('authenticated', 'public.device_data_consent_in_force(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.device_data_consent_in_force(uuid)', 'EXECUTE') then
    raise exception 'S47d: device_data_consent_in_force reachable by a client role';
  end if;
  if (select count(*) from pg_trigger where tgname like '%\_consent' escape '\' or tgname = 'vitals_readings_wearable_consent') < 10 then
    raise exception 'S47d: a consent trigger is missing';
  end if;
end $$;

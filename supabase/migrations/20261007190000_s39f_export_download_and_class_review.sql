-- S39f: (1) the complete export reaches the patient after an admin approves it (OQ-285, founder 2026-10-07), (2) the CMO's confirmation of the registry classes (OQ-284).
--   * private.export_patient_json(patient): the export body, moved out of export_patient_data so the admin function and the patient download share one definition.
--   * public.export_my_data(): the signed-in PATIENT's own complete export, only while an admin has FULFILLED one of their export requests within the review
--     period (security_config.export_review_days, 30). Every download is audited (a fulfilled request is immutable, so nothing is stamped on it), and it returns nothing for any other caller.
--     The web route /api/patient/data-export now calls it, replacing the old fixed list of about 16 tables.
--   * data_registry: the CMO reviewed the one page list (docs/design/S39d-class-review.md) and confirmed it with these corrections: sti_partner_notifications
--     and risk_reassessment_queue become clinical_record; wellness_points_ledger becomes operational; care_access_events becomes audit (still exported, the patient's
--     own access trail); wellbeing_checkins and wellbeing_checkin_preferences become clinical_record; every other class is confirmed as proposed. All 302 rows are marked reviewed.
-- private.is_org_staff is NOT edited. No patient data is changed. Applied with the version pinned to this filename.

-- 1. One export body --------------------------------------------------------------------------------------------------
create function private.export_patient_json(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r record; v_rows jsonb; v_out jsonb := '{}'::jsonb; v_profile jsonb;
begin
  select to_jsonb(p) - 'id' into v_profile from public.profiles p where p.id = p_patient;
  for r in select table_name, patient_expr from public.data_registry where in_export order by table_name loop
    execute format(
      'select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key !~* ''token|secret|password|hash|api_key|passcode'')), ''[]''::jsonb) from public.%I t where (%s) = $1',
      r.table_name, r.patient_expr) into v_rows using p_patient;
    if jsonb_array_length(v_rows) > 0 then v_out := v_out || jsonb_build_object(r.table_name, v_rows); end if;
  end loop;
  return jsonb_build_object('generated_at', now(), 'patient', p_patient, 'profile', v_profile, 'tables', v_out);
end $$;
revoke all on function private.export_patient_json(uuid) from public, anon, authenticated;

create or replace function public.export_patient_data(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_out jsonb;
begin
  if not (private.is_admin() or (select auth.role()) = 'service_role' or ((select auth.role()) is null and session_user in ('postgres', 'supabase_admin'))) then raise exception 'only an admin can fulfil an export' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and role = 'patient') then raise exception 'no such patient' using errcode = 'P0002'; end if;
  v_out := private.export_patient_json(p_patient);
  perform private.log_audit('patient_data_export', 'patient', p_patient, jsonb_build_object('tables', (select count(*) from jsonb_object_keys(v_out -> 'tables'))));
  return v_out;
end $$;

-- 2. The patient's download ------------------------------------------------------------------------------------------------
-- A fulfilled request is immutable (a trigger blocks any edit), so a download is recorded in the audit log, not on the request.
create function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare v_me uuid := (select auth.uid()); v_days integer; v_req uuid; v_out jsonb;
begin
  if v_me is null or not exists (select 1 from public.profiles where id = v_me and role = 'patient' and is_active) then
    raise exception 'only a patient can download their own data' using errcode = '42501';
  end if;
  select coalesce((config ->> 'export_review_days')::integer, 30) into v_days from public.security_config where is_active;
  select id into v_req from public.data_export_requests
   where patient_id = v_me and status = 'fulfilled' and fulfilled_at > now() - make_interval(days => coalesce(v_days, 30))
   order by fulfilled_at desc limit 1;
  if v_req is null then
    raise exception 'no approved export request: ask for your data from Privacy and data, an admin reviews it first' using errcode = '42501';
  end if;
  v_out := private.export_patient_json(v_me);
  perform private.log_audit('patient_data_export_download', 'patient', v_me, jsonb_build_object('request_id', v_req, 'tables', (select count(*) from jsonb_object_keys(v_out -> 'tables'))));
  return v_out;
end $$;
revoke all on function public.export_my_data() from public, anon;
grant execute on function public.export_my_data() to authenticated;

-- 3. The CMO's class confirmation --------------------------------------------------------------------------------------------
alter table public.data_registry add column reviewed_at timestamptz;
alter table public.data_registry add column reviewed_note text;

update public.data_registry set retention_class = 'clinical_record', end_of_retention = 'review'
 where table_name in ('sti_partner_notifications', 'risk_reassessment_queue', 'wellbeing_checkins', 'wellbeing_checkin_preferences');
update public.data_registry set retention_class = 'operational', end_of_retention = 'delete' where table_name = 'wellness_points_ledger';
update public.data_registry set retention_class = 'audit', end_of_retention = 'review', in_export = true where table_name = 'care_access_events';
update public.data_registry set reviewed = true, reviewed_at = now(), reviewed_note = 'CMO review 2026-10-07 of docs/design/S39d-class-review.md: confirmed, with the corrections listed in the S39f migration header';

do $$
begin
  if exists (select 1 from public.data_registry where not reviewed) then raise exception 'S39f: registry rows left unreviewed'; end if;
  if (select retention_class from public.data_registry where table_name = 'sti_partner_notifications') <> 'clinical_record' then raise exception 'S39f: correction not applied'; end if;
  if has_function_privilege('anon', 'public.export_my_data()', 'EXECUTE') then raise exception 'S39f: anon can execute'; end if;
end $$;

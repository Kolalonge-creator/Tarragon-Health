-- S39h: the CMO's confirmation of the security and retention settings (2026-10-07, selected in chat as CMO and owner of security.rules).
-- Same values as v3 (opening window 8 hours, alert at 20 untied openings an hour, after hours 22:00 to 06:00 Lagos, export review 30 days, and the retention periods
-- from the NHS Records Management Code and HIPAA); published as a NEW version because a confirmed value is a new version, never an edit. v3 stays as history.
-- To be reviewed against real log data at 90 days. Nothing is deleted by these settings (real_data_auto_delete false). No data is changed.
update public.security_config set is_active = false where is_active and version = 3;
insert into public.security_config (version, is_active, config)
-- security-rules-v4-begin
select 4, true, $json$
{"lookup_failure_alert_per_hour": 50, "record_open_window_hours": 8, "untied_open_alert_per_hour": 20, "after_hours_start": 22, "after_hours_end": 6,
 "export_review_days": 30,
 "retention": {"adult_clinical_record_years_after_last_contact": 8, "child_record_until_age": 25, "child_record_until_age_if_seen_at_17": 26,
   "maternity_record_years": 25, "mental_health_years_after_last_contact": 20, "access_audit_log_years": 8,
   "consent_years_after_relationship_end": 6, "payments_ledger_years": 6, "operational_data_days_min": 90, "operational_data_days_max": 730,
   "real_data_auto_delete": false}}
$json$::jsonb
where not exists (select 1 from public.security_config where version = 4);

-- Fix found while checking the S39d proof against live: S28d dropped pharmacy_order_delivery_attempts after the registry was built, so the registry named a table that no
-- longer exists and the export and the retention report would fail with 42P01 for everyone. Both now skip a registry row whose table is gone, and the stale row is removed.
create or replace function private.export_patient_json(p_patient uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare r record; v_rows jsonb; v_out jsonb := '{}'::jsonb; v_profile jsonb;
begin
  select to_jsonb(p) - 'id' into v_profile from public.profiles p where p.id = p_patient;
  for r in select table_name, patient_expr from public.data_registry where in_export and to_regclass('public.' || quote_ident(table_name)) is not null order by table_name loop
    execute format(
      'select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key !~* ''token|secret|password|hash|api_key|passcode'')), ''[]''::jsonb) from public.%I t where (%s) = $1',
      r.table_name, r.patient_expr) into v_rows using p_patient;
    if jsonb_array_length(v_rows) > 0 then v_out := v_out || jsonb_build_object(r.table_name, v_rows); end if;
  end loop;
  return jsonb_build_object('generated_at', now(), 'patient', p_patient, 'profile', v_profile, 'tables', v_out);
end $$;

create or replace function public.retention_review_report() returns table (table_name text, retention_class text, period text, rows_older_than_period bigint, reviewed boolean)
language plpgsql stable security definer set search_path = '' as
$$
declare r record; v_ret jsonb; v_cut timestamptz; v_n bigint; v_per text;
begin
  if not private.can_review_access_log() then raise exception 'not allowed' using errcode = '42501'; end if;
  select config -> 'retention' into v_ret from public.security_config where is_active;
  for r in select d.table_name as tn, d.retention_class as rc, d.reviewed as rv from public.data_registry d
            where to_regclass('public.' || quote_ident(d.table_name)) is not null and exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = d.table_name and c.column_name = 'created_at') order by d.table_name loop
    v_cut := case r.rc
      when 'clinical_record' then now() - make_interval(years => (v_ret ->> 'adult_clinical_record_years_after_last_contact')::int)
      when 'mental_health' then now() - make_interval(years => (v_ret ->> 'mental_health_years_after_last_contact')::int)
      when 'maternity' then now() - make_interval(years => (v_ret ->> 'maternity_record_years')::int)
      when 'consent' then now() - make_interval(years => (v_ret ->> 'consent_years_after_relationship_end')::int)
      when 'financial' then now() - make_interval(years => (v_ret ->> 'payments_ledger_years')::int)
      when 'audit' then now() - make_interval(years => (v_ret ->> 'access_audit_log_years')::int)
      else now() - make_interval(days => (v_ret ->> 'operational_data_days_max')::int) end;
    v_per := case r.rc
      when 'operational' then (v_ret ->> 'operational_data_days_max') || ' days'
      when 'clinical_record' then (v_ret ->> 'adult_clinical_record_years_after_last_contact') || ' years'
      when 'mental_health' then (v_ret ->> 'mental_health_years_after_last_contact') || ' years'
      when 'maternity' then (v_ret ->> 'maternity_record_years') || ' years'
      when 'consent' then (v_ret ->> 'consent_years_after_relationship_end') || ' years'
      when 'financial' then (v_ret ->> 'payments_ledger_years') || ' years'
      else (v_ret ->> 'access_audit_log_years') || ' years' end;
    execute format('select count(*) from public.%I where created_at < $1', r.tn) into v_n using v_cut;
    table_name := r.tn; retention_class := r.rc; period := v_per; rows_older_than_period := v_n; reviewed := r.rv;
    return next;
  end loop;
end $$;

delete from public.data_registry where to_regclass('public.' || quote_ident(table_name)) is null;
do $$
begin
  if exists (select 1 from public.data_registry where to_regclass('public.' || quote_ident(table_name)) is null) then raise exception 'S39h: the registry still names a missing table'; end if;
  if (select version from public.security_config where is_active) <> 4 or (select count(*) from public.security_config where is_active) <> 1 then raise exception 'S39h: v4 is not the one active row'; end if;
end $$;

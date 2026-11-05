-- Security audit 2026-11-05, Phase 2 (H-7: no security monitoring). Sign-in logging and four security alert rules on the existing
-- SR5 operations alert framework (20261013005350_sr5_alert_rules_and_operations_wall.sql). Extends, does not replace, anything.
--
-- 1. Successful sign-ins. private.log_clinician_login (AFTER UPDATE on auth.users, fires when last_sign_in_at moves, so every sign-in
--    method on web, console and the phone app) already wrote 'clinician.logged_in' for staff. It now also writes 'patient.logged_in'
--    for patients, so a patient account takeover can be traced. Redefined from its LIVE body (checked 2026-11-05); the staff branch is
--    unchanged.
-- 2. Failed sign-ins are written by the web and console sign-in actions (packages/auth/src/record-failed-sign-in.ts) through the
--    service role: action 'auth.sign_in_failed', no actor, event {identifier_hash, method}, never the raw email or phone. The phone
--    app signs in straight against Supabase Auth, so its failures are not recorded here (documented gap, see the PR).
-- 3. Four rules, PROPOSED values mirrored by the registry key ops.security_alert_rules (owner Founder). None returns a patient
--    reference: dedup keys are an identifier-hash prefix, a staff profile id, or an audit row id.
--      failed_sign_in_spike     sev2  one account (by hash) or the whole platform failing sign-in too often in a window
--      staff_bulk_record_access sev2  one staff member opening many different patients' records in a window
--      privileged_change        sev3  an account role, a clinician's tier or active flag changed, or a clinician was added
--      patient_data_export      sev3  a staff export of patient-level data (directory, consultations log, research export)
-- 4. An index on audit_log (action, created_at) so the checks stay cheap as the log grows.

-- ---------------------------------------------------------------------------
-- 1. Successful sign-ins: patients too
-- ---------------------------------------------------------------------------
create or replace function private.log_clinician_login()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_role public.user_role;
  v_org  uuid;
begin
  if old.last_sign_in_at is not distinct from new.last_sign_in_at then
    return new;
  end if;

  select role, organisation_id into v_role, v_org
  from public.profiles where id = new.id;

  if v_role is null then
    return new;
  end if;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, new.id, case when v_role = 'patient' then 'patient.logged_in' else 'clinician.logged_in' end,
          'profile', new.id, '{}'::jsonb);

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. Index for the checks
-- ---------------------------------------------------------------------------
create index if not exists audit_log_action_created_idx on public.audit_log (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. The rules (PROPOSED numbers; mirrored by the registry key ops.security_alert_rules and a drift test)
-- ---------------------------------------------------------------------------
-- security-alert-rules-begin
insert into public.ops_alert_rules (code, title, severity, source, enabled, params, min_interval_seconds, renotify_minutes, off_reason) values
  ('failed_sign_in_spike',     'Sign-in failures are unusually high',                    'sev2', 'database', true, '{"window_minutes": 15, "max_per_account": 10, "max_total": 50}'::jsonb, 60, 60, null),
  ('staff_bulk_record_access', 'A staff member opened an unusual number of patient records', 'sev2', 'database', true, '{"window_minutes": 60, "max_distinct_patients": 30, "actions": ["staff.chart_read", "consult_checkin.read", "clinician.patient_record_viewed"]}'::jsonb, 300, 60, null),
  ('privileged_change',        'An account role or clinician authority changed',         'sev3', 'database', true, '{"window_minutes": 60}'::jsonb, 300, 1440, null),
  ('patient_data_export',      'Patient-level data was exported',                        'sev3', 'database', true, '{"window_minutes": 60, "actions": ["admin.patient_directory_exported", "consultations.log_export", "research_export.created"]}'::jsonb, 300, 1440, null);
-- security-alert-rules-end

-- ---------------------------------------------------------------------------
-- 4. Check functions. Each returns the rows breaching now; none returns a patient reference.
-- ---------------------------------------------------------------------------
create function private.ops_check_failed_sign_in_spike(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  with w as (
    select a.event ->> 'identifier_hash' as h
      from public.audit_log a
     where a.action = 'auth.sign_in_failed'
       and a.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 15))
  )
  select 'account:' || left(h, 16), jsonb_build_object('failures', count(*), 'window_minutes', coalesce((p ->> 'window_minutes')::integer, 15))
    from w where h is not null
   group by h
  having count(*) >= coalesce((p ->> 'max_per_account')::integer, 10)
  union all
  select 'all', jsonb_build_object('failures', count(*), 'window_minutes', coalesce((p ->> 'window_minutes')::integer, 15))
    from w
  having count(*) >= coalesce((p ->> 'max_total')::integer, 50);
$$;

create function private.ops_check_staff_bulk_record_access(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select a.actor_id::text,
         jsonb_build_object('distinct_patients', count(distinct coalesce(a.subject_patient_id, case when a.entity_type = 'patient' then a.entity_id end)),
                            'window_minutes', coalesce((p ->> 'window_minutes')::integer, 60))
    from public.audit_log a
    join public.profiles pr on pr.id = a.actor_id
   where a.action in (select jsonb_array_elements_text(coalesce(p -> 'actions', '[]'::jsonb)))
     and a.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
     and (p_test or not pr.is_test)
   group by a.actor_id
  having count(distinct coalesce(a.subject_patient_id, case when a.entity_type = 'patient' then a.entity_id end))
         >= coalesce((p ->> 'max_distinct_patients')::integer, 30);
$$;

create function private.ops_check_privileged_change(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select a.id::text,
         jsonb_build_object('change', case when a.action = 'profiles.updated' then 'account_role'
                                           when a.action = 'clinical_staff.created' then 'clinician_added'
                                           else 'clinician_tier_or_active' end,
                            'changed_by', a.actor_id,
                            'minutes_ago', (extract(epoch from now() - a.created_at) / 60)::integer)
    from public.audit_log a
   where a.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
     and ((a.action = 'profiles.updated' and a.event -> 'changed_columns' ? 'role')
          or (a.action = 'clinical_staff.updated' and a.event -> 'changed_columns' ?| array['doctor_tier', 'active'])
          or a.action = 'clinical_staff.created')
     and (p_test or not coalesce(
            (select pr.is_test from public.profiles pr where a.entity_type = 'profiles' and pr.id = a.entity_id),
            (select cs.is_test from public.clinical_staff cs where a.entity_type = 'clinical_staff' and cs.id = a.entity_id),
            false));
$$;

create function private.ops_check_patient_data_export(p jsonb, p_test boolean) returns table (dedup_key text, detail jsonb)
language sql stable security definer set search_path = ''
as $$
  select a.id::text,
         jsonb_build_object('export', a.action, 'exported_by', a.actor_id,
                            'minutes_ago', (extract(epoch from now() - a.created_at) / 60)::integer)
    from public.audit_log a
    left join public.profiles pr on pr.id = a.actor_id
   where a.action in (select jsonb_array_elements_text(coalesce(p -> 'actions', '[]'::jsonb)))
     and a.created_at > now() - make_interval(mins => coalesce((p ->> 'window_minutes')::integer, 60))
     and (p_test or not coalesce(pr.is_test, false));
$$;

-- ---------------------------------------------------------------------------
-- 5. Grants: like every SR5 check, nobody but the evaluator (definer) runs these. The revoke is from PUBLIC (anon inherits through it).
-- ---------------------------------------------------------------------------
revoke all on function private.ops_check_failed_sign_in_spike(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.ops_check_staff_bulk_record_access(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.ops_check_privileged_change(jsonb, boolean) from public, anon, authenticated;
revoke all on function private.ops_check_patient_data_export(jsonb, boolean) from public, anon, authenticated;

-- Closing self-check.
do $c$
declare v_code text;
begin
  foreach v_code in array array['failed_sign_in_spike', 'staff_bulk_record_access', 'privileged_change', 'patient_data_export'] loop
    if not exists (select 1 from public.ops_alert_rules where code = v_code and enabled) then
      raise exception 'security alerts: rule % missing or off', v_code;
    end if;
    if to_regproc('private.ops_check_' || v_code) is null then
      raise exception 'security alerts: rule % has no check function', v_code;
    end if;
    if has_function_privilege('anon', ('private.ops_check_' || v_code || '(jsonb,boolean)')::regprocedure, 'EXECUTE')
       or has_function_privilege('authenticated', ('private.ops_check_' || v_code || '(jsonb,boolean)')::regprocedure, 'EXECUTE') then
      raise exception 'security alerts: check % is executable by a session role', v_code;
    end if;
  end loop;
end $c$;

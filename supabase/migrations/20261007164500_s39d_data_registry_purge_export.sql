-- S39d: one registry of every patient-keyed table, and three things built on it (founder direction 2026-10-07, OQ-262 to OQ-264).
--   * public.data_registry: every public table that holds a patient's rows (a patient_id column, or listed in staff_read_scope with its own
--     patient expression), with its retention class and what happens at the end of the period. Classification is PROPOSED (reviewed = false) until the CMO and DPO
--     confirm it; a proof fails if a new patient table is missing from it.
--   * public.purge_test_account(profile): deletes an is_test account and everything that references it, across every table, in one call. It refuses a real
--     account (is_test false), a caller who is not an admin or the service role, and the caller's own account. This replaces the manual purge of 2026-09-30.
--     Real patient data is NEVER erased (founder: do not erase); there is no path for it.
--   * public.export_patient_data(patient): the complete export, built from the registry, for an admin to fulfil a reviewed request. Credentials and tokens are removed.
--     data_export_requests gains due_at, the 30-day review clock (security_config v3: export_review_days).
--   * public.retention_review_report(): admin and CMO. Report only: rows older than each class's period; deletes nothing (real_data_auto_delete is false).
--   (The staff patient directory at /clinician/patients already searches the organisation; opening a chart is logged by S39c.)
-- private.is_org_staff is NOT edited. No patient data is changed. Applied with the version pinned to this filename.

-- 1. Config v3 ---------------------------------------------------------------------------
update public.security_config set is_active = false where is_active and version = 2;
insert into public.security_config (version, is_active, config)
-- security-rules-v3-begin
select 3, true, $json$
{"lookup_failure_alert_per_hour": 50, "record_open_window_hours": 8, "untied_open_alert_per_hour": 20, "after_hours_start": 22, "after_hours_end": 6,
 "export_review_days": 30,
 "retention": {"adult_clinical_record_years_after_last_contact": 8, "child_record_until_age": 25, "child_record_until_age_if_seen_at_17": 26,
   "maternity_record_years": 25, "mental_health_years_after_last_contact": 20, "access_audit_log_years": 8,
   "consent_years_after_relationship_end": 6, "payments_ledger_years": 6, "operational_data_days_min": 90, "operational_data_days_max": 730,
   "real_data_auto_delete": false}}
$json$::jsonb
where not exists (select 1 from public.security_config where version = 3);

-- 2. The registry ----------------------------------------------------------------------------
create table public.data_registry (
  table_name text primary key,
  patient_expr text not null default 'patient_id',
  retention_class text not null check (retention_class in ('clinical_record', 'mental_health', 'maternity', 'consent', 'financial', 'audit', 'operational')),
  end_of_retention text not null check (end_of_retention in ('review', 'delete')),
  in_export boolean not null default true,
  reviewed boolean not null default false,
  notes text
);
alter table public.data_registry enable row level security;
revoke all on public.data_registry from public, anon, authenticated;
grant select on public.data_registry to authenticated;
create policy data_registry_review on public.data_registry for select to authenticated using (private.can_review_access_log());
comment on table public.data_registry is 'S39d: every patient-keyed table, its retention class and export flag. PROPOSED classification (reviewed = false) until the CMO and DPO confirm. Changes are migrations.';

create function private.retention_class_for(p_table text) returns text language sql immutable set search_path = '' as
$$
  select case
    when p_table ~ 'audit|access_log|record_opens' then 'audit'
    when p_table ~ 'mental|phq|gad7|psych|wellbeing' then 'mental_health'
    when p_table ~ 'pregnan|postnatal|antenatal|maternity|labour|birth' then 'maternity'
    when p_table ~ 'consent|profile_access|care_access|waiver' then 'consent'
    when p_table ~ 'payment|invoice|ledger|voucher|refund|payout|billing|subscription|charge|wallet|journal|order_item|checkout' then 'financial'
    when p_table ~ 'notification|push_|device_token|session|reminder|nudge|delivery|otp|queue|digest|inbox|failure' then 'operational'
    else 'clinical_record'
  end
$$;

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export)
select t.table_name,
       coalesce(s.patient_expr, 'patient_id'),
       private.retention_class_for(t.table_name),
       case when private.retention_class_for(t.table_name) = 'operational' then 'delete' else 'review' end,
       private.retention_class_for(t.table_name) <> 'audit'
  from (
    select c.table_name
      from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.column_name = 'patient_id' and c.data_type = 'uuid'
    union
    select table_name from public.staff_read_scope where patient_expr is not null and to_regclass('public.' || table_name) is not null
       and (select table_type from information_schema.tables where table_schema = 'public' and table_name = staff_read_scope.table_name) = 'BASE TABLE'
  ) t
  left join public.staff_read_scope s on s.table_name = t.table_name
 where t.table_name not in ('data_registry', 'staff_read_scope', 'staff_read_policy_backup')
on conflict (table_name) do nothing;

-- 3. The test-account purge ------------------------------------------------------------------------
-- Walks every foreign key that points at the rows being removed. A nullable authorship column (recorded_by, actor_id) is set to null; any other row is
-- deleted, after the rows that point at it. Foreign-key checks stay ON, so the walk must delete children before parents. The append-only guards and
-- record-correction triggers would block it, so purge_test_account first walks once WITHOUT changing anything (p_apply = false) to learn which tables it
-- will touch, switches off only the enabled user triggers on those tables, walks again to change them, and switches the same triggers back on.
-- Only ever called by purge_test_account, which has already proven the account is a test account.
create function private.purge_refs(p_rel regclass, p_ids uuid[], p_apply boolean) returns void
language plpgsql security definer set search_path = '' as
$$
declare
  fk record; v_child_ids uuid[]; v_has_id boolean; v_new uuid[]; v_done boolean;
begin
  if coalesce(array_length(p_ids, 1), 0) = 0 then return; end if;
  for fk in
    select c.conrelid::regclass as child, c.conrelid as child_oid, a.attname as col, a.attnotnull as notnull
      from pg_constraint c
      join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
     where c.contype = 'f' and c.confrelid = p_rel and array_length(c.conkey, 1) = 1 and ra.attname = 'id'
       and (select n.nspname from pg_class k join pg_namespace n on n.oid = k.relnamespace where k.oid = c.conrelid) = 'public'
  loop
    insert into pg_temp.purge_touched (rel) values (fk.child_oid) on conflict do nothing;
    v_done := false;
    if p_apply and not fk.notnull and fk.col not in ('patient_id', 'profile_id', 'user_id', 'subject_id') then
      begin
        execute format('update %s set %I = null where %I = any($1)', fk.child, fk.col, fk.col) using p_ids;
        v_done := true;
      exception when others then v_done := false;   -- a check constraint ties this column to the row: delete the row instead
      end;
    end if;
    if not v_done then
      select exists (select 1 from pg_attribute where attrelid = fk.child_oid and attname = 'id' and atttypid = 'uuid'::regtype and not attisdropped) into v_has_id;
      if v_has_id then
        execute format('select coalesce(array_agg(id), ''{}'') from %s where %I = any($1)', fk.child, fk.col) into v_child_ids using p_ids;
        select coalesce(array_agg(x), '{}') into v_new from unnest(v_child_ids) x where not exists (select 1 from pg_temp.purge_seen s where s.rel = fk.child_oid and s.id = x);
        insert into pg_temp.purge_seen (rel, id) select fk.child_oid, x from unnest(v_new) x;
        perform private.purge_refs(fk.child, v_new, p_apply);
      end if;
      if p_apply then execute format('delete from %s where %I = any($1)', fk.child, fk.col) using p_ids; end if;
    end if;
  end loop;
end $$;
revoke all on function private.purge_refs(regclass, uuid[], boolean) from public, anon, authenticated;

create function public.purge_test_account(p_profile uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_is_test boolean; v_staff uuid[]; v_org uuid; tg record;
begin
  if (select auth.uid()) is not null and not private.is_admin() then raise exception 'only an admin or the service role can purge a test account' using errcode = '42501'; end if;
  if p_profile = (select auth.uid()) then raise exception 'you cannot purge your own account' using errcode = '42501'; end if;
  select is_test, organisation_id into v_is_test, v_org from public.profiles where id = p_profile;
  if not found then raise exception 'no such account' using errcode = 'P0002'; end if;
  if v_is_test is distinct from true then raise exception 'not a test account: real accounts are never deleted' using errcode = '42501'; end if;

  create temp table if not exists purge_seen (rel oid not null, id uuid not null) on commit drop;
  create temp table if not exists purge_touched (rel oid primary key) on commit drop;
  create temp table if not exists purge_disabled (rel regclass not null, trig name not null) on commit drop;
  truncate pg_temp.purge_seen, pg_temp.purge_touched, pg_temp.purge_disabled;
  select coalesce(array_agg(id), '{}') into v_staff from public.clinical_staff where profile_id = p_profile;

  -- pass 1: learn which tables will be touched, change nothing
  perform private.purge_refs('public.clinical_staff'::regclass, v_staff, false);
  perform private.purge_refs('public.profiles'::regclass, array[p_profile], false);
  insert into pg_temp.purge_touched (rel) values ('public.profiles'::regclass::oid), ('public.clinical_staff'::regclass::oid), ('public.staff_record_opens'::regclass::oid) on conflict do nothing;
  for tg in select t.tgrelid::regclass as rel, t.tgname from pg_trigger t join pg_temp.purge_touched pt on pt.rel = t.tgrelid where not t.tgisinternal and t.tgenabled = 'O' loop
    execute format('alter table %s disable trigger %I', tg.rel, tg.tgname);
    insert into pg_temp.purge_disabled values (tg.rel, tg.tgname);
  end loop;

  -- pass 2: change them
  truncate pg_temp.purge_seen;
  perform private.purge_refs('public.clinical_staff'::regclass, v_staff, true);
  delete from public.clinical_staff where profile_id = p_profile;
  perform private.purge_refs('public.profiles'::regclass, array[p_profile], true);
  delete from public.staff_record_opens where staff_id = p_profile or patient_id = p_profile;
  delete from public.profiles where id = p_profile;

  for tg in select rel, trig from pg_temp.purge_disabled loop
    execute format('alter table %s enable trigger %I', tg.rel, tg.trig);
  end loop;

  delete from auth.users where id = p_profile;
  perform private.log_audit('test_account_purge', 'profile', p_profile, jsonb_build_object('organisation_id', v_org));
  return jsonb_build_object('purged', true, 'profile', p_profile);
end $$;
revoke all on function public.purge_test_account(uuid) from public, anon;
grant execute on function public.purge_test_account(uuid) to authenticated, service_role;

-- 4. The complete export ---------------------------------------------------------------------------------
create function public.export_patient_data(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  r record; v_rows jsonb; v_out jsonb := '{}'::jsonb; v_profile jsonb;
begin
  if (select auth.uid()) is not null and not private.is_admin() then raise exception 'only an admin can fulfil an export' using errcode = '42501'; end if;
  if not exists (select 1 from public.profiles where id = p_patient and role = 'patient') then raise exception 'no such patient' using errcode = 'P0002'; end if;
  select to_jsonb(p) - 'id' into v_profile from public.profiles p where p.id = p_patient;
  for r in select table_name, patient_expr from public.data_registry where in_export order by table_name loop
    execute format(
      'select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(t)) e where e.key !~* ''token|secret|password|hash|api_key|passcode'')), ''[]''::jsonb) from public.%I t where (%s) = $1',
      r.table_name, r.patient_expr) into v_rows using p_patient;
    if jsonb_array_length(v_rows) > 0 then v_out := v_out || jsonb_build_object(r.table_name, v_rows); end if;
  end loop;
  perform private.log_audit('patient_data_export', 'patient', p_patient, jsonb_build_object('tables', (select count(*) from jsonb_object_keys(v_out))));
  return jsonb_build_object('generated_at', now(), 'patient', p_patient, 'profile', v_profile, 'tables', v_out);
end $$;
revoke all on function public.export_patient_data(uuid) from public, anon;
grant execute on function public.export_patient_data(uuid) to authenticated, service_role;

alter table public.data_export_requests add column due_at timestamptz;
update public.data_export_requests set due_at = requested_at + interval '30 days' where due_at is null;
alter table public.data_export_requests alter column due_at set default now() + interval '30 days';
alter table public.data_export_requests alter column due_at set not null;
comment on column public.data_export_requests.due_at is 'S39d: the review clock (security_config.export_review_days, 30 by default). Set at creation.';

-- 5. The retention review (report only) -----------------------------------------------------------------------
create function public.retention_review_report() returns table (table_name text, retention_class text, period text, rows_older_than_period bigint, reviewed boolean)
language plpgsql stable security definer set search_path = '' as
$$
declare r record; v_ret jsonb; v_cut timestamptz; v_n bigint; v_per text;
begin
  if not private.can_review_access_log() then raise exception 'not allowed' using errcode = '42501'; end if;
  select config -> 'retention' into v_ret from public.security_config where is_active;
  for r in select d.table_name as tn, d.retention_class as rc, d.reviewed as rv from public.data_registry d
            where exists (select 1 from information_schema.columns c where c.table_schema = 'public' and c.table_name = d.table_name and c.column_name = 'created_at') order by d.table_name loop
    v_cut := case r.rc
      when 'clinical_record' then now() - make_interval(years => (v_ret ->> 'adult_clinical_record_years_after_last_contact')::int)
      when 'mental_health' then now() - make_interval(years => (v_ret ->> 'mental_health_years_after_last_contact')::int)
      when 'maternity' then now() - make_interval(years => (v_ret ->> 'maternity_record_years')::int)
      when 'consent' then now() - make_interval(years => (v_ret ->> 'consent_years_after_relationship_end')::int)
      when 'financial' then now() - make_interval(years => (v_ret ->> 'payments_ledger_years')::int)
      when 'audit' then now() - make_interval(years => (v_ret ->> 'access_audit_log_years')::int)
      else now() - make_interval(days => (v_ret ->> 'operational_data_days_max')::int) end;
    v_per := case r.rc when 'operational' then (v_ret ->> 'operational_data_days_max') || ' days' else to_char(now() - v_cut, 'YY') || ' years' end;
    execute format('select count(*) from public.%I where created_at < $1', r.tn) into v_n using v_cut;
    table_name := r.tn; retention_class := r.rc; period := v_per; rows_older_than_period := v_n; reviewed := r.rv;
    return next;
  end loop;
end $$;
revoke all on function public.retention_review_report() from public, anon;
grant execute on function public.retention_review_report() to authenticated;

-- 6. Self-check -------------------------------------------------------------------------------------------------------------
do $$
declare v_missing text;
begin
  if (select version from public.security_config where is_active) <> 3 then raise exception 'S39d: security_config v3 is not active'; end if;
  select string_agg(c.table_name, ', ') into v_missing
    from information_schema.columns c join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'patient_id' and c.data_type = 'uuid'
     and c.table_name not in (select table_name from public.data_registry);
  if v_missing is not null then raise exception 'S39d: patient tables missing from the registry: %', v_missing; end if;
  if has_function_privilege('anon', 'public.purge_test_account(uuid)', 'EXECUTE') or has_function_privilege('anon', 'public.export_patient_data(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.retention_review_report()', 'EXECUTE') then
    raise exception 'S39d: anon can execute';
  end if;
end $$;

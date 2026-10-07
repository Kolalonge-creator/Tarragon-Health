-- S66 (Module 16, functions 16.1, 16.2, 16.4; decisions A14, A15, B3, C): the database half of the private cycle tracker.
--
-- WHAT THIS ADDS (all structural; live row counts checked 2026-10-07: menstrual_cycles 0, menstrual_daily_logs 0, menopause_symptom_logs 0,
-- reproductive_health_profiles 0, contraception_plans 0, so there is no data to convert and no backfill step is missing):
--   1. Conception planning mode (A14): reproductive_health_profiles.conception_planning_mode, default FALSE. It is a display switch the
--      patient flips (RPC set_conception_planning_mode); a trigger stops anyone but the patient (a guardian with 'manage' access, a clinician)
--      switching it ON. Nothing is computed or stored on the server about fertility; the app derives a window only while the switch is on.
--   2. Provenance on the menopause log (CLAUDE.md "source and recorded_by on clinical tables"): source ('patient' or 'clinician') and
--      recorded_by, both set by a trigger from the session, never trusted from the client. recorded_by is ON DELETE SET NULL, not RESTRICT:
--      the patient's own rows would otherwise block deleting the profile that also cascades them.
--   3. Deletion on request (decision C, B3): reproductive_deletion_requests plus request / cancel / status RPCs for the patient and a
--      service-role processor. The patient asks; a grace window (reproductive_privacy_config, PROPOSED 14 days) lets her change her mind;
--      then everything she entered in the cycle tracker and the menopause log is deleted and a RECEIPT (counts only, never content) is
--      written to the immutable audit_log. Data a clinician recorded or acted on is SEALED, not erased: a menopause log row that raised a
--      clinician alert (or was entered by staff) stays, and the receipt says how many were kept and why.
--      The sealed-data destruction after the retention period (PROPOSED 8 years, counsel to confirm) is configuration only here; no job
--      destroys anything (founder 2026-10-07: do not auto-delete real data). Recorded as OQ-330.
--   4. reproductive_privacy_config: the versioned numbers (grace days, sealed years, report window), mirrored in the PROPOSED registry.
--
-- WHAT THIS DOES NOT TOUCH: any RLS policy. The live policies on the cycle tables were rewritten live by S39b (staff_may_read) and S39g
-- (staff_may_write) and are not in this branch's base, so this migration deliberately replaces none of them; it adds no read path for staff.
-- The staff read path is the audited function in the next migration.

-- ---------------------------------------------------------------------------
-- 1. Versioned rules (PROPOSED, mirrored in packages/shared/src/proposed-config/registry.ts)
-- ---------------------------------------------------------------------------
create table public.reproductive_privacy_config (
  version     integer primary key,
  is_active   boolean not null default false,
  config      jsonb not null,
  created_at  timestamptz not null default now()
);
create unique index reproductive_privacy_config_one_active on public.reproductive_privacy_config (is_active) where is_active;
alter table public.reproductive_privacy_config enable row level security;
revoke all on public.reproductive_privacy_config from public, anon, authenticated;
comment on table public.reproductive_privacy_config is
  'S66: PROPOSED numbers for cycle-data deletion and the clinician pattern report. Read only by SECURITY DEFINER functions. Mirror: reproductive_privacy.rules in the PROPOSED registry (a test fails on drift).';

-- reproductive-privacy-rules-begin
insert into public.reproductive_privacy_config (version, is_active, config)
select 1, true, $json$
{"deletion_grace_days": 14, "sealed_retention_years": 8, "report_window_months": 12}
$json$::jsonb
where not exists (select 1 from public.reproductive_privacy_config where version = 1);
-- reproductive-privacy-rules-end

create function private.reproductive_privacy_rule(p_key text) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare v_val integer;
begin
  select (c.config ->> p_key)::integer into v_val from public.reproductive_privacy_config c where c.is_active;
  if v_val is null then
    -- fail closed: a missing rule must stop the operation, never fall back to a guessed number
    raise exception 'reproductive privacy rule % is not configured', p_key using errcode = '55000';
  end if;
  return v_val;
end $$;
revoke all on function private.reproductive_privacy_rule(text) from public, anon;

-- ---------------------------------------------------------------------------
-- 2. Conception planning mode (A14)
-- ---------------------------------------------------------------------------
alter table public.reproductive_health_profiles
  add column conception_planning_mode boolean not null default false,
  add column conception_planning_changed_at timestamptz;
comment on column public.reproductive_health_profiles.conception_planning_mode is
  'S66 (A14): the patient''s explicit "planning a pregnancy" switch. OFF by default. Only while ON may any surface show a fertile window, an ovulation date or the ovulation test and temperature fields. Never used as contraception.';

create function private.guard_conception_planning_mode() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  -- Switching it ON is the patient's own act. A guardian with 'manage' access, a clinician or an admin cannot do it for her; switching it
  -- OFF is allowed to anyone who can already write the row (less exposure, never more). The service role (no uid) is trusted.
  if new.conception_planning_mode
     and (tg_op = 'INSERT' or old.conception_planning_mode is distinct from new.conception_planning_mode)
     and v_uid is not null and v_uid <> new.patient_id then
    raise exception 'only the patient can turn planning mode on' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' or old.conception_planning_mode is distinct from new.conception_planning_mode then
    new.conception_planning_changed_at := now();
  end if;
  return new;
end $$;
revoke all on function private.guard_conception_planning_mode() from public, anon;
create trigger reproductive_health_profiles_guard_planning
  before insert or update on public.reproductive_health_profiles
  for each row execute function private.guard_conception_planning_mode();

create function public.set_conception_planning_mode(p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if p_on is null then raise exception 'say on or off' using errcode = '22023'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'only a patient can change this' using errcode = '42501'; end if;
  insert into public.reproductive_health_profiles (organisation_id, patient_id, conception_planning_mode)
  values (v_org, v_uid, p_on)
  on conflict (patient_id) do update set conception_planning_mode = excluded.conception_planning_mode;
  return jsonb_build_object('conception_planning_mode', p_on);
end $$;
revoke all on function public.set_conception_planning_mode(boolean) from public, anon;
grant execute on function public.set_conception_planning_mode(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Provenance on the menopause log
-- ---------------------------------------------------------------------------
alter table public.menopause_symptom_logs
  add column source text not null default 'patient' check (source in ('patient', 'clinician')),
  add column recorded_by uuid references public.profiles (id) on delete set null;

create function private.stamp_menopause_log_provenance() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  -- Derived from the session. A client-supplied value is overwritten, so a patient cannot dress her own row as a clinician's (which would
  -- seal it) and staff cannot pass a row off as hers (which would let a deletion request remove a clinician's record).
  new.recorded_by := v_uid;
  new.source := case
    when v_uid is null or v_uid = new.patient_id then 'patient'
    when exists (select 1 from public.profiles p where p.id = v_uid and p.role in ('clinician', 'admin')) then 'clinician'
    else 'patient'
  end;
  return new;
end $$;
revoke all on function private.stamp_menopause_log_provenance() from public, anon;
-- "aaa" sorts before the alert trigger so the alert id is added to a row that already carries its provenance.
create trigger menopause_symptom_logs_aaa_provenance
  before insert on public.menopause_symptom_logs
  for each row execute function private.stamp_menopause_log_provenance();

-- ---------------------------------------------------------------------------
-- 4. Deletion on request
-- ---------------------------------------------------------------------------
create table public.reproductive_deletion_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  status           text not null default 'pending' check (status in ('pending', 'cancelled', 'completed')),
  requested_at     timestamptz not null default now(),
  execute_after    timestamptz not null,
  cancelled_at     timestamptz,
  completed_at     timestamptz,
  receipt          jsonb,
  is_test          boolean not null default false,
  constraint reproductive_deletion_completed_has_receipt check (status <> 'completed' or (completed_at is not null and receipt is not null)),
  constraint reproductive_deletion_cancelled_has_time check (status <> 'cancelled' or cancelled_at is not null)
);
create unique index reproductive_deletion_one_pending on public.reproductive_deletion_requests (patient_id) where status = 'pending';
create index reproductive_deletion_due_idx on public.reproductive_deletion_requests (execute_after) where status = 'pending';
alter table public.reproductive_deletion_requests enable row level security;
-- The patient reads her own request. No staff, caregiver, sponsor or employer policy exists, on purpose. No write policy at all: the
-- RPCs below (definer) are the only way to change it.
create policy reproductive_deletion_requests_own on public.reproductive_deletion_requests
  for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.reproductive_deletion_requests from public, anon, authenticated;
grant select on public.reproductive_deletion_requests to authenticated;

-- What a request would delete and what it would keep, for the confirmation screen and the receipt.
create function private.reproductive_deletable_counts(p_patient uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'menstrual_cycles', (select count(*) from public.menstrual_cycles where patient_id = p_patient),
    'menstrual_daily_logs', (select count(*) from public.menstrual_daily_logs where patient_id = p_patient),
    'menopause_logs_deleted', (select count(*) from public.menopause_symptom_logs where patient_id = p_patient and source = 'patient' and clinician_alert_id is null),
    'menopause_logs_sealed', (select count(*) from public.menopause_symptom_logs where patient_id = p_patient and (source <> 'patient' or clinician_alert_id is not null)),
    'reminders', (select count(*) from public.notifications where recipient_id = p_patient and template like 'cycle\_period\_%' escape '\')
  )
$$;
revoke all on function private.reproductive_deletable_counts(uuid) from public, anon;

create function public.request_reproductive_tracker_deletion() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_test boolean;
  v_existing public.reproductive_deletion_requests;
  v_grace integer;
  v_row public.reproductive_deletion_requests;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select organisation_id, is_test into v_org, v_test from public.profiles where id = v_uid and role = 'patient';
  if v_org is null then raise exception 'only a patient can ask for this' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('reproductive_deletion:' || v_uid::text, 0));
  select * into v_existing from public.reproductive_deletion_requests where patient_id = v_uid and status = 'pending';
  if found then
    return jsonb_build_object('status', 'pending', 'execute_after', v_existing.execute_after, 'already_asked', true,
                              'counts', private.reproductive_deletable_counts(v_uid));
  end if;
  v_grace := private.reproductive_privacy_rule('deletion_grace_days');
  insert into public.reproductive_deletion_requests (organisation_id, patient_id, execute_after, is_test)
  values (v_org, v_uid, now() + make_interval(days => v_grace), coalesce(v_test, false))
  returning * into v_row;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_org, v_uid, 'reproductive_deletion.requested', 'reproductive_deletion_request', v_row.id,
          jsonb_build_object('execute_after', v_row.execute_after, 'grace_days', v_grace), 'success', v_uid);
  return jsonb_build_object('status', 'pending', 'execute_after', v_row.execute_after, 'already_asked', false,
                            'counts', private.reproductive_deletable_counts(v_uid));
end $$;

create function public.cancel_reproductive_tracker_deletion() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_row public.reproductive_deletion_requests;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  update public.reproductive_deletion_requests
     set status = 'cancelled', cancelled_at = now()
   where patient_id = v_uid and status = 'pending' and execute_after > now()
   returning * into v_row;
  if not found then return jsonb_build_object('cancelled', false); end if;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (v_row.organisation_id, v_uid, 'reproductive_deletion.cancelled', 'reproductive_deletion_request', v_row.id, '{}'::jsonb, 'success', v_uid);
  return jsonb_build_object('cancelled', true);
end $$;

create function public.reproductive_tracker_deletion_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  v_pending public.reproductive_deletion_requests;
  v_last public.reproductive_deletion_requests;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into v_pending from public.reproductive_deletion_requests where patient_id = v_uid and status = 'pending';
  select * into v_last from public.reproductive_deletion_requests where patient_id = v_uid and status = 'completed' order by completed_at desc limit 1;
  return jsonb_build_object(
    'pending', case when v_pending.id is null then null else jsonb_build_object('execute_after', v_pending.execute_after, 'requested_at', v_pending.requested_at) end,
    'last_receipt', case when v_last.id is null then null else jsonb_build_object('completed_at', v_last.completed_at, 'receipt', v_last.receipt) end,
    'counts', private.reproductive_deletable_counts(v_uid));
end $$;

-- The processor: service role only (a cron route). Safe to run repeatedly: a request is completed once.
create function private.process_reproductive_deletion(p_request uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.reproductive_deletion_requests;
  v_cycles integer; v_logs integer; v_meno integer; v_sealed integer; v_notes integer; v_receipt jsonb;
begin
  select * into r from public.reproductive_deletion_requests where id = p_request for update;
  if not found or r.status <> 'pending' then return null; end if;
  if r.execute_after > now() then raise exception 'the grace window is still open' using errcode = '55000'; end if;

  delete from public.menstrual_cycles where patient_id = r.patient_id;
  get diagnostics v_cycles = row_count;
  delete from public.menstrual_daily_logs where patient_id = r.patient_id;
  get diagnostics v_logs = row_count;
  -- Sealed, not erased: a row a clinician entered, or one that raised a clinician alert (the alert is itself a clinical record).
  delete from public.menopause_symptom_logs where patient_id = r.patient_id and source = 'patient' and clinician_alert_id is null;
  get diagnostics v_meno = row_count;
  select count(*) into v_sealed from public.menopause_symptom_logs where patient_id = r.patient_id;
  delete from public.notifications where recipient_id = r.patient_id and template like 'cycle\_period\_%' escape '\';
  get diagnostics v_notes = row_count;
  update public.reproductive_health_profiles
     set last_period_date = null, average_cycle_length_days = null, conception_planning_mode = false
   where patient_id = r.patient_id;

  v_receipt := jsonb_build_object(
    'menstrual_cycles_deleted', v_cycles, 'menstrual_daily_logs_deleted', v_logs, 'menopause_logs_deleted', v_meno,
    'menopause_logs_sealed_kept', v_sealed, 'reminders_deleted', v_notes,
    'sealed_reason', 'recorded or acted on by the care team, kept sealed under the retention rule',
    'profile_fields_cleared', jsonb_build_array('last_period_date', 'average_cycle_length_days', 'conception_planning_mode'));
  update public.reproductive_deletion_requests set status = 'completed', completed_at = now(), receipt = v_receipt where id = r.id;
  -- The receipt carries counts only, never what was deleted.
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, result, subject_patient_id)
  values (r.organisation_id, null, 'reproductive_deletion.completed', 'reproductive_deletion_request', r.id, v_receipt, 'success', r.patient_id);
  return v_receipt;
end $$;

create function public.process_due_reproductive_tracker_deletions() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_done integer := 0;
begin
  if coalesce((select auth.role()), '') <> 'service_role' then
    raise exception 'service role only' using errcode = '42501';
  end if;
  for v_id in select id from public.reproductive_deletion_requests where status = 'pending' and execute_after <= now() order by execute_after limit 200 loop
    if private.process_reproductive_deletion(v_id) is not null then v_done := v_done + 1; end if;
  end loop;
  return v_done;
end $$;

revoke all on function private.process_reproductive_deletion(uuid) from public, anon;
revoke all on function public.request_reproductive_tracker_deletion() from public, anon;
revoke all on function public.cancel_reproductive_tracker_deletion() from public, anon;
revoke all on function public.reproductive_tracker_deletion_status() from public, anon;
revoke all on function public.process_due_reproductive_tracker_deletions() from public, anon, authenticated;
grant execute on function public.request_reproductive_tracker_deletion() to authenticated;
grant execute on function public.cancel_reproductive_tracker_deletion() to authenticated;
grant execute on function public.reproductive_tracker_deletion_status() to authenticated;
grant execute on function public.process_due_reproductive_tracker_deletions() to service_role;

-- ---------------------------------------------------------------------------
-- 5. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'reproductive_deletion_requests' and rowsecurity) then
    raise exception 'S66: reproductive_deletion_requests missing or RLS off';
  end if;
  if has_table_privilege('anon', 'public.reproductive_deletion_requests', 'SELECT')
     or has_table_privilege('authenticated', 'public.reproductive_deletion_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.reproductive_deletion_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.reproductive_deletion_requests', 'DELETE') then
    raise exception 'S66: reproductive_deletion_requests has the wrong table privileges';
  end if;
  if has_table_privilege('authenticated', 'public.reproductive_privacy_config', 'SELECT') then
    raise exception 'S66: reproductive_privacy_config must not be readable by clients';
  end if;
  if has_function_privilege('anon', 'public.set_conception_planning_mode(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_reproductive_tracker_deletion()', 'EXECUTE')
     or has_function_privilege('anon', 'public.cancel_reproductive_tracker_deletion()', 'EXECUTE')
     or has_function_privilege('anon', 'public.reproductive_tracker_deletion_status()', 'EXECUTE')
     or has_function_privilege('anon', 'public.process_due_reproductive_tracker_deletions()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.process_due_reproductive_tracker_deletions()', 'EXECUTE') then
    raise exception 'S66: a function is executable by a role that must not run it';
  end if;
  if not has_function_privilege('service_role', 'public.process_due_reproductive_tracker_deletions()', 'EXECUTE') then
    raise exception 'S66: the processor must be callable by the service role';
  end if;
  if (select count(*) from public.reproductive_privacy_config where is_active) <> 1 then
    raise exception 'S66: exactly one active reproductive_privacy_config row is required';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'reproductive_deletion_requests'
              and (qual ilike '%is_org_staff%' or qual ilike '%profile_access%')) then
    raise exception 'S66: no staff or caregiver policy may exist on reproductive_deletion_requests';
  end if;
  raise notice 'PASS: S66 private cycle foundations installed';
end $$;

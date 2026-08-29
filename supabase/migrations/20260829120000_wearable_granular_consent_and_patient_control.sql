-- Tarragon Health
-- Wearables & Digital Biometrics: granular per-category consent + the
-- patient-control actions the shipped Connect UI (CLAUDE.md's Device &
-- Wearable Integration section) never got past connect/disconnect.
--
-- 1. Granular consent (per-category opt-in, not one blanket "connect" grant).
--    The four categories named are exactly the ones the platform actually
--    syncs into a patient-visible surface today: steps/workouts (activity),
--    resting heart rate + HRV + respiratory rate (heart_rate), sleep, and
--    weight. Glucose/blood pressure/SpO2 are deliberately NOT gated by these
--    columns -- they already flow through vitals_readings' own
--    plan-gated red-flag/escalation pipeline (vitals_red_flag_doctor_escalation),
--    which is the more load-bearing consent surface for those, and forcing
--    a second consumer-facing checkbox in front of a clinically-relevant
--    signal would be the wrong kind of friction. Defaulting all four to true
--    preserves every existing connection's current behaviour -- a patient
--    who connected before this migration keeps syncing exactly what they
--    already were, and only a new choice (unchecking a category before
--    connecting, or narrowing it afterwards) changes what syncs.
--
-- 2. `paused` connection status. Today a patient can only connect or
--    disconnect; there is no way to temporarily stop a sync without losing
--    the connection (and its stored tokens) outright. Both push (sync.ts's
--    resolveConnection) and pull (pullConnection's cron sweep) already filter
--    on status = 'active', so adding a third status value that simply isn't
--    'active' is enough to stop a paused connection being synced by either
--    path with no further code change.
--
-- 3. delete_wearable_connection_data(): 53.13's "delete/revoke future access"
--    half. wearable_readings has no authenticated DELETE grant at all (by
--    design -- see its own migration) and vitals_readings rows written from a
--    sync are provenance-locked, so a patient cannot erase their own synced
--    data by any existing grant. This is a narrowly-scoped SECURITY DEFINER
--    escape hatch: it only ever touches rows the calling patient's own
--    connection produced, and it revokes the stored tokens + marks the
--    connection disconnected in the same transaction, so "delete my data"
--    also means "and stop pulling more of it."

-- 1 ----------------------------------------------------------------------
alter table public.wearable_connections
  add column if not exists consent_activity   boolean not null default true,
  add column if not exists consent_heart_rate boolean not null default true,
  add column if not exists consent_sleep      boolean not null default true,
  add column if not exists consent_weight     boolean not null default true;

comment on column public.wearable_connections.consent_activity is
  'Patient-granted permission to sync steps/workouts/calories from this connection. Set at connect time, editable afterwards. A denied category is dropped at ingestion, not merely hidden.';
comment on column public.wearable_connections.consent_heart_rate is
  'Patient-granted permission to sync resting heart rate / HRV / respiratory rate from this connection.';
comment on column public.wearable_connections.consent_sleep is
  'Patient-granted permission to sync sleep duration/efficiency from this connection.';
comment on column public.wearable_connections.consent_weight is
  'Patient-granted permission to sync weight from this connection.';

-- The 20260808030359 migration narrowed the authenticated UPDATE grant on
-- this table to (status, last_synced_at, last_sync_error) only -- the four
-- consent columns need the same explicit column-level grant, or a patient's
-- own RLS-admitted UPDATE silently can't move them.
grant update (
  consent_activity, consent_heart_rate, consent_sleep, consent_weight
) on public.wearable_connections to authenticated;

-- 2 ----------------------------------------------------------------------
alter type public.wearable_connection_status add value if not exists 'paused';

-- 3 ----------------------------------------------------------------------
create or replace function public.delete_wearable_connection_data(p_connection_id uuid)
returns table (vitals_deleted bigint, wearable_readings_deleted bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner uuid;
  v_vitals_deleted bigint;
  v_readings_deleted bigint;
begin
  select patient_id into v_owner
  from public.wearable_connections
  where id = p_connection_id
  for update;

  if v_owner is null then
    raise exception 'wearable connection % not found', p_connection_id;
  end if;
  -- `is distinct from`, not `<>`: auth.uid() is null for any caller with no
  -- authenticated session (this function's own migration context included),
  -- and `uuid <> null` evaluates to null -- which a plpgsql IF treats as
  -- false, i.e. NOT raising. That would fail closed only by accident. `is
  -- distinct from` treats null as a real value to compare against, so a
  -- missing identity is denied exactly like a mismatched one.
  if v_owner is distinct from auth.uid() then
    raise exception 'not authorised to delete this connection''s data';
  end if;

  delete from public.vitals_readings where wearable_connection_id = p_connection_id;
  get diagnostics v_vitals_deleted = row_count;

  delete from public.wearable_readings where connection_id = p_connection_id;
  get diagnostics v_readings_deleted = row_count;

  -- Revoke future access in the same transaction as the erasure -- a
  -- "delete my data" action that left live tokens behind would let the next
  -- webhook/cron sweep repopulate exactly what was just deleted.
  update public.wearable_connections
  set status = 'disconnected',
      access_token = null,
      refresh_token = null,
      token_expires_at = null,
      last_sync_error = 'Patient deleted synced data'
  where id = p_connection_id;

  return query select v_vitals_deleted, v_readings_deleted;
end;
$$;

comment on function public.delete_wearable_connection_data(uuid) is
  'Patient-initiated erasure of everything a wearable connection synced (53.13 "delete/revoke future access"): deletes the connection''s vitals_readings and wearable_readings rows, nulls its stored OAuth tokens, and marks it disconnected. Callable only by the connection''s own patient_id (auth.uid()) -- never by org staff, and never for someone else''s connection.';

revoke all on function public.delete_wearable_connection_data(uuid) from public, anon;
grant execute on function public.delete_wearable_connection_data(uuid) to authenticated;

-- Provable, not hopeful ---------------------------------------------------
do $$
declare
  v_org uuid;
  v_patient uuid := gen_random_uuid();
  v_connection uuid;
begin
  if (
    select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'wearable_connections'
      and column_name in ('consent_activity', 'consent_heart_rate', 'consent_sleep', 'consent_weight')
  ) <> 4 then
    raise exception 'wearable_connections consent columns missing';
  end if;

  if not has_column_privilege('authenticated', 'public.wearable_connections', 'consent_activity', 'UPDATE') then
    raise exception 'authenticated cannot update consent_activity';
  end if;

  if not exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'wearable_connection_status' and e.enumlabel = 'paused'
  ) then
    raise exception 'wearable_connection_status is missing paused';
  end if;

  if has_function_privilege('anon', 'public.delete_wearable_connection_data(uuid)', 'EXECUTE') then
    raise exception 'anon can execute delete_wearable_connection_data';
  end if;
  if not has_function_privilege('authenticated', 'public.delete_wearable_connection_data(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute delete_wearable_connection_data';
  end if;

  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise notice 'no organisation available; skipping behavioural assertions';
    return;
  end if;

  -- A synthetic patient, not an existing one: wearable_connections_patient_
  -- provider_active_idx allows only one active connection per (patient,
  -- provider), so reusing a real patient row here could collide with a
  -- fitbit connection that already exists for them.
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_patient, 'wgcpc-migration-test@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'WGCPC Migration Test Patient');

  insert into public.wearable_connections
    (organisation_id, patient_id, provider, status, external_id, access_token, refresh_token)
  values (v_org, v_patient, 'fitbit', 'active', 'consent-test-account', 'tok', 'refresh')
  returning id into v_connection;

  -- This migration runs with no authenticated session (auth.uid() is null
  -- here), so calling the function directly proves the fail-closed default:
  -- a real connection owner (v_patient) is_distinct_from a null caller
  -- identity, so it must reject rather than silently succeed. The full
  -- positive-path proof (the rightful patient session succeeds and the rows
  -- are actually gone) needs a genuine simulated RLS session and lives in
  -- packages/db/tests/wearable_granular_consent_and_patient_control.sql,
  -- matching this codebase's convention for RLS-session-simulated proofs.
  begin
    perform public.delete_wearable_connection_data(v_connection);
    raise exception 'delete_wearable_connection_data ran with no authenticated caller';
  exception
    when others then
      if sqlerrm not like 'not authorised%' then
        raise;
      end if;
  end;

  -- Unlike the fixtures in most of this repo's migration DO blocks (which
  -- reuse a pre-existing org/profile), this one created a synthetic
  -- auth.users + profiles row above and must remove all three itself, or a
  -- fake patient would persist in production forever. wearable_connections
  -- already cascades off profiles, but deleting it explicitly first keeps
  -- the cleanup order obvious rather than relying on the cascade.
  delete from public.wearable_connections where id = v_connection;
  delete from public.profiles where id = v_patient;
  delete from auth.users where id = v_patient;
end $$;

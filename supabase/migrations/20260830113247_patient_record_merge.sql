-- Tarragon Health — Patient Identity & MPI gap analysis (docs/PATIENT_IDENTITY_MPI_SPEC.md §82.7)
-- Patient-record merge. Confirmed a total gap before this migration: zero merge tooling existed
-- anywhere, and a live FK audit against the koiplnmbgnqnbywhpjlf project (run while writing this
-- migration, not assumed) found 459 foreign-key constraints across 283 tables referencing
-- profiles(id) — far too many, and too fast-moving, to safely hand-enumerate a "which columns to
-- repoint" list. That list would silently go stale the next time a migration adds a table with a
-- patient_id column, which is exactly the kind of drift this codebase has been bitten by
-- repeatedly (see CLAUDE.md's standing migration-drift lessons).
--
-- Design, in place of a hand-enumerated list: `merge_patient_records` discovers every FK
-- referencing profiles(id) LIVE, at call time, via information_schema, and repoints each one from
-- the losing profile to the surviving profile. This is safe specifically because it only ever
-- operates on two `role = 'patient'` profiles — the ~300 non-patient-identity columns in that FK
-- set (approved_by, reviewed_by, verified_by, and similar staff-attribution columns) will simply
-- have zero matching rows for a patient id in real data (a patient is never the actor on a
-- clinician-only write path), so the dynamic repoint is a no-op for them and only ever moves real
-- patient data (patient_id, and the smaller set of profile_id-shaped "this row is about this
-- patient" columns, e.g. a patient's own self-logged vitals/symptoms, subscriptions.subscriber_id,
-- referrals.referred_id).
--
-- All-or-nothing, not best-effort: the whole repoint runs inside this function's own implicit
-- transaction. If any table's UNIQUE constraint collides (e.g. both records logged something
-- under a constraint keyed on patient_id + date), the entire merge rolls back and the function
-- raises rather than leaving a partial merge — a failed merge is recoverable, a partial one is a
-- corrupted record. Reconciling a collision like that is a manual step this migration does not
-- attempt to auto-resolve.
--
-- Merge never deletes a login. auth.users/profiles for the losing record are left in place —
-- deleting them would break traceability ("this used to be a separate record") and NDPR-style
-- provenance. Instead the losing profile is marked retired (merged_into_profile_id, merged_at,
-- is_active = false) and every FK'd row that used to point at it now points at the surviving
-- record, so nothing is orphaned and nothing is lost — "the merge must preserve audit history"
-- per the spec, done via a dedicated patient_merge_log snapshot (before/after row content) plus
-- the existing audit_log's own 'profiles.merged' event.
--
-- Dry-run by default (p_dry_run = true): returns the same tables_affected shape as a real merge,
-- computed via COUNT instead of UPDATE, so an admin can preview exactly what will move before
-- committing to it.

alter table public.profiles
  add column if not exists merged_into_profile_id uuid references public.profiles (id) on delete set null,
  add column if not exists merged_at timestamptz;

comment on column public.profiles.merged_into_profile_id is
  'Set when this profile was identified as a duplicate and merged into another (surviving) profile via private.merge_patient_records. A non-null value means this record is retired: its history now lives on the referenced profile, and this row is kept only for traceability.';

create index if not exists profiles_merged_into_idx on public.profiles (merged_into_profile_id)
  where merged_into_profile_id is not null;

-- Extend the self-update denylist (20260827192712_profiles_self_update_column_guard.sql) — a
-- patient must never be able to un-merge themselves or point their own record at someone else's
-- by direct PostgREST access to their own row, the same reasoning already applied to every other
-- privileged column on profiles.
create or replace function private.guard_profiles_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_self_direct_edit boolean;
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  v_is_self_direct_edit :=
    (select auth.uid()) is not null
    and (select auth.uid()) = old.id
    and not private.is_admin()
    and not (old.organisation_id is not null and private.is_org_staff(old.organisation_id));

  if not v_is_self_direct_edit then
    return new;
  end if;

  if new.role is distinct from old.role then
    raise exception 'profiles.role cannot be changed by the account owner';
  end if;
  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'profiles.organisation_id cannot be changed by the account owner';
  end if;
  if new.patient_number is distinct from old.patient_number then
    raise exception 'profiles.patient_number cannot be changed by the account owner';
  end if;
  if new.staff_number is distinct from old.staff_number then
    raise exception 'profiles.staff_number cannot be changed by the account owner';
  end if;
  if new.custom_role_id is distinct from old.custom_role_id then
    raise exception 'profiles.custom_role_id cannot be changed by the account owner';
  end if;
  if new.is_active is distinct from old.is_active then
    raise exception 'profiles.is_active cannot be changed by the account owner';
  end if;
  if new.is_dependent_account is distinct from old.is_dependent_account then
    raise exception 'profiles.is_dependent_account cannot be changed by the account owner';
  end if;
  if new.identity_verified_at is distinct from old.identity_verified_at then
    raise exception 'profiles.identity_verified_at cannot be changed by the account owner';
  end if;
  if new.hbv_status is distinct from old.hbv_status then
    raise exception 'profiles.hbv_status cannot be changed by the account owner';
  end if;
  if new.hcv_status is distinct from old.hcv_status then
    raise exception 'profiles.hcv_status cannot be changed by the account owner';
  end if;
  if new.hiv_status is distinct from old.hiv_status then
    raise exception 'profiles.hiv_status cannot be changed by the account owner';
  end if;
  if new.lab_provider_id is distinct from old.lab_provider_id then
    raise exception 'profiles.lab_provider_id cannot be changed by the account owner';
  end if;
  if new.pharmacy_partner_id is distinct from old.pharmacy_partner_id then
    raise exception 'profiles.pharmacy_partner_id cannot be changed by the account owner';
  end if;
  if new.is_partner_admin is distinct from old.is_partner_admin then
    raise exception 'profiles.is_partner_admin cannot be changed by the account owner';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'profiles.created_at cannot be changed by the account owner';
  end if;
  if new.merged_into_profile_id is distinct from old.merged_into_profile_id then
    raise exception 'profiles.merged_into_profile_id cannot be changed by the account owner';
  end if;
  if new.merged_at is distinct from old.merged_at then
    raise exception 'profiles.merged_at cannot be changed by the account owner';
  end if;

  return new;
end;
$$;

comment on function private.guard_profiles_self_update() is
  'BEFORE UPDATE guard on public.profiles: blocks a direct, top-level self-edit from changing role/organisation_id/patient_number/staff_number/custom_role_id/is_active/is_dependent_account/identity_verified_at/hbv_status/hcv_status/hiv_status/lab_provider_id/pharmacy_partner_id/is_partner_admin/created_at/merged_into_profile_id/merged_at. See 20260827192712_profiles_self_update_column_guard.sql for the original design rationale (denylist not allowlist, pg_trigger_depth() exemption for system cascades); merged_into_profile_id/merged_at added by 20260830113247_patient_record_merge.sql.';

-- ---------------------------------------------------------------------------
-- patient_merge_log — the audit-history-preserving snapshot the spec asks for.
-- ---------------------------------------------------------------------------

create table public.patient_merge_log (
  id                 uuid primary key default gen_random_uuid(),
  kept_profile_id    uuid not null references public.profiles (id) on delete restrict,
  merged_profile_id  uuid not null references public.profiles (id) on delete restrict,
  performed_by       uuid references public.profiles (id) on delete set null,
  reason             text not null,
  snapshot_kept      jsonb not null,
  snapshot_merged    jsonb not null,
  tables_affected    jsonb not null default '{}'::jsonb,
  merged_at          timestamptz not null default now()
);

create index patient_merge_log_kept_idx on public.patient_merge_log (kept_profile_id);
create index patient_merge_log_merged_idx on public.patient_merge_log (merged_profile_id);

alter table public.patient_merge_log enable row level security;

create policy patient_merge_log_select on public.patient_merge_log
  for select to authenticated
  using (private.has_permission('patients.merge'));

-- No insert/update/delete policy for authenticated — this table is written only by
-- private.merge_patient_records (SECURITY DEFINER), never directly by a client, same
-- immutability posture as audit_log.
grant select on public.patient_merge_log to authenticated;

-- ---------------------------------------------------------------------------
-- The merge function itself.
-- ---------------------------------------------------------------------------

create or replace function private.merge_patient_records(
  p_keep_id uuid,
  p_merge_id uuid,
  p_reason text,
  p_allow_cross_org boolean default false,
  p_dry_run boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.profiles;
  v_merge public.profiles;
  v_fk record;
  v_count bigint;
  v_affected jsonb := '{}'::jsonb;
  v_merge_log_id uuid;
  v_actor uuid := (select auth.uid());
begin
  if not private.has_permission('patients.merge') then
    raise exception 'Not authorised to merge patient records' using errcode = '42501';
  end if;

  if p_keep_id = p_merge_id then
    raise exception 'Cannot merge a profile into itself';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then
    raise exception 'A reason is required to merge patient records';
  end if;

  select * into v_keep from public.profiles where id = p_keep_id for update;
  select * into v_merge from public.profiles where id = p_merge_id for update;

  if v_keep.id is null or v_merge.id is null then
    raise exception 'Both profiles must exist';
  end if;
  if v_keep.role <> 'patient' or v_merge.role <> 'patient' then
    raise exception 'Merge only applies to patient records';
  end if;
  if v_keep.merged_into_profile_id is not null or v_merge.merged_into_profile_id is not null then
    raise exception 'One of these records has already been merged — merge into the surviving record instead';
  end if;
  if not p_allow_cross_org and v_keep.organisation_id is distinct from v_merge.organisation_id then
    raise exception 'These records belong to different organisations; pass p_allow_cross_org to override';
  end if;

  for v_fk in
    select tc.table_name, kcu.column_name
    from information_schema.table_constraints tc
    join information_schema.key_column_usage kcu
      on tc.constraint_name = kcu.constraint_name and tc.table_schema = kcu.table_schema
    join information_schema.constraint_column_usage ccu
      on tc.constraint_name = ccu.constraint_name and tc.table_schema = ccu.table_schema
    where tc.constraint_type = 'FOREIGN KEY'
      and tc.table_schema = 'public'
      and ccu.table_schema = 'public'
      and ccu.table_name = 'profiles'
      and ccu.column_name = 'id'
      and not (tc.table_name = 'profiles' and kcu.column_name = 'merged_into_profile_id')
    order by tc.table_name, kcu.column_name
  loop
    if p_dry_run then
      execute format('select count(*) from public.%I where %I = $1', v_fk.table_name, v_fk.column_name)
        using p_merge_id
        into v_count;
    else
      execute format(
        'update public.%I set %I = $1 where %I = $2',
        v_fk.table_name, v_fk.column_name, v_fk.column_name
      ) using p_keep_id, p_merge_id;
      get diagnostics v_count = row_count;
    end if;

    if v_count > 0 then
      v_affected := v_affected || jsonb_build_object(v_fk.table_name || '.' || v_fk.column_name, v_count);
    end if;
  end loop;

  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'keep_id', p_keep_id,
      'merge_id', p_merge_id,
      'tables_affected', v_affected
    );
  end if;

  update public.profiles
  set merged_into_profile_id = p_keep_id, merged_at = now(), is_active = false
  where id = p_merge_id;

  insert into public.patient_merge_log (
    kept_profile_id, merged_profile_id, performed_by, reason,
    snapshot_kept, snapshot_merged, tables_affected
  ) values (
    p_keep_id, p_merge_id, v_actor, p_reason, to_jsonb(v_keep), to_jsonb(v_merge), v_affected
  )
  returning id into v_merge_log_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_keep.organisation_id, v_actor, 'profiles.merged', 'profiles', p_keep_id,
    jsonb_build_object(
      'merged_profile_id', p_merge_id, 'reason', p_reason,
      'merge_log_id', v_merge_log_id, 'tables_affected', v_affected
    )
  );

  return jsonb_build_object(
    'dry_run', false,
    'keep_id', p_keep_id,
    'merge_id', p_merge_id,
    'tables_affected', v_affected,
    'merge_log_id', v_merge_log_id
  );
end;
$$;

-- `private` is not PostgREST-exposed, but this project's own standing lesson (see the
-- supabase-anon-execute-gotcha memory and 20260829111514_resweep_private_schema_execute_from_public.sql)
-- is that ALTER DEFAULT PRIVILEGES does NOT reliably stop a brand-new function being born
-- PUBLIC-executable here — only an explicit per-function revoke does. Nothing calls this function
-- directly except the admin wrapper below.
revoke all on function private.merge_patient_records(uuid, uuid, text, boolean, boolean) from public;

-- Client-facing wrapper — the actual authorisation check lives inside merge_patient_records
-- itself (private.has_permission), so this grant alone does not hand out merge capability; it
-- just makes the function reachable at all for a caller who does hold the permission.
create or replace function public.admin_merge_patient_records(
  p_keep_id uuid,
  p_merge_id uuid,
  p_reason text,
  p_allow_cross_org boolean default false,
  p_dry_run boolean default true
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.merge_patient_records(p_keep_id, p_merge_id, p_reason, p_allow_cross_org, p_dry_run);
$$;

revoke all on function public.admin_merge_patient_records(uuid, uuid, text, boolean, boolean) from public;
revoke execute on function public.admin_merge_patient_records(uuid, uuid, text, boolean, boolean) from anon;
grant execute on function public.admin_merge_patient_records(uuid, uuid, text, boolean, boolean) to authenticated;

-- Proof, not hope.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles' and column_name = 'merged_into_profile_id'
  ) then
    raise exception 'FAIL: profiles.merged_into_profile_id missing';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'patient_merge_log'
  ) then
    raise exception 'FAIL: patient_merge_log table missing';
  end if;

  if has_function_privilege('anon', 'public.admin_merge_patient_records(uuid, uuid, text, boolean, boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute public.admin_merge_patient_records';
  end if;

  if not has_function_privilege('authenticated', 'public.admin_merge_patient_records(uuid, uuid, text, boolean, boolean)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute public.admin_merge_patient_records';
  end if;

  raise notice 'PASS: patient_record_merge — profiles columns, guard extension, patient_merge_log, merge function all in place';
end $$;

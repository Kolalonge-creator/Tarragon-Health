-- Tarragon Health — feature_flags: cohort targeting + evaluation function
--
-- Completes public.feature_flags (20260829093236_platform_feature_flags.sql), which shipped
-- the table, the clinical-safety guard, and RLS, but no way to target a rollout beyond a flat
-- percentage and no function for app code to actually ask "is this on for the current caller" —
-- its own permissions.description already promised "target pilot, role or geographic cohorts"
-- that didn't exist yet. Part of the 2026-08-29 admin/configuration-engine gap-closure work
-- (spec item 97.14: internal testing, a pilot population, a specific geography, or selected
-- providers, all without a redeploy).
--
-- Deliberately distinct from private.patient_has_feature_access() (billing-tier entitlement —
-- "is this in the patient's paid plan"): this is a deployment/rollout gate. A feature can need
-- both; callers check each where it applies. Not merged into one function — different question,
-- different owners (billing vs. release management).

alter table public.feature_flags
  add column if not exists target_states          text[]  not null default '{}',
  add column if not exists target_provider_ids     uuid[]  not null default '{}',
  add column if not exists target_patient_ids      uuid[]  not null default '{}',
  add column if not exists include_internal_staff  boolean not null default false,
  add column if not exists updated_by              uuid references public.profiles (id) on delete set null;

comment on column public.feature_flags.target_states is
  'Nigerian state names, matching service_regions.state. Only consulted when status = rollout.';
comment on column public.feature_flags.include_internal_staff is
  'When status = rollout: on for any authenticated non-patient profile, regardless of rollout_percent/target_*. The "internal testing" cohort from spec 97.14.';

-- ---------------------------------------------------------------------------
-- Tighten SELECT: the original policy (authenticated using (true)) was fine when this table
-- held no per-person data. target_patient_ids now does — letting every authenticated patient
-- read it would mean any patient can enumerate other patients' UUIDs, the same class of leak
-- this codebase has closed elsewhere (see the anon-EXECUTE / real_patient_ids() precedent).
-- Ordinary flag evaluation never needs table access — it goes through private.
-- is_feature_flag_enabled() below (SECURITY DEFINER) — so narrowing here breaks nothing.
-- ---------------------------------------------------------------------------

drop policy if exists feature_flags_select on public.feature_flags;
create policy feature_flags_select on public.feature_flags
  for select to authenticated
  using (private.is_admin() or private.has_permission('feature_flags.manage'));

-- ---------------------------------------------------------------------------
-- Actor stamping — created_by already existed with no auto-fill; updated_by is new. Both
-- stamped server-side so the admin UI never has to remember to pass them.
-- ---------------------------------------------------------------------------

create or replace function private.feature_flags_stamp_actor()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, (select auth.uid()));
    new.updated_by := coalesce(new.updated_by, (select auth.uid()));
  else
    new.updated_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists feature_flags_stamp_actor on public.feature_flags;
create trigger feature_flags_stamp_actor
  before insert or update on public.feature_flags
  for each row execute function private.feature_flags_stamp_actor();

-- Reuse the existing generic row-change audit trigger (20260812030853_row_change_audit_
-- triggers.sql) — every flag flip becomes an audit_log row for free, closing spec 97.16's
-- "every major config change should be audited" and giving the rollback flow (97.19) a real
-- change history to investigate from.
drop trigger if exists audit_row_change_trg on public.feature_flags;
create trigger audit_row_change_trg
  after insert or update or delete on public.feature_flags
  for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- Evaluation predicate — the one function every feature-gated code path calls. security
-- definer so it can read feature_flags (now admin-only RLS) and profiles.state on behalf of
-- any authenticated caller checking their own gate. Explicit revoke from PUBLIC before the
-- authenticated-only grant: anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct
-- grant to anon, so `revoke ... from anon` alone would NOT close it — this exact gotcha has
-- recurred multiple times in this codebase (see feedback_supabase_anon_execute_gotcha memory).
-- ---------------------------------------------------------------------------

create or replace function private.is_feature_flag_enabled(
  p_key text,
  p_patient_id uuid default null,
  p_provider_id uuid default null
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_flag  public.feature_flags%rowtype;
  v_bucket int;
begin
  select * into v_flag from public.feature_flags where key = p_key;

  if not found or v_flag.status in ('off', 'archived') then
    return false;
  end if;

  if v_flag.status = 'on' then
    return true;
  end if;

  -- status = 'rollout' from here: any cohort match wins, else fall through to percentage.
  if v_flag.include_internal_staff and exists (
    select 1 from public.profiles pr
    where pr.id = (select auth.uid()) and pr.role <> 'patient'
  ) then
    return true;
  end if;

  if p_patient_id is not null and p_patient_id = any (v_flag.target_patient_ids) then
    return true;
  end if;

  if p_provider_id is not null and p_provider_id = any (v_flag.target_provider_ids) then
    return true;
  end if;

  if p_patient_id is not null
     and array_length(v_flag.target_states, 1) is not null
     and exists (
       select 1 from public.profiles pr
       where pr.id = p_patient_id and pr.state = any (v_flag.target_states)
     )
  then
    return true;
  end if;

  if p_patient_id is not null and v_flag.rollout_percent > 0 then
    -- Stable per-(flag, patient) bucket so a patient never flaps in/out between checks.
    v_bucket := abs(hashtext(p_key || p_patient_id::text)) % 100;
    return v_bucket < v_flag.rollout_percent;
  end if;

  return false;
end;
$$;

comment on function private.is_feature_flag_enabled(text, uuid, uuid) is
  'Deployment/rollout gate — distinct from private.patient_has_feature_access() (billing-tier '
  'entitlement). See 20260829205220_feature_flags_cohort_targeting_and_eval.sql.';

revoke all on function private.is_feature_flag_enabled(text, uuid, uuid) from public, anon;
grant execute on function private.is_feature_flag_enabled(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_trigger tg
    join pg_class c on c.oid = tg.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'feature_flags'
      and tg.tgname = 'audit_row_change_trg' and not tg.tgisinternal
  ) then
    raise exception 'audit_row_change_trg missing on public.feature_flags';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'feature_flags' and cmd = 'SELECT'
      and 'authenticated' = any (roles) and qual = 'true'
  ) then
    raise exception 'feature_flags select policy is unexpectedly unrestricted (using true)';
  end if;

  if has_function_privilege('anon', 'private.is_feature_flag_enabled(text, uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not be able to execute private.is_feature_flag_enabled';
  end if;

  if not has_function_privilege('authenticated', 'private.is_feature_flag_enabled(text, uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated should be able to execute private.is_feature_flag_enabled';
  end if;
end $$;

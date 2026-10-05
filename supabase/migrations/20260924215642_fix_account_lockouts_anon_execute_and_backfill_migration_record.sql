-- Backfill migration record: public.account_lockouts, its two SECURITY DEFINER
-- lookup functions (is_account_locked / is_account_locked_by_phone), and their
-- supporting private.is_profile_locked existed live with ZERO migration record
-- anywhere -- not in git, not even in supabase_migrations.schema_migrations --
-- the same "live schema object with no migration record at all" failure mode
-- documented in CLAUDE.md (the private.guard_profiles_self_update() incident).
-- Found 2026-09-24 while investigating a live release-integrity CI failure:
-- both functions are anon-executable and were not on the check's allowlist.
--
-- Neither function has any call site anywhere in apps/web or apps/mobile, and
-- nothing populates account_lockouts (no trigger increments failed_attempts on
-- a failed login) -- this is orphaned scaffolding for a lockout feature that
-- was never wired up, not a proven-intentional public pre-login check. Per the
-- allowlist script's own rule (scripts/release-integrity/check-anon-security-
-- definer-execute.mjs), an anon grant needs its own migration-level assertion
-- proving deliberate intent -- there is none here, so the safe default is to
-- revoke anon access rather than invent one. If a real pre-login lockout check
-- is wanted later, re-add it with an actual call site and an allowlist entry.

create table if not exists public.account_lockouts (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  organisation_id uuid references public.organisations(id) on delete set null,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists account_lockouts_organisation_id_idx
  on public.account_lockouts using btree (organisation_id);

alter table public.account_lockouts enable row level security;

drop policy if exists account_lockouts_select on public.account_lockouts;
create policy account_lockouts_select on public.account_lockouts
  for select
  using (profile_id = (select auth.uid()));

grant select, insert, update, delete on public.account_lockouts to authenticated;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists account_lockouts_set_updated_at on public.account_lockouts;
create trigger account_lockouts_set_updated_at
  before update on public.account_lockouts
  for each row execute function private.set_updated_at();

create or replace function private.is_profile_locked(p_profile_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $$
  select locked_until is not null and locked_until > now()
  from public.account_lockouts
  where profile_id = p_profile_id;
$$;

create or replace function public.is_account_locked(p_email text)
returns boolean
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id from auth.users where lower(email) = lower(trim(p_email));
  if v_profile_id is null then
    return false;
  end if;
  return coalesce(private.is_profile_locked(v_profile_id), false);
end;
$$;

create or replace function public.is_account_locked_by_phone(p_phone text)
returns boolean
language plpgsql
stable security definer
set search_path to ''
as $$
declare
  v_profile_id uuid;
begin
  select id into v_profile_id from auth.users
  where phone = case when trim(p_phone) ~ '^\+' then substring(trim(p_phone) from 2) else trim(p_phone) end;
  if v_profile_id is null then
    return false;
  end if;
  return coalesce(private.is_profile_locked(v_profile_id), false);
end;
$$;

-- The actual CI-blocking fix: both functions currently inherit EXECUTE via
-- the PUBLIC pseudo-role (the anon-execute gotcha -- see the memory of the
-- same name). Neither has any caller anywhere in the app, so revoke from
-- public/anon entirely rather than allowlist an unproven "public pre-login
-- check" intent; authenticated keeps access in case anything server-side
-- calls these directly (mirrors the table's own authenticated-only grant).
revoke all on function public.is_account_locked(text) from public, anon;
revoke all on function public.is_account_locked_by_phone(text) from public, anon;
grant execute on function public.is_account_locked(text) to authenticated;
grant execute on function public.is_account_locked_by_phone(text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.is_account_locked(text)', 'execute') then
    raise exception 'anon must not retain EXECUTE on public.is_account_locked';
  end if;
  if has_function_privilege('anon', 'public.is_account_locked_by_phone(text)', 'execute') then
    raise exception 'anon must not retain EXECUTE on public.is_account_locked_by_phone';
  end if;
  if not has_function_privilege('authenticated', 'public.is_account_locked(text)', 'execute') then
    raise exception 'authenticated must retain EXECUTE on public.is_account_locked';
  end if;
  if not has_function_privilege('authenticated', 'public.is_account_locked_by_phone(text)', 'execute') then
    raise exception 'authenticated must retain EXECUTE on public.is_account_locked_by_phone';
  end if;
end $$;

-- Fixes a real bug in part 1/6 (20260829091959), caught by a smoke test
-- before anything was built on top of it.
--
-- `private.guard_employer_account_self_update()` decided "is this the employer
-- editing its own row?" as `not is_admin() and not is_org_staff(...)`. Both of
-- those read `public.profiles where id = auth.uid()`, so both are FALSE when
-- there is no session at all — which is every service-role write, every
-- Edge Function, every migration and every backfill. The guard therefore bit
-- the platform's own writes and rejected them with "verification is set by
-- Tarragon, not by the employer", the exact opposite of its purpose.
--
-- `private.guard_profiles_self_update()` — the pattern part 1 said it was
-- copying — gets this right by requiring `auth.uid() is not null` as the FIRST
-- term of its self-edit test. This restores that term. A sessionless caller is
-- the platform acting on its own behalf and is not what this guard is for;
-- the employer's own reach is still bounded by RLS, which no service-role
-- client is subject to in the first place.

create or replace function private.guard_employer_account_self_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Trigger-driven writes (the go-live RPC, a later part's invoice run) are
  -- not the employer editing its own row.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  -- No session => service role / migration / background job. Not an employer.
  if (select auth.uid()) is null then
    return new;
  end if;

  -- A platform admin, or Tarragon care-team/operations staff of the org, may
  -- set anything here.
  if private.is_admin() or private.is_org_staff(old.organisation_id) then
    return new;
  end if;

  if new.organisation_id is distinct from old.organisation_id then
    raise exception 'employer_accounts.organisation_id cannot be changed by the employer';
  end if;
  if new.verification_status is distinct from old.verification_status
     or new.verified_by is distinct from old.verified_by
     or new.verified_at is distinct from old.verified_at
     or new.verification_notes is distinct from old.verification_notes then
    raise exception 'employer_accounts verification is set by Tarragon, not by the employer';
  end if;
  if new.went_live_at is distinct from old.went_live_at then
    raise exception 'employer_accounts.went_live_at is set by Tarragon, not by the employer';
  end if;
  -- The employer MAY advance its own configuration steps up to (but not into)
  -- 'live' — that is it working through its own setup checklist.
  if new.onboarding_step is distinct from old.onboarding_step and new.onboarding_step = 'live' then
    raise exception 'going live is a Tarragon action, not an employer one';
  end if;

  return new;
end;
$$;

do $$
begin
  if pg_get_functiondef('private.guard_employer_account_self_update()'::regprocedure)
       not like '%auth.uid()) is null%' then
    raise exception 'FAIL: the sessionless bail-out did not take';
  end if;
  raise notice 'PASS  guard_employer_account_self_update no longer blocks sessionless writes';
end $$;

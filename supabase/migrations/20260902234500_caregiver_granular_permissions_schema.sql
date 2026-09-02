-- Caregiver Proxy Access, part 1: granular permissions + temporary access, schema.
--
-- profile_access has always been a binary: 'view' (follow the record) or
-- 'manage' (act on it, via private.can_act_for / the sponsor RPCs / the
-- acting-for mechanism). That binary has been enough for "can my son book a
-- lab check and settle a bill," but it cannot express "can my son book
-- appointments and see my medications, but never touch my money" — every
-- 'manage' grant today is all-or-nothing across booking, pharmacy, payments
-- and messaging at once. It is also permanent: there is no way to hand
-- someone access while travelling and have it end itself.
--
-- This migration adds both, additively and backward-compatibly:
--
--   permissions   A caregiver_permission[] on the grant. NULL (the default,
--                 and what every existing row has) means "no narrowing" —
--                 exactly today's behaviour, a 'manage' grant can do
--                 everything can_act_for already allows and a 'view' grant
--                 can read everything can_read_clinical already allows. A
--                 non-null array narrows a 'manage' grant to only the named
--                 capabilities. Enforcement is added in the next migration,
--                 one call site at a time — this migration is schema only.
--
--   expires_at    Nullable, NULL means permanent (again, every existing row).
--                 When set, the grant is temporary: private.expire_stale_
--                 profile_access (next migration) sweeps it away once past,
--                 and because every RLS policy and RPC on this platform
--                 already asks "does a profile_access row exist" rather than
--                 caching an answer, a swept-away row disappears from all of
--                 them at once with no further changes required anywhere.
--
-- Both columns are added to care_access_requests too, so a proposal can name
-- the scope and duration being offered before either party consents to it —
-- the request is what respond_to_care_access_request (next migration) will
-- carry across into the real grant on acceptance.
--
-- care_access_event_kind gains 'expired' as a lifecycle kind distinct from
-- 'revoked', so the proxy audit (care_access_events) can tell "the patient
-- took this back" from "this ran out on its own" — both are an authorisation
-- basis a patient reviewing their own access log should be able to read
-- apart. ALTER TYPE ... ADD VALUE cannot be used in the same transaction
-- that adds it, so the functions that write 'expired' are a separate
-- migration file.

create type public.caregiver_permission as enum (
  'view_appointments',
  'book_appointments',
  'view_medication',
  'manage_pharmacy',
  'view_results',
  'view_care_plan',
  'communicate_with_care_team',
  'manage_payments',
  'receive_alerts'
);

comment on type public.caregiver_permission is
  'One capability a caregiver (profile_access grantee) may be given. A NULL profile_access.permissions array means unrestricted (every capability a manage/view grant already implies); a non-null array narrows the grant to only these. Enforced call site by call site — see 20260829010500_caregiver_permission_enforcement.sql for the current coverage.';

alter table public.profile_access
  add column permissions public.caregiver_permission[],
  add column expires_at timestamptz;

comment on column public.profile_access.permissions is
  'NULL = unrestricted (legacy behaviour, every grant before this column existed). A non-null array narrows a manage grant to only these capabilities. Meaningless on its own for a view grant, which is already read-only.';

comment on column public.profile_access.expires_at is
  'NULL = permanent (legacy behaviour). When set, private.expire_stale_profile_access deletes the row once past, which the profile_access_log_lifecycle trigger records as an ''expired'' care_access_events row.';

alter table public.profile_access
  add constraint profile_access_expires_after_created
  check (expires_at is null or expires_at > created_at);

alter table public.care_access_requests
  add column permissions public.caregiver_permission[],
  add column expires_at timestamptz;

comment on column public.care_access_requests.permissions is
  'The permissions being proposed. Carried into the resulting profile_access row by respond_to_care_access_request on acceptance; NULL proposes an unrestricted grant, same meaning as on profile_access.';

comment on column public.care_access_requests.expires_at is
  'The expiry being proposed, carried into profile_access.expires_at on acceptance. NULL proposes a permanent grant.';

alter table public.care_access_requests
  add constraint care_access_requests_expires_after_created
  check (expires_at is null or expires_at > created_at);

-- New lifecycle kind. Added on its own so a later migration in the same
-- deployment can use it in a query without hitting "unsafe use of new value
-- of enum type" — Postgres refuses to use a value added by ALTER TYPE ...
-- ADD VALUE within the same transaction that added it.
alter type public.care_access_event_kind add value 'expired';

do $$
begin
  if not exists (
    select 1 from pg_type where typname = 'caregiver_permission' and typnamespace = 'public'::regnamespace
  ) then
    raise exception 'caregiver_permission enum was not created';
  end if;

  if (select count(*) from pg_enum e join pg_type t on t.oid = e.enumtypid
       where t.typname = 'caregiver_permission') <> 9 then
    raise exception 'caregiver_permission must carry exactly the 9 named capabilities';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profile_access' and column_name = 'permissions'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profile_access' and column_name = 'expires_at'
  ) then
    raise exception 'profile_access is missing permissions/expires_at';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'care_access_requests' and column_name = 'permissions'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'care_access_requests' and column_name = 'expires_at'
  ) then
    raise exception 'care_access_requests is missing permissions/expires_at';
  end if;

  -- Backward compatibility is the whole point of NULL-as-default: assert it
  -- rather than trust the column definition, since a future edit could add a
  -- default without anyone noticing it broke every existing grant.
  if exists (
    select 1 from public.profile_access where permissions is not null or expires_at is not null
  ) then
    raise exception 'existing profile_access rows must stay unrestricted and permanent by default';
  end if;

  if not exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'care_access_event_kind' and e.enumlabel = 'expired') then
    raise exception 'care_access_event_kind did not gain the expired kind';
  end if;
end $$;

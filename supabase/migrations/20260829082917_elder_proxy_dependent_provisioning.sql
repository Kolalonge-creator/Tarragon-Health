-- Tarragon Health — Family Care Circle gap closure, part 2 of 5
-- (docs/FAMILY_CARE_CIRCLE_SPEC.md §3.2: "no account path for an elder with
-- no smartphone/account of their own — the spec's own literal example").
--
-- addChildDependentAction (20260730025553-era) provisions a login-less
-- profile for a child. The eldercare care_access_requests flow
-- (createEldercareAccessRequestAction) covers an adult who already holds a
-- Tarragon account and can accept a request themselves. Neither covers "my
-- father does not use smartphones" — a consenting adult who will never open
-- the app to accept anything.
--
-- This is deliberately the SAME mechanism as the child path (a login-less
-- profiles row + an unconditional 'manage' grant), not a new one: it reuses
-- provision_dependent_profile_basics and every RLS policy that already
-- special-cases is_dependent_account (private.can_read_clinical,
-- vaccination_schedules_select, booking_requests, etc. — see 20260731185243)
-- needs no change to extend to this new dependent_kind. What's new is a
-- second entry point that (a) is restricted to adults, since a genuine minor
-- already has the child path, and its consent story is unconditional
-- parental authority rather than an adult's own attested permission, and
-- (b) refuses if the phone already resolves to a real account, so a
-- self-capable adult who has simply not signed up yet is directed to the
-- ordinary eldercare request flow instead, where THEY accept, rather than
-- silently taking over their identity via the proxy path.
--
-- provision_dependent_profile_basics gains an optional p_dependent_kind
-- parameter, defaulted to 'minor_child' so the existing call site in
-- add-child-actions.ts needs no change and keeps its current behaviour
-- exactly. Its grants are intentionally left untouched by this migration —
-- see the standing follow-up task auditing every function in
-- 20260812041044 for a public-EXECUTE gap; broadening that audit here would
-- risk changing a working call path without the live verification that
-- follow-up requires.

create or replace function public.provision_dependent_profile_basics(
  p_child_id uuid,
  p_date_of_birth date,
  p_sex public.sex,
  p_actor_id uuid,
  p_dependent_kind public.dependent_kind default 'minor_child'
) returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  perform set_config('app.audit_actor_id', p_actor_id::text, true);
  update public.profiles
    set date_of_birth = p_date_of_birth,
        sex = p_sex,
        is_dependent_account = true,
        dependent_kind = p_dependent_kind
    where id = p_child_id;
end;
$$;

comment on function public.provision_dependent_profile_basics(uuid, date, public.sex, uuid, public.dependent_kind) is
  'Service-role write wrapper: sets a dependent''s basics, attributed to the provisioning family '
  'member (p_actor_id). p_dependent_kind defaults to minor_child (the original, unchanged call '
  'site: add-child-actions.ts). elder_proxy is set from addElderProxyDependentAction. See '
  '20260829082917_elder_proxy_dependent_provisioning.sql.';

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'provision_dependent_profile_basics'
      and pg_get_function_identity_arguments(p.oid) ilike '%p_dependent_kind%'
  ) then
    raise exception 'provision_dependent_profile_basics was not extended with p_dependent_kind';
  end if;
  raise notice 'PASS: provision_dependent_profile_basics accepts p_dependent_kind, defaulted to minor_child';
end $$;

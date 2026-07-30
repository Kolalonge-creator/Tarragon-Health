-- Tarragon Health — a party to a pending care_access_requests row needs to
-- read the OTHER named party's full_name to render "X wants to view your
-- care" / "X wants you to manage their care" — found live-testing
-- 20260730025553: the acceptor saw "Someone" instead of the initiator's real
-- name, because nothing in profiles_select admitted this read.
--
-- Deliberately a SEPARATE permissive policy rather than editing
-- profiles_select itself (multiple PERMISSIVE policies for the same command
-- OR together in Postgres) — profiles_select carries live assertion checks
-- (20260729194127) guarding its exact existing clauses, and this is purely
-- additive.
--
-- Bounded exposure: only while status = 'pending', and only between the two
-- people actually named on that specific request — the same shape as the
-- profile_access consent clause profiles_select already carries, just a
-- little earlier in the relationship (a request the caller was themselves
-- named on, not a stranger enumeration path — find_profile_by_phone already
-- requires an exact same-org phone match before either side can be named).
create policy profiles_select_pending_care_access on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.care_access_requests car
      where car.status = 'pending'
        and (
          (car.profile_id = profiles.id and car.counterparty_user_id = (select auth.uid()))
          or (car.counterparty_user_id = profiles.id and car.profile_id = (select auth.uid()))
        )
    )
  );

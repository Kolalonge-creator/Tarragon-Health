-- Caregiver Proxy Access, part 9: close the anon-execute gap on the two
-- brand-new private cron functions this feature added.
--
-- Postgres grants EXECUTE on a newly created function to the PUBLIC
-- pseudo-role by default, and anon inherits through PUBLIC — the exact,
-- repeatedly-rediscovered gotcha this codebase has hit before (see
-- CLAUDE.md: "anon's EXECUTE on a function is revoked via `revoke ... from
-- public`, not `from anon`"). Every other brand-new function in this
-- feature got an explicit revoke; these two — both private-schema functions
-- meant to be reached only by pg_cron, following the no-explicit-grant shape
-- of the pre-existing private.queue_appointment_reminders() — did not, and
-- CI's own migration-replay caught it: 20260829020000's self-test asserts
-- anon cannot execute notify_caregivers_of_overdue_reviews and, on a fresh
-- replay, that assertion failed for real. expire_stale_profile_access has
-- the identical gap with no assertion to catch it, found by audit rather
-- than by a second failure.
--
-- Not a live exploit either way — both functions only ever act on rows
-- already past their own expiry/already-overdue condition, so calling them
-- early does nothing an anon session couldn't already infer was coming —
-- but "not exploitable" is not the bar this codebase holds itself to here,
-- and leaving it means the next person who copies this shape inherits the
-- same hole.

revoke all on function private.expire_stale_profile_access() from public;
revoke all on function private.notify_caregivers_of_overdue_reviews() from public;

do $$
begin
  if has_function_privilege('anon', 'private.expire_stale_profile_access()', 'EXECUTE') then
    raise exception 'anon must not reach expire_stale_profile_access';
  end if;
  if has_function_privilege('anon', 'private.notify_caregivers_of_overdue_reviews()', 'EXECUTE') then
    raise exception 'anon must not reach notify_caregivers_of_overdue_reviews';
  end if;
  if has_function_privilege('authenticated', 'private.expire_stale_profile_access()', 'EXECUTE') then
    raise exception 'authenticated must not reach expire_stale_profile_access either — cron-only';
  end if;
  if has_function_privilege('authenticated', 'private.notify_caregivers_of_overdue_reviews()', 'EXECUTE') then
    raise exception 'authenticated must not reach notify_caregivers_of_overdue_reviews either — cron-only';
  end if;
end $$;

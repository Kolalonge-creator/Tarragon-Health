-- Tarragon Control — M1: security advisor fixes
-- Applied after get_advisors(security) flagged three real issues in
-- 0001-0003. Fixing in a new migration, not editing the shipped ones.

-- 1. escalations_with_breach_status ran as SECURITY DEFINER by default
-- (Postgres views run as their owner unless security_invoker is set),
-- meaning it silently bypassed every RLS policy on escalations for
-- whoever queried it. Must run as the querying user instead.
drop view escalations_with_breach_status;
create view escalations_with_breach_status
with (security_invoker = true)
as
  select
    e.*,
    (e.resolved_at is null and now() > e.due_by) as breached
  from escalations e;

comment on view escalations_with_breach_status is
  'Read-time replacement for the spec''s stored `breached` generated column (now() is not immutable, error 42P17). security_invoker=true so it respects the querying role''s RLS on escalations rather than running as the view owner.';

-- 2. enforce_urgent_closure_requires_live_contact had a mutable search_path
-- (missed on the one function defined outside the private schema).
alter function enforce_urgent_closure_requires_live_contact()
  set search_path = public;

-- 3. audit_log_insert_authenticated (WITH CHECK true) let any authenticated
-- session insert directly into audit_log, bypassing the trigger entirely
-- and forging arbitrary actor/before/after values. The only legitimate
-- writer is private.write_audit_log(), a SECURITY DEFINER function that
-- inserts as its owner — audit_log is deliberately NOT under FORCE ROW
-- LEVEL SECURITY, so the owner-executed trigger insert is unaffected by
-- removing this policy. No replacement policy is added: zero direct
-- INSERT access for any role is correct for an append-only audit trail.
drop policy audit_log_insert_authenticated on audit_log;

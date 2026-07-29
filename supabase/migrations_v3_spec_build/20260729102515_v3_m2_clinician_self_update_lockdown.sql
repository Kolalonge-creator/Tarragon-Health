-- M2: close a real gap the M1 RLS review missed. clinicians_update let a clinician update their
-- OWN row (profile_id = auth.uid()), which included active/suspended_reason/mdcn_*/indemnity_*.
-- Combined with today's activation-guard work, that would let a clinician the nightly sweep just
-- suspended immediately flip themselves back to active = true. Nothing in build spec v3 §5.2
-- defines a legitimate clinician self-service field on this table -- credentials and activation
-- are entirely an ops/superadmin-verified action -- so the fix is to remove the self clause
-- outright rather than add a second, redundant column-restriction trigger.
drop policy clinicians_update on clinicians;
create policy clinicians_update on clinicians for update using (
  private.actor_role() in ('ops_admin','superadmin')
);

-- Tarragon Health
-- 12 · audit_log.organisation_id: 'set null' -> 'restrict' on delete
--
-- Bug found 2026-07-11 while cleaning up test data for the
-- AbnormalResultHandler verification: audit_log has an append-only guard
-- (audit_log_no_update / audit_log_no_delete, private.reject_mutation() —
-- see 20260705000006_platform_infra.sql) that rejects every UPDATE and
-- DELETE, including the system-generated UPDATE Postgres issues to enforce
-- 'on delete set null'. The practical effect: any organisation that has
-- ever been referenced by an audit_log row could never be deleted — the
-- DELETE failed with "audit_log is append-only: UPDATE is not permitted"
-- instead of a normal FK error, confirmed live against the Supabase
-- project.
--
-- 'on delete restrict' is also the convention used everywhere else an
-- organisation_id column is not-null (screening_results, care_plans,
-- clinician_alerts, etc. — every business/clinical table restricts).
-- audit_log.organisation_id stays nullable (some system events have no org
-- context), but once set it should behave the same way: an organisation
-- with any history can't be deleted out from under it. 'notifications' and
-- 'referrals' also use 'on delete set null' on organisation_id but have no
-- append-only guard, so they're unaffected by this bug and are left as-is.

alter table public.audit_log
  drop constraint audit_log_organisation_id_fkey;

alter table public.audit_log
  add constraint audit_log_organisation_id_fkey
  foreign key (organisation_id) references public.organisations (id) on delete restrict;

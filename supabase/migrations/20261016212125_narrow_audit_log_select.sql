-- Narrow public.audit_log SELECT to the caller's own rows plus admins.
--
-- Before: audit_log_select (20260705211409_platform_infra.sql) let EVERY org-staff account read EVERY audit row of the organisation
-- (private.is_org_staff), as well as the actor's own rows and admins. Any clinician or coordinator could therefore read the
-- subject_patient_id / event / reason of every other staff member's chart reads, refusals and break-glass use (docs/design/S02.md
-- section 4 item 4: "audit_log_select still lets any org staff read every audit row").
--
-- After: a row is readable directly only by (a) its own actor (actor_id = auth.uid()) and (b) an admin (private.is_admin(), all orgs, as
-- before). Nobody else, including org staff, tied clinicians, the CMO account and patients, reads the table directly.
--
-- Readers enumerated BEFORE writing this (repo grep of apps/web, apps/console, apps/mobile, packages, supabase/functions, plus the
-- function bodies in migrations):
--   * clinician patients list "recently viewed" filter: user session, actor_id = caller. Still works (own rows).
--   * service-navigation daily limit: service-role client (bypasses RLS), caller's own rows. Unchanged.
--   * every other application access is an INSERT (service role or own actor) or goes through a SECURITY DEFINER function owned by
--     postgres, which RLS does not apply to: admin_member_activity, finance_audit_log, finance_audit_actions_list, analytics_audit_log
--     and the other analytics RPCs, my_access_log, my_reproductive_access_log, log_institution_aggregate_read, the once-per-window
--     checks in open_care_thread_audited, the S20 audit-review sampling, permission_grants_history. All unchanged.
--   * Patients never had direct SELECT beyond their own actor rows. Rows ABOUT a patient (subject_patient_id) reach her only through
--     the narrow definer RPCs my_access_log and my_reproductive_access_log, which already exist; no new patient path is added here.
--   * No RLS policy and no view on another table reads audit_log, and no SECURITY INVOKER function reads it (asserted in the proof
--     against pg_policies, pg_views and pg_proc).
-- Row counts could not be taken from production when this was written (the live project timed out on every query that session, see the
-- PR); the change is structural and removes no row.
--
-- Append-only is untouched: the BEFORE UPDATE/DELETE triggers, the revoked UPDATE/DELETE/TRUNCATE grants and the insert policy are not
-- modified here. The proof re-asserts them.

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    actor_id = (select auth.uid())
    or private.is_admin()
  );

comment on policy audit_log_select on public.audit_log is
  'Own rows (actor_id = auth.uid()) and admins only. Org staff no longer read the whole organisation log; other readers go through SECURITY DEFINER functions (admin_member_activity, finance_audit_log, analytics_audit_log, my_access_log). A new direct reader must be added to the allow list in apps/web/src/lib/audit/audit-log-reader-scan.test.ts.';

do $$
declare
  v_qual text;
begin
  select qual into v_qual from pg_policies where schemaname = 'public' and tablename = 'audit_log' and policyname = 'audit_log_select';
  if v_qual is null then raise exception 'audit_log_select is missing'; end if;
  if v_qual like '%is_org_staff%' then raise exception 'audit_log_select still admits org staff'; end if;
  if v_qual not like '%actor_id%' or v_qual not like '%is_admin%' then raise exception 'audit_log_select lost the own-row or admin branch'; end if;
  if has_table_privilege('anon', 'public.audit_log', 'select') then raise exception 'anon can select audit_log'; end if;
  if has_table_privilege('authenticated', 'public.audit_log', 'update') or has_table_privilege('authenticated', 'public.audit_log', 'delete')
     or has_table_privilege('authenticated', 'public.audit_log', 'truncate') then
    raise exception 'authenticated regained a write privilege on audit_log';
  end if;
end $$;

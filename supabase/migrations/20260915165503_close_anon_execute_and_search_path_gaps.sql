-- Pre-launch security-advisor sweep (2026-09-15). Two independent, unrelated
-- gaps closed here, both flagged by scripts/release-integrity's own checks
-- (the anon-execute CI job, and the Supabase security advisor):
--
-- 1. private.run_service_purchase_expiry_nudges() (20260910194032) and
--    private.queue_preventive_care_plan_email_reminders() (20260910203222)
--    are both SECURITY DEFINER, cron-only (each has its own `cron.schedule`
--    right next to its `create function`, no other caller anywhere in the
--    codebase), and neither migration granted or revoked anything -- so both
--    inherited the implicit EXECUTE grant to the PUBLIC pseudo-role every
--    new Postgres function gets. This is the anon-inherits-EXECUTE-via-
--    PUBLIC bug (see the supabase-anon-execute-gotcha memory), recurring
--    here for at least a 5th time, and exactly the reason
--    check-anon-security-definer-execute.mjs currently fails on main-dev.
--    Neither function needs a direct grant to any role -- pg_cron runs as
--    the migration/superuser connection, which bypasses grants entirely --
--    so the fix here is a bare `revoke ... from public, anon`, same shape as
--    the private.sweep_chronic_programme_occurrences() precedent
--    (20260831165100_revoke_anon_execute_sweep_chronic_programme_occurrences.sql).
--    `private` is not PostgREST-exposed, so this was defense-in-depth
--    (nothing anon could actually reach over the REST API), not a live PHI
--    exposure -- caught by re-running the CI check locally, not by an
--    incident.
--
-- 2. private.imaging_reports_search_vector_update() and
--    private.touch_patient_goal_updated_at() (both plain trigger functions)
--    were created with no `set search_path` at all, flagged by Supabase's
--    `function_search_path_mutable` advisor -- a caller with a hostile
--    search_path could shadow an unqualified identifier the function
--    resolves at call time. Both functions only ever touch NEW.<column> and
--    built-in operators/functions (setweight, to_tsvector, coalesce, now())
--    that resolve through pg_catalog regardless of search_path, so pinning
--    it to '' is a pure hardening move with no behaviour change.
--
-- Deliberately NOT touched by this migration, after checking each first --
-- see the standing lesson on verifying advisor findings against actual app
-- intent before "fixing" them:
--   - public.specialist_directory / public.therapy_directory (flagged
--     ERROR: security_definer_view): both are the DELIBERATE, documented fix
--     for a real 2026-09-10 leak (specialist_providers' SELECT policy was
--     `using (true)`, handing every patient commission rates + partner
--     contact details -- see apps/web/src/lib/queries/specialist-referrals.ts
--     and therapy.ts's own comments). The table's RLS is now
--     admin/partner-manager only; these two views are the curated,
--     column-limited, active-only substitute patients actually query.
--     Confirmed live: `has_table_privilege('anon', ..., 'SELECT')` is false
--     on both, `authenticated` is true on both, matching intent exactly.
--     Setting security_invoker on either would not close a leak -- it would
--     make every patient-facing specialist/therapy directory query return
--     zero rows, reintroducing the outage that would come with "fixing"
--     this blind.
--   - The 7 anon-executable `public` functions on the advisor's own list
--     (emergency_card_by_token, health_passport_by_serial,
--     public_partner_locations, public_price_list,
--     public_response_commitments, public_service_coverage,
--     verify_payer_board_report) are already on
--     check-anon-security-definer-execute.mjs's ALLOWLIST, each with its own
--     migration-level assertion proving the anon grant is deliberate.
--   - public.pgaudit_ddl_command_end() / public.pgaudit_sql_drop() (also on
--     that advisor list) are pgaudit's own event-trigger functions --
--     `event_trigger`-returning, so Postgres refuses to invoke them outside
--     an actual event-trigger context no matter what EXECUTE says. This is
--     exactly why check-anon-security-definer-execute.mjs's own query
--     excludes `event_trigger`/`trigger` return types.
--   - extensions.pgaudit living in the public schema (advisor: extension_in_
--     public) and auth_leaked_password_protection being off are real, but
--     neither is a migration-shaped fix -- the former needs an
--     `ALTER EXTENSION ... SET SCHEMA` verified against pgaudit's own event
--     triggers first, the latter is a dashboard/Auth-config toggle, not SQL.
--     Left for a deliberate follow-up, not silently dropped.

do $$
begin
  if to_regprocedure('private.run_service_purchase_expiry_nudges()') is not null then
    revoke all on function private.run_service_purchase_expiry_nudges() from public, anon;
    if has_function_privilege('anon', 'private.run_service_purchase_expiry_nudges()', 'EXECUTE') then
      raise exception 'FAIL: anon must not be able to execute private.run_service_purchase_expiry_nudges()';
    end if;
    raise notice 'PASS: anon EXECUTE revoked on private.run_service_purchase_expiry_nudges()';
  end if;

  if to_regprocedure('private.queue_preventive_care_plan_email_reminders()') is not null then
    revoke all on function private.queue_preventive_care_plan_email_reminders() from public, anon;
    if has_function_privilege('anon', 'private.queue_preventive_care_plan_email_reminders()', 'EXECUTE') then
      raise exception 'FAIL: anon must not be able to execute private.queue_preventive_care_plan_email_reminders()';
    end if;
    raise notice 'PASS: anon EXECUTE revoked on private.queue_preventive_care_plan_email_reminders()';
  end if;

  if to_regprocedure('private.imaging_reports_search_vector_update()') is not null then
    alter function private.imaging_reports_search_vector_update() set search_path = '';
    if (
      select current_setting
      from pg_proc p, unnest(p.proconfig) as current_setting
      where p.oid = 'private.imaging_reports_search_vector_update()'::regprocedure
        and current_setting like 'search_path=%'
    ) is distinct from 'search_path=""' then
      raise exception 'FAIL: search_path not pinned on private.imaging_reports_search_vector_update()';
    end if;
    raise notice 'PASS: search_path pinned on private.imaging_reports_search_vector_update()';
  end if;

  if to_regprocedure('private.touch_patient_goal_updated_at()') is not null then
    alter function private.touch_patient_goal_updated_at() set search_path = '';
    if (
      select current_setting
      from pg_proc p, unnest(p.proconfig) as current_setting
      where p.oid = 'private.touch_patient_goal_updated_at()'::regprocedure
        and current_setting like 'search_path=%'
    ) is distinct from 'search_path=""' then
      raise exception 'FAIL: search_path not pinned on private.touch_patient_goal_updated_at()';
    end if;
    raise notice 'PASS: search_path pinned on private.touch_patient_goal_updated_at()';
  end if;
end $$;

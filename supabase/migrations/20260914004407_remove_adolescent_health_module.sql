-- Removes the Adolescent Health module (spec §49's psychosocial check-in +
-- transition-to-adult-care tracking) -- founder decision 2026-09-14: the
-- self-administered HEEADSSS-style check-in with self-harm/immediate-danger/
-- abuse flagging was judged too tricky to get right and is being pulled
-- entirely, not just hidden from nav.
--
-- Pre-flight row counts, checked live before writing this migration (all via
-- execute_sql on koiplnmbgnqnbywhpjlf, 2026-09-14): adolescent_psychosocial_
-- screens 0 rows (0 flagged), adolescent_transition_events 0 rows,
-- adolescent_transition_plans 1 row -- a QA fixture ("Test Free Patient",
-- org "Tarragon Health Direct", started 2026-09-03), not a real patient. No
-- real check-in or safeguarding data exists to lose.
--
-- Deliberately NOT touched: adolescent_confidentiality_waivers,
-- private.adolescent_age_band(), private.enforce_adolescent_waiver_
-- revoke_only() (its trigger stays on the waivers table). These aren't part
-- of the check-in feature -- private.guardian_may_view_confidential_domain()
-- calls both, and that function is the live RLS gate on menstrual_cycles/
-- menstrual_daily_logs/reproductive_health_profiles blocking a guardian from
-- reading ANY dependent's (adult or adolescent) reproductive-health data
-- without an explicit waiver. Removing it would be a separate, much bigger
-- security-policy change than "remove the check-in feature" -- confirmed
-- with the founder to keep it. The one product consequence: the sharing-card
-- UI that let a patient grant/revoke a waiver lived only inside the
-- Adolescent Health page/screen being removed here, so there is no more
-- in-app way to grant one -- the gate now fails closed with no self-service
-- escape hatch, which is a capability loss, not a security hole.
--
-- Also deliberately NOT replaced with new code: the 13-year-old "shared
-- access" nudge notification private.transition_adolescent_dependents() used
-- to send. Its 18th-birthday permission step-down (profile_access.
-- permission_level 'manage' -> 'view') is fully superseded by the separate,
-- already-live private.refresh_dependent_transition_statuses() (cron
-- "dependent-transition-status-daily", 20260830103331_dependent_transition_
-- to_adult_care.sql) -- confirmed live via pg_get_functiondef before writing
-- this migration, not assumed from the migration filename. That function
-- does the same manage->view downgrade plus a patient_timeline record, and
-- deliberately leaves profiles.is_dependent_account untouched (a separate,
-- explicit "claim a real login" step via activate_dependent_account_basics)
-- -- docs/PEDIATRIC_CHILD_HEALTH_SPEC.md §48.14 already flagged these two
-- systems as unreconciled overlap; removing this module's own auto-unset of
-- is_dependent_account resolves that overlap in favour of the newer,
-- documented-as-deliberate design rather than leaving two crons racing each
-- other. The 13-year-old nudge itself has no safety function (informational
-- only) and is not replaced.

-- 1. Unschedule both cron jobs first, so nothing can fire mid-migration.
select cron.unschedule(jobid)
from cron.job
where jobname in ('adolescent-transition-sweep', 'adolescent-transition-plan-provisioning');

-- 2. Drop the one external FK pointing at a table we're about to drop.
-- safeguarding_concerns is the shared, general Patient Safety table (see
-- 20260829213100_safeguarding_concerns.sql) -- owned by that module, not
-- this one. ON DELETE SET NULL means no row would have been lost either
-- way, but dropping the constraint explicitly (rather than relying on an
-- implicit CASCADE off DROP TABLE) keeps this migration honest about every
-- object it touches outside the tables it owns.
alter table public.safeguarding_concerns
  drop constraint if exists safeguarding_concerns_linked_screen_id_fkey;

-- 3. Drop the tables. Each DROP TABLE takes its own triggers/indexes/RLS
-- policies with it; nothing here is referenced by any view (checked live
-- via pg_depend before writing this migration).
drop table if exists public.adolescent_psychosocial_screens;
drop table if exists public.adolescent_transition_events;
drop table if exists public.adolescent_transition_plans;

-- 4. Drop the now-orphaned enum (adolescent_transition_events was its only
-- column using it).
drop type if exists public.adolescent_transition_milestone;

-- 5. Drop the standalone functions this module owned. Explicitly NOT
-- dropping private.adolescent_age_band, private.enforce_adolescent_waiver_
-- revoke_only, or private.guardian_may_view_confidential_domain -- see the
-- header. Confirmed live via pg_policies/pg_proc before writing this
-- migration that nothing else calls any of the five functions below.
drop function if exists private.handle_adolescent_psychosocial_screen_flags();
drop function if exists private.enforce_adolescent_transition_stage_authority();
drop function if exists private.provision_adolescent_transition_plans();
drop function if exists private.transition_adolescent_dependents();
drop function if exists private.can_advance_adolescent_transition_stage(uuid);

-- 6. Prove removal rather than hoping for it.
do $$
begin
  if to_regclass('public.adolescent_psychosocial_screens') is not null then
    raise exception 'adolescent_psychosocial_screens still exists';
  end if;
  if to_regclass('public.adolescent_transition_plans') is not null then
    raise exception 'adolescent_transition_plans still exists';
  end if;
  if to_regclass('public.adolescent_transition_events') is not null then
    raise exception 'adolescent_transition_events still exists';
  end if;
  if exists (select 1 from pg_proc where proname = 'transition_adolescent_dependents') then
    raise exception 'private.transition_adolescent_dependents still exists';
  end if;
  if exists (select 1 from cron.job where jobname in ('adolescent-transition-sweep', 'adolescent-transition-plan-provisioning')) then
    raise exception 'an adolescent-health cron job is still scheduled';
  end if;
  -- The mechanism we deliberately kept must still be intact.
  if to_regclass('public.adolescent_confidentiality_waivers') is null then
    raise exception 'adolescent_confidentiality_waivers was dropped -- it should have been kept';
  end if;
  if not exists (select 1 from pg_proc where proname = 'guardian_may_view_confidential_domain') then
    raise exception 'private.guardian_may_view_confidential_domain was dropped -- it should have been kept';
  end if;
  raise notice 'Adolescent Health module removed; confidentiality-waiver gate intact.';
end $$;

-- Tarragon Health — medication safety pathway 64.14: a medication review
-- needs a structured Continue / Change / Stop / Escalate outcome, not just
-- free-text notes.
--
-- medication_reviews (20260716172000_medication_review_engine.sql) already
-- schedules and rolls reviews at the condition cadence and stamps
-- reviewed_by/completed_at server-side on completion, but the only record of
-- what the doctor actually decided is a free-text `notes` field — there is
-- no structured outcome a worklist, an audit, or an analytics rollup could
-- key off. This adds that column and enforces it AT THE COMPLETION
-- TRANSITION (inside stamp_medication_review_completion), not as a blanket
-- table CHECK constraint — a CHECK would need a historical backfill for
-- every already-completed row, which would mean inventing a clinical
-- decision nobody actually made. Requiring it only going forward, exactly at
-- the moment a review moves into 'completed', gets the same guarantee for
-- every future review without fabricating one for the past.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_review_outcome') then
    create type public.medication_review_outcome as enum ('continue', 'change', 'stop', 'escalate');
  end if;
end $$;

alter table public.medication_reviews
  add column if not exists outcome public.medication_review_outcome;

comment on column public.medication_reviews.outcome is
  'What the reviewing doctor decided: continue the regimen unchanged, change it (dose/drug), stop it, or escalate to a senior tier. Required at the moment a review is completed (see stamp_medication_review_completion) — never backfilled onto pre-2026-08-29 completed reviews, which predate this requirement.';

-- Body is byte-for-byte the LIVE definition (confirmed via pg_get_functiondef
-- against the live project before writing this, not just the local migration
-- file — see CLAUDE.md's standing lesson on live/file drift) from
-- 20260812023543_review_completion_clinical_tier_gate.sql, which itself
-- superseded 20260716172000_medication_review_engine.sql's original body
-- with a private.is_clinical_tier() gate (a Care Coordinator can prepare a
-- review but must not be recorded as having completed it). That gate is
-- preserved unchanged below; only the outcome-required guard is added.
create or replace function private.stamp_medication_review_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    if not private.is_clinical_tier(new.organisation_id) then
      raise exception 'Only a clinical-tier member of the care team can complete a medication review. A Care Coordinator can prepare it, but a doctor must complete it.'
        using errcode = '42501';
    end if;
    if new.outcome is null then
      raise exception 'Completing a medication review requires an outcome (continue/change/stop/escalate)' using errcode = '23514';
    end if;

    select id into v_staff_id
    from public.clinical_staff
    where profile_id = (select auth.uid())
      and organisation_id = new.organisation_id
      and active;
    new.completed_at := coalesce(new.completed_at, now());
    new.reviewed_by := v_staff_id;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_reviews' and column_name = 'outcome'
  ) then
    raise exception 'medication_reviews.outcome was not added';
  end if;

  if (select count(*) from pg_enum where enumtypid = 'public.medication_review_outcome'::regtype) <> 4 then
    raise exception 'medication_review_outcome must have exactly 4 values (continue/change/stop/escalate)';
  end if;

  select pg_get_functiondef(oid) into v_def
  from pg_proc where proname = 'stamp_medication_review_completion' and pronamespace = 'private'::regnamespace;

  if v_def not like '%Completing a medication review requires an outcome%' then
    raise exception 'stamp_medication_review_completion is missing the outcome-required guard';
  end if;
  -- Every pre-existing branch must survive the rewrite, including the
  -- 2026-08-12 clinical-tier gate (Care Coordinators must not complete a
  -- review, even if they can prepare one).
  if v_def not like '%private.is_clinical_tier(new.organisation_id)%'
     or v_def not like '%A Care Coordinator can prepare it, but a doctor must complete it.%'
     or v_def not like '%new.completed_at := coalesce(new.completed_at, now());%'
     or v_def not like '%new.reviewed_by := v_staff_id;%' then
    raise exception 'stamp_medication_review_completion lost a pre-existing branch';
  end if;

  raise notice 'PASS: medication_reviews.outcome added, completion requires it going forward';
end $$;

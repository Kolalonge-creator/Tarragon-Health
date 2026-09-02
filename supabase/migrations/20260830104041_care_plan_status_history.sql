-- Tarragon Health — care_plans status history (spec §12 follow-up).
--
-- Context: 20260830015307_population_health_intelligence_analytics.sql's
-- analytics_disease_surveillance() had to report "new enrollments per
-- period" as a proxy for prevalence, with an honesty note explaining that
-- care_plans only stores CURRENT status — there was no way to ask "how many
-- patients had an active hypertension care plan as of the start of last
-- month," only "how many are active right now." That gap doesn't close
-- itself later; every day it isn't fixed is a day of real patient history
-- that's gone for good once a care plan's status changes again. This
-- migration closes it going forward — from the platform's very first real
-- patients onward, not retroactively (there is nothing to backfill; the
-- prior status values were never recorded anywhere).
--
-- Deliberately NOT the generic private.audit_row_change() trigger already
-- attached to care_plans (20260812030853_row_change_audit_triggers.sql) —
-- that system stores changed COLUMN NAMES and a row hash only, by explicit
-- design, to avoid becoming a second broad PHI-exposure surface
-- (20260812030853_row_change_audit_triggers.sql:17-22). Reusing it for real
-- values would mean re-litigating that same exposure decision. A narrow,
-- dedicated history table scoped to exactly one column (status) of one
-- table, carrying the same RLS as care_plans itself, doesn't have that
-- problem — it discloses nothing to anyone who couldn't already see the
-- patient's current care plan.
--
-- What this is NOT: this is internal data-capture plumbing, not the
-- external/national-scale/research/clinical-trials capability §12 as a
-- whole describes. It doesn't touch, expose, or prepare data for any
-- external partner, government, insurer, or research pipeline — see the
-- unmet 3-gate note at docs/Tarragon_Health_Master_Operating_Plan_v4.md
-- §15 for why that side of §12 stays a roadmap note, not a backlog item.

-- care_plan_id/patient_id both cascade, matching care_plans' own FK choices
-- (care_plans.patient_id is itself "on delete cascade" from profiles) — a
-- patient-deletion cascade already removes their care_plans today, and this
-- table shouldn't become a special case that blocks that existing chain.
-- The real protection this table offers isn't against a legitimate cascade,
-- it's against an app-level actor silently rewriting or deleting a
-- history row directly — enforced below by RLS (no insert/update/delete
-- policy for `authenticated` at all) and a no-update trigger.
create table public.care_plan_status_history (
  id                uuid primary key default gen_random_uuid(),
  care_plan_id      uuid not null references public.care_plans (id) on delete cascade,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  condition         public.care_plan_condition not null,
  status            public.care_plan_status not null,
  changed_at        timestamptz not null default now()
);

create index care_plan_status_history_patient_condition_idx
  on public.care_plan_status_history (patient_id, condition, changed_at desc);
create index care_plan_status_history_care_plan_idx
  on public.care_plan_status_history (care_plan_id, changed_at desc);
create index care_plan_status_history_org_idx
  on public.care_plan_status_history (organisation_id, changed_at desc);

comment on table public.care_plan_status_history is
  'Append-only log of every status a care_plan has held and when it started '
  'holding it — care_plans itself only ever stores the CURRENT status. '
  'Populated solely by the care_plans_record_status_history trigger below; '
  'no direct write path exists for any role. Rows cascade-delete only when '
  'their own care_plan/patient does (matching care_plans'' own FK choices), '
  'never independently.';

-- One row per (INSERT, or UPDATE where status actually changed) — mirrors
-- the no-op-suppression judgement call already made for the generic audit
-- trigger (20260812030853_row_change_audit_triggers.sql), just narrower:
-- a plain updated_at touch or a notes/target_ranges edit is not a status
-- change and doesn't belong in a *status* history.
create or replace function private.record_care_plan_status_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    insert into public.care_plan_status_history
      (care_plan_id, patient_id, organisation_id, condition, status, changed_at)
    values
      (new.id, new.patient_id, new.organisation_id, new.condition, new.status, now());
  end if;
  return new;
end;
$$;

create trigger care_plans_record_status_history
  after insert or update on public.care_plans
  for each row execute function private.record_care_plan_status_history();

alter table public.care_plan_status_history enable row level security;

-- Same visibility as care_plans itself — matched against the LIVE
-- care_plans_select policy (not a local migration file, which turned out to
-- be stale here: can_read_clinical gained a category parameter and
-- has_emergency_access was added by a later, unmerged-locally migration —
-- see CLAUDE.md's standing lesson on checking live definitions before
-- trusting a migration-file grep). This table discloses nothing beyond what
-- the same viewer could already read about the patient's current care plan.
create policy care_plan_status_history_select on public.care_plan_status_history
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or private.can_read_clinical(patient_id, 'appointments_care_plan'::care_access_category)
    or private.has_emergency_access(patient_id, 'appointments_care_plan'::care_access_category)
  );

-- No insert/update/delete policy for `authenticated` at all: the trigger
-- function is security definer (runs as the table owner, which RLS does not
-- restrict), so it writes without needing a policy — and the absence of one
-- means no direct app-level path can write. The no-update guard below is
-- belt-and-suspenders against the owner ever changing, matching audit_log's
-- own append-only pattern (20260705211409_platform_infra.sql) — deliberately
-- NOT a no-delete guard, since a legitimate cascade from care_plans/profiles
-- must still be able to remove this table's rows (see the table comment).
create trigger care_plan_status_history_no_update
  before update on public.care_plan_status_history
  for each row execute function private.reject_mutation();

grant select on public.care_plan_status_history to authenticated;

revoke all on function private.record_care_plan_status_history() from public, anon;

do $$
declare
  v_care_plan_id uuid;
  v_patient_id uuid;
  v_org_id uuid;
  v_rows_after integer;
begin
  -- Real end-to-end proof, not just a syntax check: create a throwaway care
  -- plan, walk it through three real status transitions plus one deliberate
  -- no-op edit, confirm exactly the right history lands, then delete the
  -- care plan (cascades away its own history rows) so nothing here persists
  -- in real data.
  select id into v_org_id from public.organisations limit 1;
  select id into v_patient_id from public.profiles where role = 'patient' limit 1;

  if v_org_id is null or v_patient_id is null then
    raise notice 'SKIP: no organisation/patient row available to exercise care_plan_status_history in this environment';
  else
    insert into public.care_plans (organisation_id, patient_id, condition, status)
    values (v_org_id, v_patient_id, 'other', 'draft')
    returning id into v_care_plan_id;

    update public.care_plans set status = 'active' where id = v_care_plan_id;
    update public.care_plans set notes = 'no-op status-unrelated edit' where id = v_care_plan_id;
    update public.care_plans set status = 'completed' where id = v_care_plan_id;

    select count(*) into v_rows_after from public.care_plan_status_history
    where care_plan_id = v_care_plan_id;

    if v_rows_after <> 3 then
      raise exception 'expected 3 status-history rows (draft/active/completed) for test care plan, got %', v_rows_after;
    end if;

    if (
      select count(*) from public.care_plan_status_history
      where care_plan_id = v_care_plan_id and status = 'active'
    ) <> 1 then
      raise exception 'expected exactly one active-status row for test care plan';
    end if;

    begin
      update public.care_plan_status_history
      set status = 'cancelled'
      where care_plan_id = v_care_plan_id and status = 'active';
      raise exception 'expected the no-update trigger to block a direct rewrite of care_plan_status_history';
    exception
      when others then
        if sqlerrm not like '%append-only%' then
          raise;
        end if;
    end;

    raise notice 'PASS: care_plan_status_history recorded % real transitions (draft->active->completed), no-op notes-only edit correctly ignored, direct rewrite correctly blocked', v_rows_after;

    delete from public.care_plans where id = v_care_plan_id;

    select count(*) into v_rows_after from public.care_plan_status_history where care_plan_id = v_care_plan_id;
    if v_rows_after <> 0 then
      raise exception 'expected cascade delete to remove all history rows for the deleted test care plan';
    end if;
  end if;

  if has_function_privilege('anon', 'private.record_care_plan_status_history()', 'EXECUTE') then
    raise exception 'anon can still execute record_care_plan_status_history';
  end if;
end $$;

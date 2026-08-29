-- Tarragon Health — Result Lifecycle §58.16 (Result recall): "Result
-- reviewed -> Repeat in N months -> Recall scheduled -> Patient reminded ->
-- Test completed." Confirmed a genuine gap before writing this — nothing in
-- the codebase previously connected a clinician's "repeat this test" call
-- to an actual scheduled follow-up, a patient reminder, or a "the repeat
-- test came back" closure; screening_results.follow_up_action was free text
-- nobody ever consumed programmatically.
--
-- Deliberately NOT client-writable — same shape as alert_deliveries /
-- patient_result_explanations (CLAUDE.md's grant-discipline lesson: no
-- INSERT/UPDATE policy at all). The only way in is
-- private.create_result_recall_on_repeat_test (fired automatically by
-- setting screening_results.action_type = 'repeat_test', see
-- 20260829122500), so it is structurally impossible for a clinician to mark
-- a result "repeat in 3 months" without a real recall row existing — the
-- §58.19 acceptance criterion this whole feature exists for. The only way
-- out is private.maybe_complete_result_recall (fires automatically when the
-- repeat test's own result is recorded) or public.cancel_result_recall (an
-- explicit clinical decision that a repeat is no longer needed).

do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_recall_status') then
    create type public.result_recall_status as enum ('scheduled', 'reminded', 'completed', 'cancelled');
  end if;
end $$;

create table if not exists public.result_recalls (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations (id) on delete restrict,
  patient_id              uuid not null references public.profiles (id) on delete restrict,
  -- The original result that prompted the repeat — never the repeat's own
  -- result (that's completed_result_id, set once the loop closes).
  screening_result_id     uuid not null references public.screening_results (id) on delete restrict,
  screen_type_code        text references public.screen_types (code),
  reason                  text,
  recommended_by          uuid references public.profiles (id) on delete set null,
  recommended_at          timestamptz not null default now(),
  repeat_due_date         date not null,
  status                  public.result_recall_status not null default 'scheduled',
  reminded_at             timestamptz,
  completed_lab_order_id  uuid references public.lab_orders (id) on delete set null,
  completed_result_id     uuid references public.screening_results (id) on delete set null,
  completed_at            timestamptz,
  cancelled_by            uuid references public.profiles (id) on delete set null,
  cancelled_at            timestamptz,
  cancel_reason           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index result_recalls_org_idx on public.result_recalls (organisation_id);
create index result_recalls_patient_idx on public.result_recalls (patient_id, repeat_due_date);
create index result_recalls_due_idx on public.result_recalls (repeat_due_date)
  where status in ('scheduled', 'reminded');
-- Only one active (not yet completed/cancelled) recall per originating
-- result — a clinician editing the due date on an already-recalled result
-- refreshes this row (see the ON CONFLICT below) rather than piling up
-- duplicates.
create unique index result_recalls_one_active_per_result on public.result_recalls (screening_result_id)
  where status in ('scheduled', 'reminded');

create trigger result_recalls_set_updated_at
  before update on public.result_recalls
  for each row execute function private.set_updated_at();

alter table public.result_recalls enable row level security;

create policy result_recalls_staff_select on public.result_recalls
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy result_recalls_patient_select on public.result_recalls
  for select to authenticated
  using (patient_id = (select auth.uid()));

grant select on public.result_recalls to authenticated;

-- ---------------------------------------------------------------------------
-- Auto-create/refresh: fires when a clinician records a repeat_test action
-- on the reviewed result (see enforce_screening_result_action_fields, which
-- already guarantees action_repeat_due_date is non-null whenever
-- action_type = 'repeat_test').
-- ---------------------------------------------------------------------------
create or replace function private.create_result_recall_on_repeat_test()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recall_id uuid;
begin
  if new.action_type = 'repeat_test' and (
    old.action_type is distinct from new.action_type
    or old.action_repeat_due_date is distinct from new.action_repeat_due_date
  ) then
    insert into public.result_recalls (
      organisation_id, patient_id, screening_result_id, screen_type_code,
      reason, recommended_by, repeat_due_date
    ) values (
      new.organisation_id, new.patient_id, new.id, new.screen_type_code,
      new.follow_up_action, new.reviewed_by, new.action_repeat_due_date
    )
    on conflict (screening_result_id) where status in ('scheduled', 'reminded')
    do update set repeat_due_date = excluded.repeat_due_date, reason = excluded.reason
    returning id into v_recall_id;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (
      new.organisation_id, (select auth.uid()), 'clinician.result_recall_scheduled',
      'result_recall', v_recall_id,
      jsonb_build_object('screening_result_id', new.id, 'repeat_due_date', new.action_repeat_due_date)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists screening_results_create_recall on public.screening_results;
create trigger screening_results_create_recall
  after update on public.screening_results
  for each row execute function private.create_result_recall_on_repeat_test();

revoke all on function private.create_result_recall_on_repeat_test() from public;

-- ---------------------------------------------------------------------------
-- Auto-complete: fires when the repeat test's own result actually comes
-- in — matched on (patient_id, screen_type_code), the same pairing every
-- other result on this patient's timeline is grouped by. Closes the loop
-- without depending on a clinician remembering to come back and mark it.
-- ---------------------------------------------------------------------------
create or replace function private.maybe_complete_result_recall()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count int;
begin
  update public.result_recalls
    set status = 'completed',
        completed_at = now(),
        completed_result_id = new.id,
        completed_lab_order_id = new.lab_order_id
  where patient_id = new.patient_id
    and screen_type_code = new.screen_type_code
    and status in ('scheduled', 'reminded');

  get diagnostics v_count = row_count;
  if v_count > 0 then
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (
      new.organisation_id, (select auth.uid()), 'clinician.result_recall_completed',
      'screening_result', new.id, jsonb_build_object('recalls_completed', v_count)
    );
  end if;

  return new;
end;
$$;

drop trigger if exists screening_results_complete_recall on public.screening_results;
create trigger screening_results_complete_recall
  after insert on public.screening_results
  for each row execute function private.maybe_complete_result_recall();

revoke all on function private.maybe_complete_result_recall() from public;

-- ---------------------------------------------------------------------------
-- The one explicit manual exit: "this repeat test is no longer needed."
-- Gated to an active clinical_staff row, same clinical-judgement gate as
-- setScreeningResultFollowUpAction — deciding a recall is unnecessary is
-- itself a clinical call, not a logistics one.
-- ---------------------------------------------------------------------------
create or replace function public.cancel_result_recall(p_recall_id uuid, p_reason text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_org    uuid;
  v_status public.result_recall_status;
begin
  select organisation_id, status into v_org, v_status
  from public.result_recalls where id = p_recall_id;

  if v_org is null then
    raise exception 'Result recall not found';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorised';
  end if;
  if not exists (
    select 1 from public.clinical_staff
    where profile_id = (select auth.uid()) and active = true
  ) then
    raise exception 'Only an active Tarragon care-team doctor can cancel a result recall.';
  end if;
  if v_status in ('completed', 'cancelled') then
    raise exception 'Only a scheduled or reminded recall can be cancelled' using errcode = '22023';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'A cancellation reason is required';
  end if;

  update public.result_recalls
  set status = 'cancelled', cancelled_by = (select auth.uid()), cancelled_at = now(), cancel_reason = btrim(p_reason)
  where id = p_recall_id;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    v_org, auth.uid(), 'clinician.result_recall_cancelled', 'result_recall', p_recall_id,
    jsonb_build_object('reason', btrim(p_reason))
  );
end;
$$;

revoke all on function public.cancel_result_recall(uuid, text) from public;
grant execute on function public.cancel_result_recall(uuid, text) to authenticated;
revoke execute on function public.cancel_result_recall(uuid, text) from anon;

-- ---------------------------------------------------------------------------
-- Proof, not hope.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'result_recall_status') then
    raise exception 'result_recall_status enum was not created';
  end if;
  if not exists (select 1 from pg_tables where schemaname = 'public' and tablename = 'result_recalls') then
    raise exception 'result_recalls table was not created';
  end if;

  if not has_table_privilege('authenticated', 'public.result_recalls', 'SELECT') then
    raise exception 'authenticated missing SELECT on result_recalls';
  end if;
  if has_table_privilege('anon', 'public.result_recalls', 'SELECT') then
    raise exception 'anon must not have SELECT on result_recalls';
  end if;
  -- Table-level INSERT/UPDATE privilege may still exist for `authenticated`
  -- (the 20260731232749 default-privileges root fix grants it to every
  -- table automatically) — that is expected and harmless. What actually
  -- blocks a direct client write is RLS having no INSERT/UPDATE policy at
  -- all on this table, same as alert_deliveries/patient_result_explanations.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'result_recalls' and cmd in ('INSERT', 'UPDATE')
  ) then
    raise exception 'result_recalls must have no INSERT/UPDATE policy — writes go through the triggers/RPC only';
  end if;

  if has_function_privilege('anon', 'public.cancel_result_recall(uuid, text)', 'EXECUTE') then
    raise exception 'cancel_result_recall is EXECUTE-able by anon';
  end if;
  if not has_function_privilege('authenticated', 'public.cancel_result_recall(uuid, text)', 'EXECUTE') then
    raise exception 'cancel_result_recall is NOT EXECUTE-able by authenticated — grant failed';
  end if;

  if not exists (select 1 from pg_trigger where tgname = 'screening_results_create_recall') then
    raise exception 'screening_results_create_recall trigger was not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'screening_results_complete_recall') then
    raise exception 'screening_results_complete_recall trigger was not created';
  end if;
end $$;

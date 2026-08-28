-- Tarragon Health — medication adherence: access-barrier detail (13.16)
--
-- 13.16 asks the platform to distinguish clinical non-adherence (the patient
-- chooses not to take it) from access non-adherence (the patient cannot
-- obtain it) because they need completely different interventions — a coach
-- conversation about side effects/beliefs versus a coordinator conversation
-- about cost/stockout/transport. medication_log_status='unable_to_obtain'
-- (previous migration) already carries that top-level split structurally;
-- this adds one optional, narrower detail field for WHICH access barrier,
-- so a care coordinator's worklist can tell a stockout from a cost problem
-- without reading free text.
--
-- Nullable and CHECK-constrained to only ever accompany 'unable_to_obtain' —
-- every other status stays exactly as free-text-only as it always was.

do $$ begin
  if not exists (select 1 from pg_type where typname = 'medication_access_barrier_reason') then
    create type public.medication_access_barrier_reason as enum (
      'cost', 'stockout', 'distance', 'no_transport', 'other'
    );
  end if;
end $$;

alter table public.medication_logs
  add column if not exists access_barrier_reason public.medication_access_barrier_reason;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'medication_logs_access_barrier_reason_status'
  ) then
    alter table public.medication_logs
      add constraint medication_logs_access_barrier_reason_status
      check (access_barrier_reason is null or status = 'unable_to_obtain');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_logs'
      and column_name = 'access_barrier_reason'
  ) then
    raise exception 'medication_logs.access_barrier_reason was not added';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'medication_logs_access_barrier_reason_status'
  ) then
    raise exception 'medication_logs_access_barrier_reason_status CHECK was not added';
  end if;
  raise notice 'PASS: medication_logs.access_barrier_reason added, constrained to unable_to_obtain';
end $$;

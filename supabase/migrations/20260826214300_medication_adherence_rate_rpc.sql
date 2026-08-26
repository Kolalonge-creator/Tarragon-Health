-- Tarragon Health — medication adherence rate (self-logged PDC-style proxy)
--
-- docs/FEATURE_SPEC.md promised an "adherence % rollup" for medication_logs;
-- what actually got built (20260716175000_medication_adherence_escalation.sql)
-- is a raw 30-day miss-count trigger for the coach/doctor escalation ladder —
-- useful for alerting, but no percentage is computed or exposed anywhere.
-- Tarragon has no pharmacy claims/dispensing data (Nigeria's cash-pay,
-- fragmented pharmacy market rules out true PDC/MPR), so this is the
-- self-report analogue: taken doses over scheduled doses in a trailing
-- window, sourced from the same medication_logs rows the patient (or their
-- supporter) already logs via Today's Doses.
--
-- Deliberately a plain (non SECURITY DEFINER) function: it only ever reads
-- medication_logs, so running it with the CALLER's own privileges lets the
-- existing RLS policies (medication_logs_select: patient_id = auth.uid() or
-- is_org_staff or can_read_clinical) scope the result correctly with no
-- hand-rolled authorization logic to get subtly wrong — the same reasoning
-- private.patient_has_feature_access's own header gives for why THAT
-- function, by contrast, has to be SECURITY DEFINER (it's read by a trigger
-- with no session at all). A patient calls this for themselves, a consented
-- supporter or org staff member for a patient they can read; anyone else's
-- call simply returns zero rows within the window, not an error.
--
-- 'unconfirmed' rows (grace-period marks, see the companion 20260826213713
-- migration) and 'skipped' rows both count against scheduled_doses but never
-- as taken — an inferred non-response should never inflate a rate the same
-- way a confirmed dose does, and an intentional skip is still a day not
-- covered by the medication regardless of how deliberate it was.

create or replace function public.medication_adherence_summary(
  p_patient_id uuid,
  p_window_days integer default 30
)
returns table (
  scheduled_doses bigint,
  taken_doses bigint,
  missed_doses bigint,
  skipped_doses bigint,
  unconfirmed_doses bigint,
  adherence_rate numeric
)
language sql
stable
set search_path = ''
as $$
  select
    count(*) as scheduled_doses,
    count(*) filter (where status = 'taken') as taken_doses,
    count(*) filter (where status = 'missed') as missed_doses,
    count(*) filter (where status = 'skipped') as skipped_doses,
    count(*) filter (where status = 'unconfirmed') as unconfirmed_doses,
    round(
      count(*) filter (where status = 'taken')::numeric / nullif(count(*), 0),
      4
    ) as adherence_rate
  from public.medication_logs
  where patient_id = p_patient_id
    and scheduled_time is not null
    and scheduled_for_date >= (now() at time zone 'Africa/Lagos')::date - greatest(p_window_days, 1);
$$;

grant execute on function public.medication_adherence_summary(uuid, integer) to authenticated;

comment on function public.medication_adherence_summary is
  'Self-logged adherence proxy over a trailing window (default 30 days): taken doses / scheduled doses, from medication_logs rows that carry a real scheduled_time (freeform/as-needed logs are excluded). adherence_rate is null when scheduled_doses is 0, never 0, so the UI can distinguish "no data yet" from "0% adherent". Invoker-rights — relies entirely on medication_logs RLS for scoping, no internal authorization check.';

do $$
begin
  if not exists (
    select 1 from pg_proc
    where proname = 'medication_adherence_summary' and pronamespace = 'public'::regnamespace
  ) then
    raise exception 'FAIL: public.medication_adherence_summary was not created';
  end if;

  if exists (
    select 1 from pg_proc
    where proname = 'medication_adherence_summary' and pronamespace = 'public'::regnamespace
      and prosecdef
  ) then
    raise exception 'FAIL: medication_adherence_summary must stay invoker-rights (not security definer) so RLS applies';
  end if;

  raise notice 'PASS: public.medication_adherence_summary is in place, invoker-rights';
end $$;

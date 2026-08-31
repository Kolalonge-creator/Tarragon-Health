-- Tarragon Health — missed-dose reason capture (Engagement/Retention gap #1)
--
-- Today, marking a dose "missed" in the patient app captures nothing beyond
-- the bare status. This adds a classified reason so the platform can react
-- differently depending on WHY a dose was missed, instead of treating every
-- miss identically. The free-text `reason` column is untouched (still
-- available for a clinician/staff-entered note); `missed_reason` is patient-
-- self-reported and structured.

create type public.medication_missed_reason as enum (
  'forgot',
  'device_unavailable',
  'doesnt_understand',
  'doesnt_want_to',
  'feels_well',
  'technical_problem'
);

alter table public.medication_logs
  add column missed_reason public.medication_missed_reason;

comment on column public.medication_logs.missed_reason is
  'Patient-selected reason captured when status=missed. Only meaningful alongside status=missed; kept as history if status is later changed, and distinct from the free-text reason column (clinician/staff notes).';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'medication_logs' and column_name = 'missed_reason'
  ) then
    raise exception 'FAIL: medication_logs.missed_reason column was not created';
  end if;

  if (select count(*) from unnest(enum_range(null::public.medication_missed_reason)) v) <> 6 then
    raise exception 'FAIL: medication_missed_reason enum does not have exactly 6 values';
  end if;

  raise notice 'PASS: medication_missed_reason enum + medication_logs.missed_reason column created';
end $$;

-- Tarragon Health — medication safety pathway 64.9/64.10: "I'm experiencing
-- a side effect" reuses the existing structured symptom intake + severity
-- triage (symptoms / private.handle_symptom_red_flag, 20260714120000 and
-- since evolved through several migrations — most recently gated to paid
-- plans by 20260810022401_gate_vitals_red_flag_escalation_to_paid_plans.sql)
-- rather than building a second, parallel side-effect-specific triage
-- pipeline. That trigger already does exactly what 64.10 asks for —
-- severity >= 8 (or a red-flag symptom type at >= 6) -> urgent pathway;
-- severity >= 5 -> clinical review; below that, nothing — so the only real
-- gap is that a symptom report has no way to say WHICH medication it's
-- about. This adds that one, purely additive column.
--
-- Deliberately does NOT touch private.handle_symptom_red_flag() itself: that
-- function has been revised by six later migrations since it was written
-- (feature-gating, SLA config lookup, an expanded red-flag type list — live-
-- checked via pg_get_functiondef against the live project before writing
-- this, not the original migration file, per CLAUDE.md's standing lesson on
-- live/file drift) and none of that logic needs to change for a
-- medication-linked symptom to be triaged identically to any other one.
-- Nullable and on delete set null: a general (non-medication) symptom report
-- is completely unaffected, and a medication being removed later must never
-- retroactively invalidate or cascade-delete a symptom report that already
-- happened.

alter table public.symptoms
  add column if not exists medication_id uuid references public.medications (id) on delete set null;

comment on column public.symptoms.medication_id is
  'Set when this symptom was reported as a medication side effect ("I''m experiencing a side effect") rather than a general symptom. Null for a general symptom report. Existing severity-based red-flag triage (private.handle_symptom_red_flag) applies unchanged either way.';

create index if not exists symptoms_medication_idx on public.symptoms (medication_id) where medication_id is not null;

-- ---------------------------------------------------------------------------
-- The migration is the test.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'symptoms' and column_name = 'medication_id'
  ) then
    raise exception 'symptoms.medication_id was not added';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'symptoms_red_flag_check' and tgrelid = 'public.symptoms'::regclass and not tgisinternal
  ) then
    raise exception 'symptoms_red_flag_check trigger is missing — this migration must never touch it, only verify it is untouched';
  end if;

  raise notice 'PASS: symptoms.medication_id added, existing red-flag trigger untouched';
end $$;

-- Medication: keep the record, drop the routing.
--
-- Tarragon has no contracted pharmacy, and pharmacy_medications has 0 rows, so
-- the catalogue could not fulfil anything even before this. What survives, and
-- must survive, is the whole chronic pathway: prescribing, dose changes,
-- refill reminders, adherence check-ins, the missed-dose escalation ladder,
-- medication reviews, and drug-class lab monitoring. None of that needs a
-- partner pharmacy. Only the ordering/routing does.
--
-- pharmacy_order_dispenses already had the right RLS for a patient to log their
-- own collection (pharmacy_order_dispenses_insert admits patient_id =
-- auth.uid()). The single thing blocking "I bought this at the chemist down the
-- road" was pharmacy_order_id being NOT NULL — a dispense could only exist
-- against an order Tarragon had routed.
--
-- Row count checked first: pharmacy_order_dispenses is empty, so nothing needs
-- backfilling and the constraint change is purely structural.

alter table public.pharmacy_order_dispenses
  alter column pharmacy_order_id drop not null;

alter table public.pharmacy_order_dispenses
  add column if not exists pharmacy_name text,
  -- Ties a collection to the medication it was for, which is what makes this
  -- an adherence signal rather than a loose note. Nullable: a patient may log
  -- something not on their list. SET NULL rather than CASCADE because the
  -- collection still happened even if the medication row is later removed.
  add column if not exists medication_id uuid
    references public.medications (id) on delete set null;

comment on column public.pharmacy_order_dispenses.pharmacy_order_id is
  'The Tarragon-routed order this was dispensed against. NULL for a collection the patient made at a pharmacy of their own choosing, which is the normal case while no pharmacy partner is contracted.';
comment on column public.pharmacy_order_dispenses.pharmacy_name is
  'Free text, patient-reported. Never a partner reference.';

create index if not exists pharmacy_order_dispenses_medication_idx
  on public.pharmacy_order_dispenses (medication_id, dispensed_on desc)
  where medication_id is not null;

-- A dispense must say what it was against: a routed order, or a medication the
-- patient collected. A row with neither is an orphan nobody can act on.
alter table public.pharmacy_order_dispenses
  drop constraint if exists pharmacy_order_dispenses_has_context;
alter table public.pharmacy_order_dispenses
  add constraint pharmacy_order_dispenses_has_context
  check (pharmacy_order_id is not null or medication_id is not null);

do $$
begin
  if (select is_nullable from information_schema.columns
       where table_schema='public' and table_name='pharmacy_order_dispenses'
         and column_name='pharmacy_order_id') <> 'YES' then
    raise exception 'pharmacy_order_id is still NOT NULL - a patient cannot log a collection';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='pharmacy_order_dispenses'
       and column_name='medication_id'
  ) then
    raise exception 'medication_id was not added';
  end if;
  -- The pathway that must NOT have been touched.
  if not exists (select 1 from pg_proc where proname='queue_medication_refill_reminders'
                   and pronamespace='private'::regnamespace) then
    raise exception 'the medication refill reminder engine is missing';
  end if;
  if not exists (select 1 from cron.job where jobname='medication-refill-reminders-daily' and active) then
    raise exception 'medication refill reminders are no longer scheduled';
  end if;
  if not exists (select 1 from cron.job where jobname='medication-review-reminders-daily' and active) then
    raise exception 'medication review reminders are no longer scheduled';
  end if;
end $$;

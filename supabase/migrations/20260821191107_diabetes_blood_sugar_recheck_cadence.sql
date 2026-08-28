-- Founder decision 2026-08-21, open item 2 of the "One review, adapted" note,
-- taken as clinical director:
--
--   "Blood sugar recheck frequency — 2x a year INCLUDING the annual check-up,
--    so every 6 months when stable; up to 4x when not, and that also includes
--    the annual check-up."
--
-- So: HbA1c every 6 months for a patient at their target, every 3 months for
-- one who is not — and in both cases the annual review is one of those
-- occurrences, not an extra on top.
--
-- HOW "INCLUDING THE ANNUAL CHECK-UP" IS ACTUALLY ENFORCED
-- -------------------------------------------------------
-- Not by a flag, and not by special-casing the annual review anywhere. The
-- cadence is measured from the patient's LAST HbA1c RESULT, whichever order
-- produced it — a standalone recheck, a Screen tier, or the annual review.
-- private.refresh_screening_schedule_on_result already fires on every
-- screening_results row regardless of caller, so the annual review's own
-- HbA1c line closes the open schedule and rolls the next one 6 (or 3) months
-- forward by itself. A diabetic patient therefore gets two blood-sugar
-- events a year in total, one of which is their annual review — never an
-- annual review in September and a "due" recheck pinging them in October.
--
-- The same reading of the same decision is applied to the other direction
-- too: private.compute_screening_order_exclusions decides whether a chronic
-- pathway "already covers" a test recently enough to leave it out of a Screen
-- order. For HbA1c it was using medication_review_cadences.diabetes, which is
-- 3 months because that is the right cadence for reviewing someone's MEDICINES
-- — a different clinical question that happened to be the only interval
-- available when that function was written. It now reads this cadence
-- instead, so "how often do we recheck blood sugar" has exactly one answer on
-- the platform rather than two that agree only by accident.
--
-- WHY THIS IS A TABLE AND NOT TWO NUMBERS IN A FUNCTION
-- ----------------------------------------------------
-- Same discipline as escalation_slas and medication_review_cadences: a
-- clinical interval a director may need to change is data, changed by an
-- UPDATE and visible to anyone reading the database, not a literal buried in
-- a trigger body that needs a migration and a code reviewer to find.

-- ---------------------------------------------------------------------------
-- 1. Control state.
--
-- Three values, not two, because "we do not know yet" is a real and common
-- state — a newly diagnosed patient with no HbA1c on file yet — and calling
-- that person "unstable" in a column a clinician might one day see on screen
-- would be a mislabel. It carries the same 3-month interval as above_target
-- (the diabetes protocol's own "review every 3 months until glycaemic target
-- reached"), but it says the true thing about why.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.chronic_control_state as enum
    ('at_target', 'above_target', 'not_yet_established');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. The target numbers, as data.
--
-- patient_glucose_targets.hba1c_target_percent is the individualised, doctor-
-- set target and always wins. These are the fallbacks for a patient whose
-- target category is set but whose exact percentage is not — the figures the
-- diabetes pathway (§9) already states in prose, written down somewhere a
-- clinical director can change them.
-- ---------------------------------------------------------------------------
create table if not exists public.glycaemic_target_defaults (
  category             public.glycaemic_target_category primary key,
  hba1c_target_percent numeric(3, 1) not null
);

insert into public.glycaemic_target_defaults (category, hba1c_target_percent) values
  ('tight',    6.5),
  ('standard', 7.0),
  ('relaxed',  8.0)
on conflict (category) do nothing;

comment on table public.glycaemic_target_defaults is
  'Fallback HbA1c target per target category, from the diabetes pathway §9. Only consulted when a patient has a category but no explicit hba1c_target_percent; the individualised number always wins.';

alter table public.glycaemic_target_defaults enable row level security;
drop policy if exists glycaemic_target_defaults_select on public.glycaemic_target_defaults;
create policy glycaemic_target_defaults_select on public.glycaemic_target_defaults
  for select to authenticated using (true);
grant select on public.glycaemic_target_defaults to authenticated;
revoke all on public.glycaemic_target_defaults from anon;

-- ---------------------------------------------------------------------------
-- 3. The cadence itself — the founder's decision, in one table.
-- ---------------------------------------------------------------------------
create table if not exists public.condition_screen_cadences (
  condition        public.care_plan_condition not null,
  screen_type_code text not null references public.screen_types (code) on delete restrict,
  control_state    public.chronic_control_state not null,
  interval_months  integer not null check (interval_months between 1 and 60),
  note             text,
  primary key (condition, screen_type_code, control_state)
);

comment on table public.condition_screen_cadences is
  'How often an active chronic pathway rechecks one of its own screening items, by how well controlled the patient currently is. Overrides screen_types.frequency_months (the general-population interval) for a patient on that pathway. The annual review is not a special case here: the interval is measured from the last result of any kind, so the annual review counts as one of the occurrences.';

insert into public.condition_screen_cadences
  (condition, screen_type_code, control_state, interval_months, note)
values
  ('diabetes', 'hba1c', 'at_target',           6,
   'Founder/clinical-director decision 2026-08-21: twice a year when stable, the annual review being one of the two.'),
  ('diabetes', 'hba1c', 'above_target',        3,
   'Up to four times a year when not at target, the annual review being one of the four.'),
  ('diabetes', 'hba1c', 'not_yet_established', 3,
   'No HbA1c on file yet, so no demonstrated control. Treated at the tighter interval, matching the diabetes pathway''s "review every 3 months until glycaemic target reached".')
on conflict (condition, screen_type_code, control_state) do nothing;

alter table public.condition_screen_cadences enable row level security;
drop policy if exists condition_screen_cadences_select on public.condition_screen_cadences;
create policy condition_screen_cadences_select on public.condition_screen_cadences
  for select to authenticated using (true);
grant select on public.condition_screen_cadences to authenticated;
revoke all on public.condition_screen_cadences from anon;

-- ---------------------------------------------------------------------------
-- 4. The clinician override.
--
-- Deterministic classification with an explicit override field, the same
-- shape as the rest of the platform's clinical decisioning: the derived state
-- is reproducible from the data, and a doctor who disagrees says so on the
-- record rather than by nudging the inputs. Null means "derive it" — never
-- "assume stable" (CLAUDE.md: never infer or default a clinical field; an
-- unset value means unset).
--
-- Attribution is required by constraint, not by convention, because an
-- override that stretches a patient's recheck from 3 months to 6 is a
-- clinical decision somebody has to own.
-- ---------------------------------------------------------------------------
alter table public.patient_glucose_targets
  add column if not exists control_state_override        public.chronic_control_state,
  add column if not exists control_state_override_by     uuid references public.clinical_staff (id) on delete restrict,
  add column if not exists control_state_override_at     timestamptz,
  add column if not exists control_state_override_reason text;

comment on column public.patient_glucose_targets.control_state_override is
  'Set only when a doctor is deliberately overriding the derived control state. NULL means derive it from the latest HbA1c against this patient''s target — not "assume at target".';

alter table public.patient_glucose_targets
  drop constraint if exists patient_glucose_targets_control_override_attributed;
alter table public.patient_glucose_targets
  add constraint patient_glucose_targets_control_override_attributed check (
    control_state_override is null
    or (control_state_override_by is not null
        and control_state_override_at is not null
        and control_state_override_reason is not null
        and length(btrim(control_state_override_reason)) > 0)
  );

-- ---------------------------------------------------------------------------
-- 5. Deriving the state.
-- ---------------------------------------------------------------------------
create or replace function private.patient_chronic_control_state(
  p_patient_id uuid,
  p_condition public.care_plan_condition
)
returns public.chronic_control_state
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_override public.chronic_control_state;
  v_target   numeric(3, 1);
  v_latest   numeric;
  v_status   text;
begin
  -- Only a patient actually on the pathway has a pathway control state.
  if not exists (
    select 1 from public.care_plans cp
    where cp.patient_id = p_patient_id
      and cp.condition = p_condition
      and cp.status = 'active'
  ) then
    return null;
  end if;

  -- Only diabetes has a derivation today. Another condition added to
  -- condition_screen_cadences without a derivation here falls to
  -- not_yet_established, which is the tighter interval — the safe direction.
  if p_condition <> 'diabetes' then
    return 'not_yet_established';
  end if;

  select pgt.control_state_override,
         coalesce(pgt.hba1c_target_percent, gtd.hba1c_target_percent)
    into v_override, v_target
    from public.patient_glucose_targets pgt
    left join public.glycaemic_target_defaults gtd on gtd.category = pgt.category
   where pgt.patient_id = p_patient_id;

  if v_override is not null then
    return v_override;
  end if;

  -- No target row at all: fall back to the standard adult target rather than
  -- refusing to classify, so a patient nobody has individualised yet still
  -- gets a sensible recheck interval.
  if v_target is null then
    select hba1c_target_percent into v_target
      from public.glycaemic_target_defaults where category = 'standard';
  end if;

  -- Preferred source: the actual number. lab_analyte_readings is the dated
  -- numeric analyte history; screening_results carries no numeric value.
  select lar.value into v_latest
    from public.lab_analyte_readings lar
   where lar.patient_id = p_patient_id
     and lar.code = 'hba1c'
     and lar.value is not null
   order by lar.taken_at desc nulls last
   limit 1;

  if v_latest is not null then
    return case when v_latest <= v_target then 'at_target' else 'above_target' end;
  end if;

  -- Fallback: a screening result exists but only as a status. Anything that
  -- is not explicitly normal counts as above target — again the tighter
  -- interval when the evidence is weaker.
  select sr.result_status::text into v_status
    from public.screening_results sr
   where sr.patient_id = p_patient_id
     and sr.screen_type_code = 'hba1c'
   order by sr.created_at desc
   limit 1;

  if v_status is not null then
    return case when v_status = 'normal' then 'at_target' else 'above_target' end;
  end if;

  return 'not_yet_established';
end;
$$;

revoke all on function private.patient_chronic_control_state(uuid, public.care_plan_condition) from public;

-- ---------------------------------------------------------------------------
-- 6. The interval this patient's next recheck should use.
--
-- Shortest wins when more than one active pathway claims the same item — a
-- patient with both diabetes and CKD gets the tighter of the two, never the
-- looser.
-- ---------------------------------------------------------------------------
create or replace function private.patient_screen_interval_months(
  p_patient_id uuid,
  p_screen_type_code text
)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select min(csc.interval_months)
    from public.care_plans cp
    join public.condition_screen_cadences csc
      on csc.condition = cp.condition
     and csc.screen_type_code = p_screen_type_code
     and csc.control_state = coalesce(
           private.patient_chronic_control_state(p_patient_id, cp.condition),
           'not_yet_established'
         )
   where cp.patient_id = p_patient_id
     and cp.status = 'active';
$$;

revoke all on function private.patient_screen_interval_months(uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 7. The calendar honours it.
--
-- Supersedes the copy in 20260802232317. Every branch of that function is
-- preserved byte-for-byte — the tighten-only close-out, the roll-forward from
-- the result date rather than the old due date, the "one-off screenings get
-- no follow-up row" rule, and the swallow-everything exception handler that
-- guarantees refreshing a calendar can never block recording a clinical
-- result. The single change is where the interval comes from.
-- ---------------------------------------------------------------------------
create or replace function private.refresh_screening_schedule_on_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_screen_type_id uuid;
  v_frequency_months int;
  v_pathway_months int;
begin
  if new.screen_type_code is null then
    return new;
  end if;

  select id, frequency_months
    into v_screen_type_id, v_frequency_months
  from public.screen_types
  where code = new.screen_type_code
    and is_active = true;

  if v_screen_type_id is null then
    return new;
  end if;

  -- An active chronic pathway rechecks its own items on its own cadence,
  -- which for a diabetic patient's HbA1c is 6 months at target and 3 above
  -- it — rather than the 12-month general-population interval on
  -- screen_types. Measured from THIS result, so an annual review's own HbA1c
  -- line resets the clock exactly like a standalone recheck does. That is
  -- what makes the annual review count as one of the two (or four).
  v_pathway_months := private.patient_screen_interval_months(new.patient_id, new.screen_type_code);
  if v_pathway_months is not null then
    v_frequency_months := v_pathway_months;
  end if;

  update public.screening_schedules
  set status = 'completed'
  where patient_id = new.patient_id
    and screen_type_id = v_screen_type_id
    and status in ('pending', 'booked', 'overdue');

  if v_frequency_months is not null then
    insert into public.screening_schedules (organisation_id, patient_id, screen_type_id, due_date, status)
    values (
      new.organisation_id,
      new.patient_id,
      v_screen_type_id,
      (current_date + (v_frequency_months || ' months')::interval)::date,
      'pending'
    );
  end if;

  return new;
exception
  when others then
    return new;
end;
$$;

revoke all on function private.refresh_screening_schedule_on_result() from public;

-- ---------------------------------------------------------------------------
-- 8. And so does the "already covered by a pathway" window.
--
-- Supersedes the copy in 20260802212440. Every reason, every branch and every
-- ordering is preserved byte-for-byte; the only change is the interval used
-- to decide whether a pathway-owned item was done RECENTLY ENOUGH to leave
-- out of a Screen order. It now prefers this migration's screening cadence
-- and falls back to medication_review_cadences exactly as before for any item
-- with no screening cadence of its own.
--
-- Concretely, for a stable diabetic: an HbA1c done four months ago now counts
-- as covered (6-month cadence) instead of not-covered (the 3-month medication
-- review interval), so their annual review neither re-bills nor re-collects a
-- blood-sugar test they have effectively just had. Which is the same founder
-- decision as section 7, seen from the billing side.
-- ---------------------------------------------------------------------------
create or replace function private.compute_screening_order_exclusions(
  p_patient_id uuid,
  p_organisation_id uuid,
  p_test_codes text[]
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_code text;
  v_result jsonb := '[]'::jsonb;
  v_hbv public.hbv_status;
  v_hcv public.hcv_status;
  v_hiv public.hiv_status;
  v_has_sdm boolean;
  v_reason text;
  v_owning_condition public.care_plan_condition;
  v_pathway_interval int;
  v_recent boolean;
begin
  select hbv_status, hcv_status, hiv_status
    into v_hbv, v_hcv, v_hiv
    from public.profiles where id = p_patient_id;

  foreach v_code in array p_test_codes loop
    v_reason := null;

    -- Lifetime-once items already on file.
    if v_code in ('blood_group', 'sickle_cell_genotype') and exists (
      select 1 from public.screening_results sr
      where sr.patient_id = p_patient_id and sr.screen_type_code = v_code
    ) then
      v_reason := 'lifetime_once_on_file';
    end if;

    -- Terminal serology states — never re-test.
    if v_reason is null and v_code = 'hep_b' and v_hbv = 'chronic_hbv' then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hep_c' and v_hcv in ('hcv_rna_pending', 'hcv_active') then
      v_reason := 'terminal_serology_state';
    end if;
    if v_reason is null and v_code = 'hiv' and v_hiv = 'hiv_positive' then
      v_reason := 'terminal_serology_state';
    end if;

    -- PSA needs a recorded shared decision before it can be resulted.
    if v_reason is null and v_code = 'psa' then
      select exists (
        select 1 from public.patient_shared_decisions
        where patient_id = p_patient_id and screen_type_code = 'psa'
      ) into v_has_sdm;
      if not v_has_sdm then
        v_reason := 'pending_shared_decision';
      end if;
    end if;

    -- Owned by an active chronic pathway that already covers it recently.
    if v_reason is null then
      select spc.condition into v_owning_condition
        from public.screening_pathway_coverage spc
        join public.care_plans cp
          on cp.condition = spc.condition
         and cp.patient_id = p_patient_id
         and cp.status = 'active'
        where spc.item_code = v_code
        limit 1;

      if v_owning_condition is not null then
        -- Prefer the screening cadence for this item and this patient's
        -- current control state; fall back to the medication-review interval
        -- for any pathway item that has no screening cadence of its own.
        select csc.interval_months into v_pathway_interval
          from public.condition_screen_cadences csc
         where csc.condition = v_owning_condition
           and csc.screen_type_code = v_code
           and csc.control_state = coalesce(
                 private.patient_chronic_control_state(p_patient_id, v_owning_condition),
                 'not_yet_established'
               );

        if v_pathway_interval is null then
          select interval_months into v_pathway_interval
            from public.medication_review_cadences
            where condition = v_owning_condition;
        end if;

        select exists (
          select 1 from public.screening_results sr
          where sr.patient_id = p_patient_id
            and sr.screen_type_code = v_code
            and sr.created_at > now() - make_interval(months => coalesce(v_pathway_interval, 6))
        ) into v_recent;

        if v_recent then
          v_reason := 'owned_by_pathway:' || v_owning_condition::text;
        end if;
      end if;
    end if;

    if v_reason is not null then
      v_result := v_result || jsonb_build_object('item_code', v_code, 'reason', v_reason);
    end if;
  end loop;

  return v_result;
end;
$$;

revoke all on function private.compute_screening_order_exclusions(uuid, uuid, text[]) from public;

-- ---------------------------------------------------------------------------
-- 9. Assertions.
-- ---------------------------------------------------------------------------
do $$
declare
  v_at    int;
  v_above int;
  v_none  int;
begin
  select interval_months into v_at
    from public.condition_screen_cadences
   where condition = 'diabetes' and screen_type_code = 'hba1c' and control_state = 'at_target';
  select interval_months into v_above
    from public.condition_screen_cadences
   where condition = 'diabetes' and screen_type_code = 'hba1c' and control_state = 'above_target';
  select interval_months into v_none
    from public.condition_screen_cadences
   where condition = 'diabetes' and screen_type_code = 'hba1c' and control_state = 'not_yet_established';

  -- The decision, restated as arithmetic: twice a year stable, four times
  -- a year when not — the annual review being one of them either way.
  if v_at is distinct from 6 or 12 / v_at <> 2 then
    raise exception 'stable diabetic HbA1c cadence should be 6 months (2x a year), got %', v_at;
  end if;
  if v_above is distinct from 3 or 12 / v_above <> 4 then
    raise exception 'above-target diabetic HbA1c cadence should be 3 months (4x a year), got %', v_above;
  end if;
  if v_none is distinct from v_above then
    raise exception 'an unestablished patient must be rechecked at the tighter interval, got % vs %', v_none, v_above;
  end if;

  -- An override with nobody's name on it must be impossible. Asserted
  -- structurally here rather than by attempting an insert: patient_glucose_
  -- targets.patient_id is unique, so a probe insert against a real profile
  -- can fail on the UNIQUE constraint instead of the CHECK and pass for the
  -- wrong reason — and a migration is the wrong place to write a row it then
  -- has to clean up. The discriminating version, with its deliberate
  -- sabotage control, lives in packages/db/tests/diabetes_recheck_cadence.sql.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.patient_glucose_targets'::regclass
       and conname = 'patient_glucose_targets_control_override_attributed'
       and pg_get_constraintdef(oid) like '%control_state_override_by%'
       and pg_get_constraintdef(oid) like '%control_state_override_reason%'
  ) then
    raise exception 'the control-state override is not attribution-constrained';
  end if;

  -- Both readers really are reading the cadence table.
  if pg_get_functiondef('private.refresh_screening_schedule_on_result()'::regprocedure)
       not like '%patient_screen_interval_months%' then
    raise exception 'the screening calendar is not reading the chronic cadence';
  end if;
  if pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%condition_screen_cadences%' then
    raise exception 'the pathway-coverage window is not reading the chronic cadence';
  end if;

  -- The four exclusion reasons all survived the rewrite of section 8.
  if pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%lifetime_once_on_file%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%terminal_serology_state%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%pending_shared_decision%'
   or pg_get_functiondef('private.compute_screening_order_exclusions(uuid,uuid,text[])'::regprocedure)
       not like '%owned_by_pathway%' then
    raise exception 'an exclusion reason was lost rewriting compute_screening_order_exclusions';
  end if;
end $$;
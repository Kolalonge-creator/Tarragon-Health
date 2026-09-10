-- Supervised Weight Management: Tarragon supervises, Tarragon does not supply.
-- Founder decision, 2026-09-10.
--
-- THE COMMERCIAL CASE
-- -------------------
-- GLP-1 therapy is a cash market in Nigeria at roughly 380,000-880,000 naira per
-- four-week pen, with no HMO cover anywhere. What that buyer cannot get from a
-- pharmacy is the clinical wrap: whether they are a suitable candidate at all,
-- a baseline before starting, a dose-escalation plan owned by a doctor,
-- somebody watching for the side effects that matter, and a review when their
-- numbers move. Tarragon already has every one of those capabilities and gives
-- all of them away -- the pricing page says in terms that weight and lifestyle
-- coaching are free, and the paid twelve-week programme deliberately excludes
-- weight as a condition in its own right.
--
-- Priced at roughly a twentieth of what the patient is already spending on the
-- medicine itself.
--
-- SUPERVISION ONLY, AND THIS IS STRUCTURAL RATHER THAN COPY
-- ---------------------------------------------------------
-- Founder decision: Tarragon supervises patients who obtain the medicine
-- elsewhere. It does not prescribe it and does not supply it. Two reasons, and
-- both are real:
--
--   1. Tarragon is not a distributor of anything. This is the same decision
--      already taken about blood-pressure cuffs and glucometers on 2026-08-02.
--   2. Remote first prescription is constrained under MDCN's telemedicine
--      guidance, and this platform has not confirmed the position directly with
--      MDCN. Building a prescribing path on a secondary reading of that guidance
--      would be building a regulatory exposure into the schema.
--
-- So the enrolment REQUIRES a linked public.medications row whose source is
-- 'patient' and which names an external prescriber, and a trigger refuses
-- anything else. A future decision to prescribe would have to change that
-- trigger deliberately, which is the point: it cannot drift into prescribing by
-- accident, and nobody can enrol a patient on a medicine Tarragon started.
--
-- ELIGIBILITY IS A CLINICAL JUDGEMENT, NOT A CHECKBOX
-- ---------------------------------------------------
-- public.obesity_assessments already exists and is properly built -- BMI, waist,
-- waist-to-height ratio, EOSS stage, complications, secondary causes,
-- adiposity_confirmed, preclinical versus clinical status. An enrolment must
-- reference one, and it must have been recorded by a member of clinical staff.
-- This deliberately does not encode a BMI threshold in SQL: thresholds differ by
-- comorbidity and the decision belongs to the doctor, not to a CHECK constraint.

begin;

-- ---------------------------------------------------------------------------
-- 1. The products
-- ---------------------------------------------------------------------------

insert into public.service_products
  (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values
  ('weight_management_3m',
   'Supervised Weight Management, 3 months',
   'Three months of medical supervision while you are losing weight on medication you obtain yourself. A doctor confirms you are a suitable candidate, agrees the dose-escalation plan with you, watches for the side effects that matter, and reviews your progress each month. Your blood pressure, weight and glucose are monitored throughout, and a dangerous reading reaches a doctor. Tarragon does not prescribe or supply the medicine; you bring your own prescription. Paid once, for three months. Nothing renews.',
   7500000, 'NGN', 90,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], true),

  ('weight_management_6m',
   'Supervised Weight Management, 6 months',
   'Six months of the same medical supervision, which covers the full escalation to a maintenance dose for most people rather than stopping partway through it. A doctor confirms your suitability, owns the dose plan, watches for side effects and reviews you monthly, with your blood pressure, weight and glucose monitored throughout. Tarragon does not prescribe or supply the medicine. Paid once, for six months. Nothing renews.',
   13200000, 'NGN', 180,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], true),

  ('weight_management_12m',
   'Supervised Weight Management, 12 months',
   'A full year of medical supervision, at the lowest monthly equivalent we offer, covering escalation, maintenance and the point at which you and your doctor decide what happens next. Includes monthly doctor review, side-effect monitoring and continuous monitoring of your blood pressure, weight and glucose. Tarragon does not prescribe or supply the medicine. Paid once, for a year. Nothing renews.',
   24000000, 'NGN', 365,
   array['weight_management_supervised', 'vitals_red_flag_doctor_escalation',
         'clinician_review', 'doctor_checkin', 'async_doctor_visit',
         'result_document_review'], true)

on conflict (code) do update
  set name                = excluded.name,
      description         = excluded.description,
      price_kobo          = excluded.price_kobo,
      access_duration_days = excluded.access_duration_days,
      features            = excluded.features,
      is_active           = true;

-- The dormant obesity programme becomes the clinical spine of the paid product
-- rather than a second, parallel definition of the same thing.
update public.chronic_condition_programmes
   set monitoring_vitals    = array['weight', 'blood_pressure', 'glucose']::public.vital_type[],
       review_cadence_months = 1,
       is_active            = true,
       purchase_summary     = 'Supervised while you lose weight on medication you obtain yourself: suitability confirmed by a doctor, a dose plan they own, side-effect monitoring, and a review every month.'
 where code = 'obesity';

-- ---------------------------------------------------------------------------
-- 2. Enrolment
-- ---------------------------------------------------------------------------

create type public.weight_management_status as enum
  ('pending_eligibility', 'active', 'paused', 'completed', 'withdrawn');

create table public.weight_management_enrolments (
  id                      uuid primary key default gen_random_uuid(),
  organisation_id         uuid not null references public.organisations(id) on delete cascade,
  patient_id              uuid not null references public.profiles(id) on delete cascade,
  service_purchase_id     uuid references public.service_purchases(id) on delete set null,
  obesity_assessment_id   uuid references public.obesity_assessments(id) on delete restrict,
  medication_id           uuid references public.medications(id) on delete restrict,
  supervising_clinician_id uuid references public.profiles(id) on delete restrict,
  status                  public.weight_management_status not null default 'pending_eligibility',
  term_days               integer not null,
  starting_weight_kg      numeric(5,2),
  target_weight_kg        numeric(5,2),
  eligibility_confirmed_at timestamptz,
  eligibility_confirmed_by uuid references public.profiles(id) on delete restrict,
  eligibility_notes       text,
  started_at              timestamptz,
  ends_at                 date,
  ended_reason            text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- An enrolment cannot become active until a member of clinical staff has
  -- confirmed suitability against a recorded assessment. Both halves, or
  -- neither: a confirmation with no assessment behind it is not a confirmation.
  constraint wme_active_needs_eligibility check (
    status <> 'active' or (
      eligibility_confirmed_at is not null
      and eligibility_confirmed_by is not null
      and obesity_assessment_id is not null
      and supervising_clinician_id is not null
    )
  ),
  constraint wme_term_is_a_real_term check (term_days in (90, 180, 365))
);

comment on table public.weight_management_enrolments is
  'Supervision of a patient losing weight on medication they obtained themselves. Tarragon does not prescribe or supply that medication -- see private.enforce_weight_management_supervision_only, which is what makes that structural rather than a claim in copy.';
comment on column public.weight_management_enrolments.medication_id is
  'The patient''s own medication row. Must have source = ''patient'' and name an external prescriber. Nullable only while status is pending_eligibility, because a patient may enrol while still obtaining their prescription.';
comment on column public.weight_management_enrolments.obesity_assessment_id is
  'ON DELETE RESTRICT rather than SET NULL: the assessment is the clinical basis on which a doctor accepted this patient, and an enrolment that has lost its basis is worse than one that blocks a delete.';

create index weight_management_enrolments_patient_idx
  on public.weight_management_enrolments (patient_id, status);
create unique index weight_management_enrolments_one_live_per_patient
  on public.weight_management_enrolments (patient_id)
  where status in ('pending_eligibility', 'active', 'paused');

-- ---------------------------------------------------------------------------
-- 3. Dose plan and check-ins
-- ---------------------------------------------------------------------------

create table public.weight_management_dose_steps (
  id             uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete cascade,
  enrolment_id   uuid not null references public.weight_management_enrolments(id) on delete cascade,
  step_number    integer not null,
  dose_label     text not null,
  planned_from   date not null,
  agreed_by      uuid references public.profiles(id) on delete restrict,
  agreed_at      timestamptz,
  reached_at     timestamptz,
  held_reason    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (enrolment_id, step_number)
);

comment on table public.weight_management_dose_steps is
  'The escalation plan a doctor agreed with the patient. dose_label is free text rather than a number with units because products differ (2.5mg tirzepatide is not comparable to 0.25mg semaglutide) and a shared numeric column would invite exactly the wrong comparison.';
comment on column public.weight_management_dose_steps.agreed_by is
  'The doctor who agreed this step. Null means planned but not yet clinically agreed, and the patient-facing view must say so rather than presenting it as a doctor''s instruction.';

create table public.weight_management_checkins (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations(id) on delete cascade,
  enrolment_id      uuid not null references public.weight_management_enrolments(id) on delete cascade,
  patient_id        uuid not null references public.profiles(id) on delete cascade,
  checked_in_at     timestamptz not null default now(),
  weight_kg         numeric(5,2),
  nausea            smallint check (nausea between 0 and 3),
  vomiting          smallint check (vomiting between 0 and 3),
  diarrhoea         smallint check (diarrhoea between 0 and 3),
  constipation      smallint check (constipation between 0 and 3),
  abdominal_pain    smallint check (abdominal_pain between 0 and 3),
  poor_oral_intake  boolean not null default false,
  red_flag_reported boolean not null default false,
  patient_note      text,
  reviewed_by       uuid references public.profiles(id) on delete restrict,
  reviewed_at       timestamptz,
  clinician_note    text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.weight_management_checkins is
  'Fortnightly tolerability check-in. Symptom scores are 0-3 (none / mild / moderate / severe). red_flag_reported covers the presentations that need a doctor the same day rather than at the next review -- severe persistent abdominal pain radiating to the back, which is how pancreatitis presents, and persistent vomiting with poor oral intake.';
comment on column public.weight_management_checkins.reviewed_by is
  'Null until a doctor has actually read it. Patient-facing UI must null-gate on this and never imply a review that has not happened -- the same rule as ReviewedByDoctor everywhere else on this platform.';

create index weight_management_checkins_enrolment_idx
  on public.weight_management_checkins (enrolment_id, checked_in_at desc);
create index weight_management_checkins_unreviewed_idx
  on public.weight_management_checkins (organisation_id, checked_in_at)
  where reviewed_at is null;

-- ---------------------------------------------------------------------------
-- 4. Supervision-only, enforced
-- ---------------------------------------------------------------------------

create or replace function private.enforce_weight_management_supervision_only()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_source public.medication_source;
  v_prescriber text;
begin
  if new.medication_id is null then
    if new.status = 'active' then
      raise exception 'An active supervision enrolment must reference the patient''s own medication.'
        using errcode = 'P0001', detail = 'WEIGHT_MANAGEMENT_MEDICATION_REQUIRED';
    end if;
    return new;
  end if;

  select m.source, m.prescriber_name into v_source, v_prescriber
    from public.medications m
   where m.id = new.medication_id and m.patient_id = new.patient_id;

  if v_source is null then
    raise exception 'That medication does not belong to this patient.'
      using errcode = 'P0001';
  end if;

  -- The load-bearing line. Tarragon supervises; it does not prescribe or
  -- supply. A medication recorded with source = 'clinician' is one this
  -- platform started, and supervising a course this platform started is a
  -- different product with a different regulatory position. Changing this
  -- must be a deliberate founder decision, not a refactor.
  if v_source <> 'patient' then
    raise exception 'Supervision covers medication the patient obtained themselves. This medication was recorded as %, not patient-supplied.', v_source
      using errcode = 'P0001', detail = 'WEIGHT_MANAGEMENT_SUPERVISION_ONLY';
  end if;

  if new.status = 'active' and coalesce(trim(v_prescriber), '') = '' then
    raise exception 'Record who prescribed the medication before starting supervision.'
      using errcode = 'P0001', detail = 'WEIGHT_MANAGEMENT_PRESCRIBER_REQUIRED';
  end if;

  return new;
end;
$function$;

create trigger weight_management_supervision_only
  before insert or update on public.weight_management_enrolments
  for each row execute function private.enforce_weight_management_supervision_only();

-- ---------------------------------------------------------------------------
-- 5. RLS
--
-- Written fresh rather than copied from a sibling table. Reads use the
-- category-scoped can_read_clinical overload under 'medications', which is what
-- gives a consented caregiver proxy access on the same terms as the rest of the
-- medication record; the one-argument legacy overload is deliberately not used.
-- Writes are narrower than reads on purpose: a proxy who may READ this record
-- may not enrol somebody in a medical programme on their behalf.
-- ---------------------------------------------------------------------------

alter table public.weight_management_enrolments enable row level security;
alter table public.weight_management_dose_steps enable row level security;
alter table public.weight_management_checkins   enable row level security;

create policy wm_enrolments_select on public.weight_management_enrolments
  for select to authenticated
  using (private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
         or private.is_org_staff(organisation_id));

create policy wm_enrolments_insert on public.weight_management_enrolments
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- Only clinical staff may move an enrolment on. A patient cannot mark
-- themselves eligible, agree their own dose plan, or reactivate a paused course.
create policy wm_enrolments_update on public.weight_management_enrolments
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy wm_dose_steps_select on public.weight_management_dose_steps
  for select to authenticated
  using (exists (
    select 1 from public.weight_management_enrolments e
     where e.id = enrolment_id
       and (private.can_read_clinical(e.patient_id, 'medications'::public.care_access_category)
            or private.is_org_staff(e.organisation_id))));

-- Agreeing a dose escalation is a prescribing-class act even though Tarragon
-- writes no prescription: it tells a patient to take more of a drug. Gated on
-- the same authority as amending a medication.
create policy wm_dose_steps_write on public.weight_management_dose_steps
  for all to authenticated
  using (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id))
  with check (private.is_org_staff(organisation_id) and private.has_prescribing_authority(organisation_id));

create policy wm_checkins_select on public.weight_management_checkins
  for select to authenticated
  using (private.can_read_clinical(patient_id, 'medications'::public.care_access_category)
         or private.is_org_staff(organisation_id));

create policy wm_checkins_insert on public.weight_management_checkins
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

create policy wm_checkins_update on public.weight_management_checkins
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

-- RLS restricts rows; it does not grant table access. A table created by a
-- plain migration needs its own grant.
grant select, insert, update on public.weight_management_enrolments to authenticated;
grant select, insert, update on public.weight_management_dose_steps to authenticated;
grant select, insert, update on public.weight_management_checkins   to authenticated;
revoke delete on public.weight_management_enrolments from authenticated;
revoke delete on public.weight_management_dose_steps from authenticated;
revoke delete on public.weight_management_checkins   from authenticated;

create trigger wm_enrolments_set_updated_at before update on public.weight_management_enrolments
  for each row execute function private.set_updated_at();
create trigger wm_dose_steps_set_updated_at before update on public.weight_management_dose_steps
  for each row execute function private.set_updated_at();
create trigger wm_checkins_set_updated_at before update on public.weight_management_checkins
  for each row execute function private.set_updated_at();

create trigger audit_row_change_trg after insert or update or delete
  on public.weight_management_enrolments for each row execute function private.audit_row_change();
create trigger audit_row_change_trg after insert or update or delete
  on public.weight_management_dose_steps for each row execute function private.audit_row_change();

-- ---------------------------------------------------------------------------
-- 6. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_products int;
  v_blocked  boolean := false;
  v_patient  uuid;
  v_org      uuid;
  v_med      uuid;
begin
  select count(*) into v_products
    from public.service_products
   where code like 'weight\_management\_%' and is_active
     and 'weight_management_supervised' = any(features);
  if v_products <> 3 then
    raise exception 'FAIL: expected 3 active Supervised Weight Management products, found %', v_products;
  end if;

  if not has_table_privilege('authenticated', 'public.weight_management_enrolments', 'SELECT') then
    raise exception 'FAIL: authenticated cannot SELECT weight_management_enrolments';
  end if;

  -- Prove the supervision-only trigger actually refuses a Tarragon-prescribed
  -- medication, rather than merely existing. Rolled back by raising.
  select id, organisation_id into v_patient, v_org from public.profiles where role = 'patient' limit 1;
  if v_patient is not null then
    begin
      insert into public.medications (organisation_id, patient_id, drug_name, source, is_active)
      values (v_org, v_patient, 'ZZ supervision probe', 'clinician', true)
      returning id into v_med;

      begin
        insert into public.weight_management_enrolments
          (organisation_id, patient_id, medication_id, term_days, status)
        values (v_org, v_patient, v_med, 90, 'pending_eligibility');
      exception when others then
        if sqlerrm like '%patient obtained themselves%' then
          v_blocked := true;
        else
          raise;
        end if;
      end;

      raise exception 'ROLLBACK_PROBE';
    exception when others then
      if sqlerrm <> 'ROLLBACK_PROBE' then raise; end if;
    end;

    if not v_blocked then
      raise exception 'FAIL: a clinician-sourced medication was accepted for supervision. The supervision-only rule is not enforced.';
    end if;
    raise notice 'PASS: supervision-only refused a Tarragon-prescribed medication';
  else
    raise notice 'SKIP: no patient row to prove the supervision-only trigger against';
  end if;

  raise notice 'PASS: Supervised Weight Management live at 75,000 / 132,000 / 240,000 for 3 / 6 / 12 months';
end $$;

commit;

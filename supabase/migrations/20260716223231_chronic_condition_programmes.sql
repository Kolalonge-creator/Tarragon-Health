-- Tarragon Health — Chronic Disease Programme catalogue, step 2/4
--
-- chronic_condition_programmes: the single source of truth for *which* chronic
-- conditions the platform offers, and — critically — which are LIVE right now.
-- Same shape/ownership as preventive_programmes / screen_types: a global
-- reference catalogue (no organisation_id), authenticated read of active rows,
-- platform-admin (private.is_admin) write.
--
-- Config, not code: the founder's phased rollout ("launch with hypertension +
-- diabetes; activate asthma / COPD / heart failure / CKD / obesity once we have
-- thousands of subscribers and proven transactions") is a row-level is_active
-- toggle flipped in /admin/settings/conditions — no redeploy. All 7 conditions
-- are seeded here; every one ships is_active = false and can only be switched
-- on once a Clinical Director has signed its WHO-based protocol (enforced by the
-- trigger below), so no condition ever goes live without a real, auditable
-- protocol_versions record behind it (docs/CLINICAL_TRUST_MODEL_SPEC.md §1/§4).

create table if not exists public.chronic_condition_programmes (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  -- Maps to the care_plans storage enum, so an enrolment can spawn a care_plan.
  condition             public.care_plan_condition not null unique,
  name                  text not null,
  short_description     text,
  category              text not null default 'chronic',
  -- Vitals the programme's monitoring protocol tracks (for dashboards / reminders).
  monitoring_vitals     public.vital_type[] not null default '{}',
  -- Periodic clinical-review cadence in months (mirrors medication_review_cadences).
  review_cadence_months integer not null default 6 check (review_cadence_months > 0),
  -- Stable slug tying this programme to its WHO protocol + signed protocol_versions.
  protocol_slug         text not null unique,
  -- 1 = launch cohort (hypertension, diabetes); 2 = phased-in later. Display/ordering only.
  launch_priority       integer not null default 2,
  -- The live gate. false until a Clinical Director signs the protocol AND an
  -- admin flips it on. Only active rows are visible to patients / clinicians.
  is_active             boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists chronic_condition_programmes_active_idx
  on public.chronic_condition_programmes (is_active, launch_priority);

drop trigger if exists chronic_condition_programmes_set_updated_at on public.chronic_condition_programmes;
create trigger chronic_condition_programmes_set_updated_at
  before update on public.chronic_condition_programmes
  for each row execute function private.set_updated_at();

-- --- activation gate ---------------------------------------------------------
-- A condition may only become is_active = true when a signed protocol version
-- exists for its protocol_slug. Same structural-gate pattern as the indemnity /
-- prescribing-authority triggers: the DB refuses the state transition rather
-- than trusting the app layer. Deactivation (true -> false) is always allowed.
create or replace function private.enforce_chronic_programme_protocol_signed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_active and (tg_op = 'INSERT' or not old.is_active) then
    if not exists (
      select 1 from public.protocol_versions pv
      where pv.protocol_id = new.protocol_slug
    ) then
      raise exception
        'Cannot activate chronic condition "%": no signed protocol version exists for protocol "%". A Clinical Director must sign the protocol first.',
        new.code, new.protocol_slug
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists chronic_condition_programmes_protocol_gate on public.chronic_condition_programmes;
create trigger chronic_condition_programmes_protocol_gate
  before insert or update on public.chronic_condition_programmes
  for each row execute function private.enforce_chronic_programme_protocol_signed();

-- --- RLS ---------------------------------------------------------------------
alter table public.chronic_condition_programmes enable row level security;

-- Any authenticated user reads active programmes; admins read all (so the
-- admin console can see dormant rows to activate them).
drop policy if exists chronic_condition_programmes_select on public.chronic_condition_programmes;
create policy chronic_condition_programmes_select on public.chronic_condition_programmes
  for select to authenticated
  using (is_active or private.is_admin());

drop policy if exists chronic_condition_programmes_insert on public.chronic_condition_programmes;
create policy chronic_condition_programmes_insert on public.chronic_condition_programmes
  for insert to authenticated
  with check (private.is_admin());

drop policy if exists chronic_condition_programmes_update on public.chronic_condition_programmes;
create policy chronic_condition_programmes_update on public.chronic_condition_programmes
  for update to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update on public.chronic_condition_programmes to authenticated;

-- --- seed: all 7 conditions, all dormant (is_active = false) ------------------
insert into public.chronic_condition_programmes
  (code, condition, name, short_description, category, monitoring_vitals,
   review_cadence_months, protocol_slug, launch_priority)
values
  ('hypertension', 'hypertension', 'Hypertension',
   'Blood-pressure control, cardiovascular-risk reduction and long-term follow-up.',
   'cardiometabolic', array['blood_pressure','pulse']::public.vital_type[],
   6, 'chronic_hypertension_who', 1),
  ('diabetes', 'diabetes', 'Diabetes (Type 2)',
   'Glycaemic control, complication screening and structured review.',
   'cardiometabolic', array['glucose','weight','blood_pressure']::public.vital_type[],
   3, 'chronic_diabetes_who', 1),
  ('asthma', 'asthma', 'Asthma',
   'Symptom control, inhaler technique and exacerbation prevention.',
   'respiratory', array['spo2','pulse']::public.vital_type[],
   6, 'chronic_asthma_who', 2),
  ('copd', 'copd', 'COPD',
   'Airflow-limitation management, exacerbation reduction and pulmonary support.',
   'respiratory', array['spo2','pulse']::public.vital_type[],
   6, 'chronic_copd_who', 2),
  ('heart_failure', 'heart_failure', 'Heart Failure',
   'Fluid-status monitoring, guideline medical therapy and decompensation watch.',
   'cardiometabolic', array['blood_pressure','weight','pulse']::public.vital_type[],
   3, 'chronic_heart_failure_who', 2),
  ('ckd', 'ckd', 'Chronic Kidney Disease',
   'Renal-function monitoring, BP and metabolic control, progression slowing.',
   'renal', array['blood_pressure']::public.vital_type[],
   3, 'chronic_ckd_who', 2),
  ('obesity', 'obesity', 'Obesity / Weight Management',
   'Weight and metabolic-risk management with lifestyle and clinical support.',
   'metabolic', array['weight','blood_pressure']::public.vital_type[],
   6, 'chronic_obesity_who', 2)
on conflict (code) do nothing;

-- --- backfill review cadences for the three newly-added conditions ----------
insert into public.medication_review_cadences (condition, interval_months) values
  ('asthma', 6),
  ('copd', 6),
  ('heart_failure', 3)
on conflict (condition) do update set interval_months = excluded.interval_months;

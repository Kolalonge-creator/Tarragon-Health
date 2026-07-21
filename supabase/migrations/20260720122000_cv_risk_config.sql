-- Tarragon Health — Cholesterol / lipid management as a CV-risk module
-- Phase 3 (Risk scoring + escalation): the config, the secondary-prevention
-- flag, the Medical-Director sign-off, and the chronic periodic-lipid
-- schedule. The stratification LOGIC is a TypeScript rule engine
-- (lib/rules/cv-risk.ts) — this migration is its data foundation.
--
-- GUARDRAIL: every numeric threshold, LDL/Non-HDL target and statin-
-- eligibility rule lives in cv_risk_config.config (jsonb), NOT in code, so the
-- Medical Director sets and signs the final clinical values before go-live.
-- The seeded row is an UNSIGNED provisional draft (approved_by null,
-- is_active false); the engine treats unsigned config as "provisional,
-- awaiting Medical-Director sign-off" and labels it as such. Signing is a
-- forge-proof, director-only action via public.sign_cv_risk_config().
--
-- The seeded values are guideline-informed defaults for review, NOT
-- regulator-approved and NOT final — the Medical Director confirms them.

-- ---------------------------------------------------------------------------
-- cv_risk_config — versioned, signable clinical parameters (org-scoped,
-- mirrors the protocol_versions signing model).
-- ---------------------------------------------------------------------------
create table public.cv_risk_config (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  version           integer not null,
  config            jsonb not null,
  notes             text,
  -- approved_by references clinical_staff (a named, credentialed record),
  -- not profiles — same provenance rule as protocol_versions. Null until signed.
  approved_by       uuid references public.clinical_staff (id) on delete restrict,
  approved_at       timestamptz,
  is_active         boolean not null default false,
  created_at        timestamptz not null default now(),
  -- A row can only be active once a Clinical Director has signed it.
  constraint cv_risk_config_active_requires_signature
    check (not is_active or (approved_by is not null and approved_at is not null)),
  unique (organisation_id, version)
);

create unique index cv_risk_config_one_active
  on public.cv_risk_config (organisation_id) where is_active;
create index cv_risk_config_org_idx on public.cv_risk_config (organisation_id);

alter table public.cv_risk_config enable row level security;

-- Any authenticated user may READ the config (the engine + the patient/
-- clinician UI need it). Only org staff may create DRAFTS, and only as
-- unsigned/inactive — signing is exclusively via sign_cv_risk_config(), so a
-- direct insert can never forge a signature or self-activate.
create policy cv_risk_config_select on public.cv_risk_config
  for select to authenticated
  using (true);

create policy cv_risk_config_insert on public.cv_risk_config
  for insert to authenticated
  with check (
    private.is_org_staff(organisation_id)
    and approved_by is null
    and approved_at is null
    and is_active = false
  );
-- No update/delete policy: values are immutable once written; a change means a
-- new version. Activation/signing flips is_active via the SECURITY DEFINER RPC.

grant select, insert on public.cv_risk_config to authenticated;

-- Seed one UNSIGNED provisional draft per existing organisation.
insert into public.cv_risk_config (organisation_id, version, config, notes)
select o.id, 1,
  jsonb_build_object(
    'unit', 'mg/dL',
    'population_note',
      '10-year CVD risk is estimated with SCORE2 (European-derived) and is not validated for Sub-Saharan African populations; treat it as a guide and confirm clinically.',
    'targets_mg_dl', jsonb_build_object(
      'secondary',        jsonb_build_object('ldl_max', 70,  'non_hdl_max', 100),
      'primary_high',     jsonb_build_object('ldl_max', 100, 'non_hdl_max', 130),
      'primary_standard', jsonb_build_object('ldl_max', 116, 'non_hdl_max', 145)
    ),
    'statin_eligibility', jsonb_build_object(
      'secondary_recommend', true,
      'diabetes_min_age', 40,
      'primary_10yr_risk_pct', 10
    ),
    'escalation_mg_dl', jsonb_build_object(
      'very_high_ldl', 190,
      'very_high_non_hdl', 220,
      'worsening_trend_pct', 10
    ),
    'chronic_lipid_monitoring_months', 6
  ),
  'Provisional guideline defaults seeded for Medical-Director review. NOT final, NOT regulator-approved — sign to bring into force.'
from public.organisations o
on conflict (organisation_id, version) do nothing;

-- ---------------------------------------------------------------------------
-- sign_cv_risk_config — the Medical Director's forge-proof sign-off.
-- ---------------------------------------------------------------------------
create or replace function public.sign_cv_risk_config(p_config_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_staff uuid;
begin
  select organisation_id into v_org from public.cv_risk_config where id = p_config_id;
  if v_org is null then
    raise exception 'CV-risk configuration not found';
  end if;

  -- Caller must be an ACTIVE Clinical Director in this config's organisation.
  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_org
    and cs.active
    and cs.is_clinical_director
  limit 1;

  if v_staff is null then
    raise exception 'not authorised: only an active Clinical Director can sign the CV-risk configuration';
  end if;

  -- One active per org: retire any currently-active row, then sign this one.
  update public.cv_risk_config set is_active = false
    where organisation_id = v_org and is_active and id <> p_config_id;

  update public.cv_risk_config
    set approved_by = v_staff, approved_at = now(), is_active = true
    where id = p_config_id;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values
    (v_org, (select auth.uid()), 'cv_risk_config.signed', 'cv_risk_config', p_config_id,
     jsonb_build_object('signed_by_clinical_staff', v_staff));

  return p_config_id;
end $$;

revoke all on function public.sign_cv_risk_config(uuid) from public;
revoke all on function public.sign_cv_risk_config(uuid) from anon;
grant execute on function public.sign_cv_risk_config(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- patient_cardiovascular_profile — the structured secondary-prevention flag.
-- Clinician-authored (a clinical judgement), never patient self-asserted, so
-- the primary/secondary-prevention split is a real record, not a guess.
-- ---------------------------------------------------------------------------
create table public.patient_cardiovascular_profile (
  id                             uuid primary key default gen_random_uuid(),
  organisation_id                uuid not null references public.organisations (id) on delete restrict,
  patient_id                     uuid not null references public.profiles (id) on delete cascade,
  established_ascvd              boolean not null default false,
  prior_mi                       boolean not null default false,
  prior_stroke_tia               boolean not null default false,
  prior_pad                      boolean not null default false,
  prior_revascularisation        boolean not null default false,
  familial_hypercholesterolaemia boolean not null default false,
  recorded_by                    uuid references public.clinical_staff (id) on delete set null,
  notes                          text,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now(),
  unique (patient_id)
);

create index patient_cardiovascular_profile_org_idx
  on public.patient_cardiovascular_profile (organisation_id);

create trigger patient_cardiovascular_profile_set_updated_at
  before update on public.patient_cardiovascular_profile
  for each row execute function private.set_updated_at();

alter table public.patient_cardiovascular_profile enable row level security;

-- Patient reads own; a consent-granted profile_access grantee reads it (family
-- dashboard); org staff read + write. Only staff write — it is a clinical flag.
create policy patient_cardiovascular_profile_select on public.patient_cardiovascular_profile
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = patient_cardiovascular_profile.patient_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

create policy patient_cardiovascular_profile_insert on public.patient_cardiovascular_profile
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy patient_cardiovascular_profile_update on public.patient_cardiovascular_profile
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.patient_cardiovascular_profile to authenticated;

-- ---------------------------------------------------------------------------
-- Chronic periodic-lipid schedule: activating a hypertension / diabetes /
-- cardiovascular care plan ensures the patient has a pending lipid panel on
-- the screening calendar, at the config-driven cadence (default 6 months).
-- This is the "quarterly/biannual blood-test schedule" for lipids — it reuses
-- the existing screening_schedules + reminder machinery, no new scheduler.
-- ---------------------------------------------------------------------------
create or replace function private.ensure_chronic_lipid_schedule()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lipid_screen uuid;
  v_months integer;
begin
  if new.status <> 'active'
     or new.condition not in ('hypertension', 'diabetes', 'cardiovascular') then
    return new;
  end if;

  select id into v_lipid_screen
  from public.screen_types where code = 'lipid_panel' limit 1;
  if v_lipid_screen is null then
    return new; -- lipid screen type not present; nothing to schedule
  end if;

  -- Skip if the patient already has an open lipid schedule.
  if exists (
    select 1 from public.screening_schedules ss
    where ss.patient_id = new.patient_id
      and ss.screen_type_id = v_lipid_screen
      and ss.status in ('pending', 'booked', 'overdue')
  ) then
    return new;
  end if;

  select coalesce((c.config ->> 'chronic_lipid_monitoring_months')::int, 6)
    into v_months
  from public.cv_risk_config c
  where c.organisation_id = new.organisation_id and c.is_active
  limit 1;
  v_months := coalesce(v_months, 6);

  insert into public.screening_schedules
    (organisation_id, patient_id, screen_type_id, status, due_date)
  values
    (new.organisation_id, new.patient_id, v_lipid_screen, 'pending',
     current_date + (v_months || ' months')::interval);

  return new;
end $$;

drop trigger if exists care_plans_ensure_lipid_schedule on public.care_plans;
create trigger care_plans_ensure_lipid_schedule
  after insert or update of status on public.care_plans
  for each row execute function private.ensure_chronic_lipid_schedule();

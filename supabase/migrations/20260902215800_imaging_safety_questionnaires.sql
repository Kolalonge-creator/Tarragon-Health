-- Tarragon Health — Imaging & Diagnostic Procedure Platform, part 4/9:
-- pre-procedure safety questionnaire (spec §59.6).
--
-- "The exact questions depend on the investigation" is taken literally: this
-- table does not hardcode a pregnancy/implants/allergies/renal/contrast
-- column set (an X-ray needs almost none of that, an MRI needs the implant
-- questions, a contrast CT needs the renal-function questions). Instead
-- `questions` snapshots the actual question set asked (versioned by
-- `template_key`, e.g. 'mri_safety_v1', 'ct_contrast_v1' -- see
-- imaging_studies.default_safety_questionnaire_key from part 2) and
-- `answers` holds what the patient/staff actually answered. Interpreting
-- the answers into has_contraindication is app-layer logic (the template's
-- own scoring rules), matching the general principle that clinical-content
-- rules belong in versioned, reviewable app/config code, not baked into a
-- migration -- the DB's job here is safe storage + the review/alert loop,
-- not re-implementing per-modality clinical logic in SQL.
--
-- A flagged contraindication raises a clinician_review alert immediately
-- (same "flag for a human, never block silently" posture as
-- ecg_report_documents) -- a positive screen must reach a clinician before
-- the order proceeds to scheduling, but the DB does not itself refuse to
-- schedule; a human decides what to do with a flagged questionnaire.

create table public.imaging_safety_questionnaires (
  id                   uuid primary key default gen_random_uuid(),
  organisation_id      uuid not null references public.organisations (id) on delete restrict,
  patient_id           uuid not null references public.profiles (id) on delete cascade,
  imaging_order_id     uuid not null unique references public.imaging_orders (id) on delete cascade,
  template_key         text not null,
  questions            jsonb not null default '[]'::jsonb,
  answers              jsonb not null default '{}'::jsonb,
  has_contraindication boolean not null default false,
  contraindication_notes text,
  completed_by         uuid references public.profiles (id) on delete restrict,
  completed_at         timestamptz,
  reviewed_by          uuid references public.clinical_staff (id) on delete restrict,
  reviewed_at          timestamptz,
  clinician_alert_id   uuid references public.clinician_alerts (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint imaging_safety_questionnaires_contraindication_requires_notes
    check (not has_contraindication or contraindication_notes is not null)
);

create index imaging_safety_questionnaires_order_idx on public.imaging_safety_questionnaires (imaging_order_id);
create index imaging_safety_questionnaires_flagged_idx
  on public.imaging_safety_questionnaires (organisation_id, created_at)
  where has_contraindication and reviewed_at is null;

create trigger imaging_safety_questionnaires_set_updated_at
  before update on public.imaging_safety_questionnaires
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS -- patient completes their own order's questionnaire; org staff may
-- complete/review any of their org's.
-- ---------------------------------------------------------------------------
alter table public.imaging_safety_questionnaires enable row level security;

create policy imaging_safety_questionnaires_select on public.imaging_safety_questionnaires
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_safety_questionnaires_insert on public.imaging_safety_questionnaires
  for insert to authenticated
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy imaging_safety_questionnaires_update on public.imaging_safety_questionnaires
  for update to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id))
  with check (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

grant select, insert, update on public.imaging_safety_questionnaires to authenticated;

-- ---------------------------------------------------------------------------
-- BEFORE INSERT/UPDATE: server-derive completed_by, raise an alert on a
-- newly-flagged contraindication, freeze the review stamp.
-- ---------------------------------------------------------------------------
create or replace function private.handle_imaging_safety_questionnaire()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_order_org uuid;
  v_order_patient uuid;
begin
  select organisation_id, patient_id into v_order_org, v_order_patient
  from public.imaging_orders where id = new.imaging_order_id;

  if v_order_org is null then
    raise exception 'imaging_orders row % not found', new.imaging_order_id;
  end if;

  if tg_op = 'INSERT' then
    -- Raising here (rather than silently overwriting a caller-supplied
    -- mismatch) means this check does not depend on whether RLS evaluates
    -- WITH CHECK before or after this BEFORE trigger runs -- a mismatched
    -- organisation_id/patient_id always aborts the whole insert.
    if new.organisation_id is not null and new.organisation_id <> v_order_org then
      raise exception 'imaging_safety_questionnaires.organisation_id must match the referenced imaging_orders row';
    end if;
    if new.patient_id is not null and new.patient_id <> v_order_patient then
      raise exception 'imaging_safety_questionnaires.patient_id must match the referenced imaging_orders row';
    end if;
    new.organisation_id := v_order_org;
    new.patient_id := v_order_patient;
    if new.completed_at is not null then
      new.completed_by := coalesce((select auth.uid()), new.completed_by);
    end if;
    new.reviewed_by := null;
    new.reviewed_at := null;
  else
    new.organisation_id := old.organisation_id;
    new.patient_id := old.patient_id;
    new.imaging_order_id := old.imaging_order_id;

    if new.completed_at is not null and old.completed_at is null then
      new.completed_by := coalesce((select auth.uid()), new.completed_by);
    elsif old.completed_at is not null then
      new.completed_by := old.completed_by;
      new.completed_at := old.completed_at;
    end if;

    if new.reviewed_at is not null and old.reviewed_at is null then
      select id into new.reviewed_by from public.clinical_staff
      where profile_id = (select auth.uid()) and organisation_id = new.organisation_id and active
      limit 1;
      new.reviewed_at := now();
    elsif old.reviewed_at is not null then
      new.reviewed_by := old.reviewed_by;
      new.reviewed_at := old.reviewed_at;
    end if;
  end if;

  if new.has_contraindication and (tg_op = 'INSERT' or new.has_contraindication is distinct from old.has_contraindication) then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, category, type_code, escalation_level)
    values (
      new.organisation_id, new.patient_id, 'clinician_review', 'open',
      'Imaging safety questionnaire flagged a contraindication',
      coalesce(new.contraindication_notes, 'A pre-procedure safety questionnaire flagged a possible contraindication -- review before the order proceeds.'),
      'clinical', 'abnormal_result', 2
    )
    returning id into v_alert_id;
    new.clinician_alert_id := v_alert_id;
  end if;

  return new;
end;
$$;

drop trigger if exists imaging_safety_questionnaires_on_write on public.imaging_safety_questionnaires;
create trigger imaging_safety_questionnaires_on_write
  before insert or update on public.imaging_safety_questionnaires
  for each row execute function private.handle_imaging_safety_questionnaire();

do $$
begin
  if not has_table_privilege('authenticated', 'public.imaging_safety_questionnaires', 'SELECT') then
    raise exception 'imaging_safety_questionnaires: authenticated SELECT grant did not take';
  end if;
  raise notice 'PASS: imaging_safety_questionnaires in place';
end $$;

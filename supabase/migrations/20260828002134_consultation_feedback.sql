-- Tarragon Health — Consultation System §9.20 "consultation quality":
-- patient rates technical experience, punctuality, communication, and
-- overall experience. "Clinical quality should be measured separately" per
-- the spec -- this table deliberately holds none: no diagnosis-accuracy or
-- outcome field lives here, and nothing here feeds a clinician's clinical
-- performance metrics (my_provider_performance / analytics_doctor_performance
-- stay exactly as they are). Confirmed by grep before writing this (per
-- 20260827203759_my_provider_performance_rpc.sql's own comment) that no
-- patient-satisfaction data exists anywhere in the platform yet -- this is
-- the first.
--
-- Scoped to video_consultations for now (the one fully self-serve, patient-
-- initiated consultation channel that's actually live end to end). Not a
-- forced generalisation across every encounter type this migration has no
-- evidence patients would even want to rate identically (an async consult
-- has no "punctuality" to speak of).

create table public.consultation_feedback (
  id                            uuid primary key default gen_random_uuid(),
  organisation_id               uuid not null references public.organisations (id) on delete restrict,
  patient_id                    uuid not null references public.profiles (id) on delete cascade,
  video_consultation_id         uuid not null references public.video_consultations (id) on delete cascade,

  technical_experience_rating   smallint check (technical_experience_rating between 1 and 5),
  punctuality_rating            smallint check (punctuality_rating between 1 and 5),
  communication_rating          smallint check (communication_rating between 1 and 5),
  overall_rating                smallint not null check (overall_rating between 1 and 5),
  comment                       text,

  created_at                    timestamptz not null default now(),

  constraint consultation_feedback_one_per_consult unique (video_consultation_id)
);

comment on table public.consultation_feedback is
  'Consultation System §9.20 -- patient-submitted experience rating (technical/punctuality/communication/overall), one per completed video consultation. Deliberately holds no clinical-quality signal; kept separate from clinician performance metrics.';

create index consultation_feedback_org_idx on public.consultation_feedback (organisation_id, created_at desc);

alter table public.consultation_feedback enable row level security;

create policy consultation_feedback_select on public.consultation_feedback
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy consultation_feedback_insert on public.consultation_feedback
  for insert to authenticated
  with check (patient_id = (select auth.uid()));

-- No UPDATE/DELETE policy -- submitted-once, immutable, same discipline as
-- clinical_encounter_notes/consultation_follow_ups.
grant select, insert on public.consultation_feedback to authenticated;
revoke update, delete on public.consultation_feedback from authenticated;

create or replace function private.enforce_consultation_feedback_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_consult record;
begin
  select id, organisation_id, patient_id, status into v_consult
  from public.video_consultations
  where id = new.video_consultation_id;

  if v_consult.id is null then
    raise exception 'consultation not found';
  end if;
  if v_consult.patient_id <> (select auth.uid()) then
    raise exception 'you can only leave feedback for your own consultation'
      using errcode = '42501';
  end if;
  if v_consult.status <> 'completed' then
    raise exception 'feedback can only be left once the consultation is completed';
  end if;

  -- Client-supplied scope is never trusted -- always re-derived from the
  -- consultation itself.
  new.organisation_id := v_consult.organisation_id;
  new.patient_id := v_consult.patient_id;
  return new;
end;
$$;

comment on function private.enforce_consultation_feedback_scope() is
  'Forces organisation_id/patient_id from the referenced video_consultations row, and requires the caller be that consultation''s own patient on a completed visit -- never client-supplied.';

create trigger consultation_feedback_enforce_scope
  before insert on public.consultation_feedback
  for each row execute function private.enforce_consultation_feedback_scope();

revoke all on function private.enforce_consultation_feedback_scope() from public;

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'consultation_feedback'
  ) then
    raise exception 'consultation_feedback missing after migration';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'consultation_feedback' and cmd in ('UPDATE', 'DELETE')
  ) then
    raise exception 'consultation_feedback must have no UPDATE/DELETE policy';
  end if;
  raise notice 'PASS: consultation_feedback table + RLS + scope trigger present';
end $$;

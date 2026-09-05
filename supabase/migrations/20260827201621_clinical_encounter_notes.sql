-- Tarragon Health
-- Clinical Network build, Phase 1 item (docs/CLINICAL_NETWORK_SPEC.md §4.10
-- "Provider documentation"), founder-approved to build. Confirmed a genuine,
-- clean gap before writing this: no structured clinical-encounter/SOAP note
-- exists anywhere in the codebase. What exists instead are narrow free-text
-- fields bolted onto workflow tables (escalations.reason/resolution_note,
-- specialist_referrals.referral_reason/treatment_plan_note) and case_briefs
-- -- an AI-drafted, read-only, assistive summary with no write path back into
-- any clinical table, not documentation of record.
--
-- SCOPE: a real note a clinician writes and signs, covering reason for
-- encounter, history, examination, assessment, diagnosis, and plan (§4.10).
-- Deliberately NOT a parallel source of truth for medication/investigation/
-- referral decisions -- those stay exactly where they already live
-- (medications, lab_orders, specialist_referrals). The plan/diagnosis fields
-- here are the clinician's narrative account of an encounter, same
-- relationship escalations.resolution_note already has to the rest of the
-- record: a human-readable account alongside the transactional rows, never
-- instead of them.
--
-- Immutability model, same discipline as protocol_versions/case_review_actions
-- /clinical_incident_reports: a note starts as an editable 'draft' (author can
-- keep refining it) and becomes permanently locked once 'finalized' -- no
-- re-deciding a signed note, only a fresh note (an addendum) if something new
-- needs recording. Authorship AND the finalizing signature are both
-- server-derived from auth.uid(), never client-supplied -- the same
-- "Reviewed by Dr. X must be null-gated, never a hardcoded string" discipline
-- CLAUDE.md requires for every clinical attribution surface.
--
-- Authoring is gated to clinical tier (private.is_clinical_tier) from the
-- start, at both the RLS layer and the attribution trigger -- unlike
-- clinical_incident_reports (which deliberately admits a Care Coordinator to
-- FILE a near-miss report), writing a clinical assessment/diagnosis/plan is
-- itself a clinical act with no non-clinical carve-out.
--
-- video_consultation_id/async_consult_id/escalation_id are all optional and
-- independent -- a note may document a video visit, an async consult, an
-- escalation review, or a plain in-person/phone encounter with none of the
-- three set. No CHECK ties encounter_type to a specific link column:
-- forcing that coupling would be guessing at workflows this migration has no
-- evidence for.

create table public.clinical_encounter_notes (
  id                       uuid primary key default gen_random_uuid(),
  organisation_id          uuid not null references public.organisations (id) on delete cascade,
  patient_id               uuid not null references public.profiles (id) on delete cascade,

  video_consultation_id    uuid references public.video_consultations (id) on delete set null,
  async_consult_id         uuid references public.async_consults (id) on delete set null,
  escalation_id            uuid references public.escalations (id) on delete set null,

  encounter_type           text not null check (encounter_type in (
    'video_consult', 'async_consult', 'in_person', 'phone', 'escalation_review', 'other'
  )),
  encounter_date            timestamptz not null default now(),

  authored_by_staff        uuid references public.clinical_staff (id) on delete restrict,
  authored_by_profile      uuid references public.profiles (id) on delete restrict,

  reason_for_encounter     text not null check (length(btrim(reason_for_encounter)) > 0),
  history                  text,
  examination_findings     text,
  assessment               text,
  diagnosis                text,
  plan                     text,
  follow_up_instructions   text,

  status                   text not null default 'draft' check (status in ('draft', 'finalized')),
  finalized_by_staff       uuid references public.clinical_staff (id) on delete restrict,
  finalized_at             timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  constraint clinical_encounter_notes_finalized_requires_signoff check (
    status <> 'finalized'
    or (finalized_by_staff is not null and finalized_at is not null)
  ),
  constraint clinical_encounter_notes_draft_is_clean check (
    status <> 'draft'
    or (finalized_by_staff is null and finalized_at is null)
  )
);

comment on table public.clinical_encounter_notes is
  'A signed clinical encounter note (reason, history, examination, assessment, diagnosis, plan, follow-up) -- see docs/CLINICAL_NETWORK_SPEC.md §4.10. Not a parallel source of truth: medication/investigation/referral decisions stay in their own tables. A finalized note is immutable; authorship and the finalizing signature are both server-derived, never client-supplied.';
comment on column public.clinical_encounter_notes.plan is
  'Narrative account of the clinical plan in the author''s own words -- the actual medication/lab/referral orders this plan describes live in medications/lab_orders/specialist_referrals, not here.';

create index clinical_encounter_notes_patient_idx
  on public.clinical_encounter_notes (patient_id, encounter_date desc);
create index clinical_encounter_notes_org_idx
  on public.clinical_encounter_notes (organisation_id, encounter_date desc);
create index clinical_encounter_notes_video_consult_idx
  on public.clinical_encounter_notes (video_consultation_id) where video_consultation_id is not null;
create index clinical_encounter_notes_escalation_idx
  on public.clinical_encounter_notes (escalation_id) where escalation_id is not null;

alter table public.clinical_encounter_notes enable row level security;

create policy clinical_encounter_notes_select on public.clinical_encounter_notes
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy clinical_encounter_notes_insert on public.clinical_encounter_notes
  for insert to authenticated
  with check (private.is_clinical_tier(organisation_id));

create policy clinical_encounter_notes_update on public.clinical_encounter_notes
  for update to authenticated
  using (private.is_clinical_tier(organisation_id))
  with check (private.is_clinical_tier(organisation_id));

grant select, insert, update on public.clinical_encounter_notes to authenticated;
revoke delete on public.clinical_encounter_notes from authenticated;

create trigger clinical_encounter_notes_set_updated_at
  before update on public.clinical_encounter_notes
  for each row execute function private.set_updated_at();

create or replace function private.enforce_clinical_encounter_note_attribution()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff_id uuid;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = (select auth.uid())
    and organisation_id = new.organisation_id
    and active
    and (
      is_clinical_director
      or doctor_tier in ('tier_1', 'tier_2', 'tier_3', 'tier_4_senior_registrar', 'tier_5_partner_specialist')
    )
  limit 1;

  if v_staff_id is null then
    raise exception 'Only a clinical-tier member of the care team can write or finalize a clinical encounter note.'
      using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.authored_by_staff := v_staff_id;
    new.authored_by_profile := (select auth.uid());
    new.status := 'draft';
    new.finalized_by_staff := null;
    new.finalized_at := null;
    return new;
  end if;

  if old.status = 'finalized' then
    raise exception 'This encounter note is finalized and cannot be edited. Write a new note if something new needs recording.'
      using errcode = '42501';
  end if;

  new.authored_by_staff := old.authored_by_staff;
  new.authored_by_profile := old.authored_by_profile;

  if new.status = 'finalized' and old.status = 'draft' then
    new.finalized_by_staff := v_staff_id;
    new.finalized_at := now();
  end if;

  return new;
end;
$$;

comment on function private.enforce_clinical_encounter_note_attribution() is
  'INSERT: forces authored_by_staff/authored_by_profile/status server-side, requires the caller to be clinical-tier. UPDATE: blocks editing a finalized note, keeps authorship immutable, and server-stamps finalized_by_staff/finalized_at on the draft->finalized transition. Never client-supplied.';

create trigger clinical_encounter_notes_enforce_attribution
  before insert or update on public.clinical_encounter_notes
  for each row execute function private.enforce_clinical_encounter_note_attribution();

revoke all on function private.enforce_clinical_encounter_note_attribution() from public;

do $$
begin
  if not exists (
    select 1 from pg_tables where schemaname = 'public' and tablename = 'clinical_encounter_notes'
  ) then
    raise exception 'clinical_encounter_notes missing after migration';
  end if;

  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'clinical_encounter_notes' and cmd = 'DELETE'
  ) then
    raise exception 'clinical_encounter_notes must have no DELETE policy -- a written note is retained';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.clinical_encounter_notes'::regclass
      and tgname = 'clinical_encounter_notes_enforce_attribution'
      and not tgisinternal
  ) then
    raise exception 'clinical_encounter_notes attribution trigger missing';
  end if;

  if not has_table_privilege('authenticated', 'public.clinical_encounter_notes', 'INSERT') then
    raise exception 'authenticated lacks INSERT on clinical_encounter_notes';
  end if;
  if has_table_privilege('authenticated', 'public.clinical_encounter_notes', 'DELETE') then
    raise exception 'authenticated must not hold DELETE on clinical_encounter_notes';
  end if;

  raise notice 'PASS: clinical_encounter_notes table + RLS + attribution trigger present, no DELETE anywhere';
end $$;

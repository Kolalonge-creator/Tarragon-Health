-- Tarragon Health
-- 09b · escalations now assign to doctors, not clinicians; add
-- escalation_notes for repeatable call-note logging (FEATURE_SPEC
-- escalation review flow).
--
-- escalations.assigned_clinician_id -> assigned_doctor_id (reversing
-- migration 07's rename — that migration merged nurse into clinician and
-- renamed assigned_doctor_id -> assigned_clinician_id because there was no
-- separate doctor role at the time; now there is one (see
-- 20260709120000_add_doctor_role.sql), so escalations really are always
-- assigned to a doctor).

alter table public.escalations
  rename column assigned_clinician_id to assigned_doctor_id;
alter table public.escalations
  rename constraint escalations_assigned_clinician_id_fkey
  to escalations_assigned_doctor_id_fkey;
alter index escalations_assigned_clinician_idx rename to escalations_assigned_doctor_idx;

-- ---------------------------------------------------------------------------
-- escalation_notes: repeatable call-note log per escalation. organisation_id
-- is denormalised (every domain table has one) even though it's derivable
-- via escalation_id -> escalations.organisation_id, so RLS stays a single
-- indexed predicate, matching every other clinical table. Internal clinical
-- notes only — patients never see these.
-- ---------------------------------------------------------------------------

create table public.escalation_notes (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  escalation_id       uuid not null references public.escalations (id) on delete cascade,
  author_id           uuid references public.profiles (id) on delete set null,
  note                text not null,
  next_follow_up_at   timestamptz,
  created_at          timestamptz not null default now()
);

create index escalation_notes_escalation_idx on public.escalation_notes (escalation_id, created_at desc);
create index escalation_notes_org_idx on public.escalation_notes (organisation_id);
create index escalation_notes_author_idx on public.escalation_notes (author_id);

alter table public.escalation_notes enable row level security;

create policy escalation_notes_select on public.escalation_notes
  for select to authenticated
  using (private.is_org_staff(organisation_id));

create policy escalation_notes_insert on public.escalation_notes
  for insert to authenticated
  with check (private.is_org_staff(organisation_id));

create policy escalation_notes_update on public.escalation_notes
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

create policy escalation_notes_delete on public.escalation_notes
  for delete to authenticated
  using (private.is_org_staff(organisation_id));

grant select, insert, update, delete on public.escalation_notes to authenticated;

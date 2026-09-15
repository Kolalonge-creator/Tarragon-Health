-- Tarragon Health — Telemedicine Consultation Platform gap closure, part 2.
--
-- 68.17 patient summary. clinical_encounter_notes is deliberately staff-only
-- (its own migration's comment: "a curated patient-facing visit-summary
-- layer is a deliberate, separate product/clinical-review decision, not
-- attempted here; see patient_result_explanations for the equivalent
-- pattern on lab results"). This is that separate layer, following the same
-- pattern patient_result_explanations already established: a short,
-- clinician-authored, patient-safe curation — never an automatic dump of
-- the clinical note's own language, and never derived without a clinician
-- explicitly writing it.

create table public.consultation_patient_summaries (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  clinical_encounter_note_id  uuid not null references public.clinical_encounter_notes (id) on delete cascade,
  video_consultation_id       uuid references public.video_consultations (id) on delete set null,
  what_we_discussed           text not null,
  what_you_need_to_do         text,
  medicines_note              text,
  tests_note                  text,
  next_appointment_note       text,
  published_by_staff          uuid not null references public.clinical_staff (id) on delete restrict,
  created_at                  timestamptz not null default now(),

  unique (clinical_encounter_note_id)
);

comment on table public.consultation_patient_summaries is
  '68.17 — one curated, patient-facing recap per finalized clinical_encounter_notes row, in the "What we discussed / What you need to do / Medicines / Tests / Next appointment" shape the spec calls for. Immutable once published (no UPDATE policy) — same "signed record" discipline as the encounter note it summarizes; a correction is a new consultation the same way a new encounter note would be.';

create index consultation_patient_summaries_patient_idx on public.consultation_patient_summaries (patient_id, created_at desc);

alter table public.consultation_patient_summaries enable row level security;

create policy consultation_patient_summaries_select on public.consultation_patient_summaries
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

-- No direct INSERT/UPDATE/DELETE policy for anyone — publish_consultation_summary()
-- (security definer below) is the only write path, so authorship/linkage can
-- never be forged by a client-supplied insert.

grant select on public.consultation_patient_summaries to authenticated;
revoke insert, update, delete on public.consultation_patient_summaries from authenticated;
revoke all on public.consultation_patient_summaries from anon;

create or replace function public.publish_consultation_summary(
  p_clinical_encounter_note_id uuid,
  p_what_we_discussed text,
  p_what_you_need_to_do text default null,
  p_medicines_note text default null,
  p_tests_note text default null,
  p_next_appointment_note text default null
)
returns public.consultation_patient_summaries
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_note public.clinical_encounter_notes;
  v_staff_id uuid;
  v_summary public.consultation_patient_summaries;
begin
  select * into v_note from public.clinical_encounter_notes where id = p_clinical_encounter_note_id;
  if v_note.id is null then
    raise exception 'encounter note not found';
  end if;
  if v_note.status <> 'finalized' then
    raise exception 'the encounter note must be signed and finalized before a summary can be published for the patient';
  end if;
  if btrim(coalesce(p_what_we_discussed, '')) = '' then
    raise exception 'what_we_discussed is required';
  end if;

  select id into v_staff_id
  from public.clinical_staff
  where profile_id = v_uid and organisation_id = v_note.organisation_id and active
  limit 1;
  if v_staff_id is null or not private.is_clinical_tier(v_note.organisation_id) then
    raise exception 'only a clinical-tier member of the care team can publish a patient summary'
      using errcode = '42501';
  end if;

  insert into public.consultation_patient_summaries (
    organisation_id, patient_id, clinical_encounter_note_id, video_consultation_id,
    what_we_discussed, what_you_need_to_do, medicines_note, tests_note, next_appointment_note,
    published_by_staff
  ) values (
    v_note.organisation_id, v_note.patient_id, v_note.id, v_note.video_consultation_id,
    btrim(p_what_we_discussed), nullif(btrim(coalesce(p_what_you_need_to_do, '')), ''),
    nullif(btrim(coalesce(p_medicines_note, '')), ''), nullif(btrim(coalesce(p_tests_note, '')), ''),
    nullif(btrim(coalesce(p_next_appointment_note, '')), ''),
    v_staff_id
  )
  returning * into v_summary;

  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (
    v_note.organisation_id, v_note.patient_id, 'in_app', 'pending', 'consultation_summary_ready',
    jsonb_build_object('summary_id', v_summary.id, 'clinical_encounter_note_id', v_note.id),
    'clinical'
  );

  return v_summary;
end;
$$;

comment on function public.publish_consultation_summary(uuid, text, text, text, text, text) is
  '68.17 — the only write path onto consultation_patient_summaries. Requires the source encounter note to already be signed/finalized (clinical_encounter_notes_enforce_attribution already guarantees that note''s own authorship), and the caller to be clinical-tier in that note''s org — same authority floor as clinical_encounter_notes itself. One summary per note (unique constraint), so this is publish-once; a correction is a new consultation with its own note and summary, matching the encounter note''s own "no re-deciding a finalized note" discipline.';

revoke execute on function public.publish_consultation_summary(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.publish_consultation_summary(uuid, text, text, text, text, text) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.publish_consultation_summary(uuid, text, text, text, text, text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute publish_consultation_summary';
  end if;
  if has_table_privilege('anon', 'public.consultation_patient_summaries', 'SELECT') then
    raise exception 'FAIL: anon can select consultation_patient_summaries';
  end if;
  raise notice 'PASS: consultation_patient_summaries in place, publish_consultation_summary is the only write path, anon denied';
end $$;

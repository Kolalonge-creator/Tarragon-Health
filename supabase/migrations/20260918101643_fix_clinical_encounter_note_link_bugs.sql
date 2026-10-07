-- Tarragon Health
-- Fixes 3 real bugs in the same session's prior migration
-- (20260918100746_clinical_encounter_notes_link_unified_encounter.sql),
-- caught by /code-review high before opening a PR -- not pre-existing
-- issues, and verified live (reproduced each error directly against
-- koiplnmbgnqnbywhpjlf before writing this fix).
--
-- BUG 1 (CRITICAL, confirmed live): private.sync_clinical_encounter_note_link()
-- used `row('video_consultations', new.video_consultation_id)` inside a CASE
-- whose other branch is a bare `else null` -- Postgres cannot unify an
-- untyped string literal inside a row() constructor against a CASE branch
-- typed only by inference, and raises "cannot compare dissimilar column
-- types text and unknown at record column 1" on EVERY insert/update that
-- sets any of the three link columns. Verified: `update
-- clinical_encounter_notes set escalation_id = escalation_id ...` reproduced
-- this exact error live. Every real note-authoring flow this table exists
-- for (video_consult/escalation_review/async_consult) would have hit this.
-- Fixed by casting each literal explicitly (`'video_consultations'::text`),
-- which resolves the type ambiguity.
--
-- BUG 2 (confirmed live, HIGH): async_consults has TWO AFTER UPDATE triggers
-- -- async_consults_auto_draft_encounter_note (20260917031004, inserts a
-- clinical_encounter_notes row) and clinical_encounters_sync_async_consult
-- (20260918091341, upserts the clinical_encounters row that note's link is
-- supposed to resolve against). Postgres fires same-event triggers in
-- alphabetical name order: 'async_consults_auto_draft...' < 'clinical_
-- encounters_sync...', so the note is created BEFORE its clinical_encounters
-- row exists, and clinical_encounter_id resolves to NULL permanently --
-- nothing ever revisits it. (video_consultations/escalations don't have this
-- bug: their sync trigger names sort before their own auto-draft trigger
-- names.) Rather than depending on trigger-name alphabetics across two
-- unrelated migrations (fragile and already wrong once), this is fixed at
-- the other end: each of the 3 relevant clinical_encounters sync trigger
-- functions (video_consultation/escalation/async_consult) now ALSO fixes up
-- any already-existing clinical_encounter_notes row still missing its link,
-- after upserting its own clinical_encounters row. Combined with BUG 1's fix
-- (the note-side trigger, which still resolves the link correctly when the
-- clinical_encounters row already exists), the link now resolves correctly
-- regardless of which of the two triggers on the source table happens to
-- fire first in a given transaction.
--
-- BUG 3: clinical_encounter_notes.clinical_encounter_id's own comment claims
-- "never client-supplied", but the sync trigger was column-scoped to fire
-- only on `update of video_consultation_id, escalation_id, async_consult_id`
-- -- an UPDATE that sets ONLY clinical_encounter_id (exactly the shape this
-- table's own backfill statement used) never invoked it, and the table's
-- existing UPDATE RLS policy/grant admit any clinical-tier staff member in
-- the row's org to write it directly, to any UUID in clinical_encounters
-- (which carries no per-organisation restriction on its own). Fixed by
-- dropping the column scope -- the trigger now fires on every insert/update
-- (matching the pre-existing attribution trigger's own scope) and always
-- recomputes clinical_encounter_id server-side, discarding whatever the
-- client sent.

create or replace function private.sync_clinical_encounter_note_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.clinical_encounter_id := (
    select id from public.clinical_encounters
    where (source_table, source_id) = (
      case
        when new.video_consultation_id is not null then row('video_consultations'::text, new.video_consultation_id)
        when new.escalation_id is not null then row('escalations'::text, new.escalation_id)
        when new.async_consult_id is not null then row('async_consults'::text, new.async_consult_id)
        else null
      end
    )
    limit 1
  );
  return new;
end;
$$;

drop trigger if exists clinical_encounter_notes_sync_encounter_link on public.clinical_encounter_notes;

-- No longer column-scoped (see BUG 3 above) -- fires on every insert/update,
-- same scope as clinical_encounter_notes_enforce_attribution, and always
-- re-derives clinical_encounter_id rather than trusting any client-supplied
-- value for it.
create trigger clinical_encounter_notes_sync_encounter_link
  before insert or update on public.clinical_encounter_notes
  for each row execute function private.sync_clinical_encounter_note_link();

create or replace function private.sync_clinical_encounter_video_consultation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encounter_id uuid;
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'video_consultation', 'video_consultations', new.id,
     coalesce(new.scheduled_at, new.created_at), new.status::text, new.initiated_by, null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now()
  returning id into v_encounter_id;

  -- Fixes up any clinical_encounter_note that was inserted (by
  -- video_consultations_auto_draft_encounter_note or otherwise) before this
  -- clinical_encounters row existed -- see BUG 2 above.
  update public.clinical_encounter_notes
  set clinical_encounter_id = v_encounter_id
  where video_consultation_id = new.id and clinical_encounter_id is distinct from v_encounter_id;

  return new;
end;
$$;

create or replace function private.sync_clinical_encounter_escalation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encounter_id uuid;
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'escalation', 'escalations', new.id,
     new.created_at, new.status::text, coalesce(new.reviewed_by, new.assigned_doctor_id), null)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now()
  returning id into v_encounter_id;

  update public.clinical_encounter_notes
  set clinical_encounter_id = v_encounter_id
  where escalation_id = new.id and clinical_encounter_id is distinct from v_encounter_id;

  return new;
end;
$$;

create or replace function private.sync_clinical_encounter_async_consult()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_encounter_id uuid;
begin
  insert into public.clinical_encounters
    (organisation_id, patient_id, encounter_type, source_table, source_id, occurred_at, status_label, actor_profile_id, actor_clinical_staff_id)
  values
    (new.organisation_id, new.patient_id, 'async_consult', 'async_consults', new.id,
     new.created_at, new.status::text, null, new.answered_by)
  on conflict (source_table, source_id) do update set
    organisation_id = excluded.organisation_id,
    patient_id = excluded.patient_id,
    occurred_at = excluded.occurred_at,
    status_label = excluded.status_label,
    actor_profile_id = excluded.actor_profile_id,
    actor_clinical_staff_id = excluded.actor_clinical_staff_id,
    updated_at = now()
  returning id into v_encounter_id;

  update public.clinical_encounter_notes
  set clinical_encounter_id = v_encounter_id
  where async_consult_id = new.id and clinical_encounter_id is distinct from v_encounter_id;

  return new;
end;
$$;

do $$
declare
  v_note_id uuid;
  v_before uuid;
  v_after uuid;
begin
  -- Regression proof for BUG 1: the exact update that reproduced the crash
  -- live before this fix must now succeed. Disable the attribution trigger
  -- for this proof only (same justification as the introducing migration's
  -- own backfill -- system-level verification, not a clinical act), and
  -- restore it in a nested block so a failure here still leaves the
  -- attribution trigger enabled.
  select id into v_note_id from public.clinical_encounter_notes where escalation_id is not null limit 1;
  if v_note_id is not null then
    alter table public.clinical_encounter_notes disable trigger clinical_encounter_notes_enforce_attribution;
    begin
      select clinical_encounter_id into v_before from public.clinical_encounter_notes where id = v_note_id;
      update public.clinical_encounter_notes set escalation_id = escalation_id where id = v_note_id;
      select clinical_encounter_id into v_after from public.clinical_encounter_notes where id = v_note_id;
    exception when others then
      alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;
      raise exception 'BUG 1 regression: updating a note with escalation_id set still raises: %', sqlerrm;
    end;
    alter table public.clinical_encounter_notes enable trigger clinical_encounter_notes_enforce_attribution;

    if v_after is null then
      raise exception 'BUG 1 regression: clinical_encounter_id resolved to null for a note with a real escalation_id';
    end if;
    if v_before is distinct from v_after then
      raise exception 'clinical_encounter_id changed unexpectedly during the regression proof (expected stable re-resolution to the same value)';
    end if;
  end if;

  raise notice 'PASS: sync_clinical_encounter_note_link no longer raises on insert/update; clinical_encounters sync triggers now fix up any note still missing its link after their own upsert; clinical_encounter_id is unconditionally server-derived on every note write';
end $$;

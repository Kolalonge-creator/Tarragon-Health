-- Tarragon Health
-- Fixes a real regression introduced by the previous same-session migration
-- (20260918101643_fix_clinical_encounter_note_link_bugs.sql), caught by an
-- independent second /code-review high pass on that fix before opening a
-- PR -- not a pre-existing issue.
--
-- The BUG 2 fix-up UPDATE added to sync_clinical_encounter_video_consultation/
-- escalation/async_consult ("fix up any note still missing its link after
-- our own upsert") fires clinical_encounter_notes_enforce_attribution
-- (20260827201621, extended 20260917031004). That trigger's UPDATE branch
-- has NO trusted-system escape hatch -- only its INSERT branch does, added
-- specifically (per that migration's own header) because a session-less
-- caller such as "a Zoom webhook" completing a video consultation would
-- otherwise "raise and roll back the triggering update entirely when no
-- session exists." The fix-up UPDATE reintroduces exactly that failure mode
-- for UPDATE: a session-less caller updating video_consultations/escalations/
-- async_consults, at the moment a linked note genuinely needs fixing up,
-- would have the ENTIRE source-table write aborted by an unrelated
-- "Only a clinical-tier member..." exception from deep inside an AFTER
-- trigger the caller has no reason to expect.
--
-- Fixed the same way auto_draft_note_from_async_consult/escalation already
-- handle this exact class of risk for their own note-authoring writes (see
-- their own "Never raises" comments): the fix-up UPDATE is now wrapped in
-- an exception handler. Linking a note to its encounter is best-effort
-- bookkeeping, not a clinical act that should ever be allowed to block the
-- source-table write it's piggybacking on -- a failure here is swallowed
-- (not silently ignored forever: logged via RAISE WARNING, matching the
-- same auto-draft functions' own convention, so it's visible in Postgres
-- logs without blocking anything).

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

  begin
    update public.clinical_encounter_notes
    set clinical_encounter_id = v_encounter_id
    where video_consultation_id = new.id and clinical_encounter_id is distinct from v_encounter_id;
  exception when others then
    raise warning 'sync_clinical_encounter_video_consultation: could not fix up clinical_encounter_notes link for video_consultation %: %', new.id, sqlerrm;
  end;

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

  begin
    update public.clinical_encounter_notes
    set clinical_encounter_id = v_encounter_id
    where escalation_id = new.id and clinical_encounter_id is distinct from v_encounter_id;
  exception when others then
    raise warning 'sync_clinical_encounter_escalation: could not fix up clinical_encounter_notes link for escalation %: %', new.id, sqlerrm;
  end;

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

  begin
    update public.clinical_encounter_notes
    set clinical_encounter_id = v_encounter_id
    where async_consult_id = new.id and clinical_encounter_id is distinct from v_encounter_id;
  exception when others then
    raise warning 'sync_clinical_encounter_async_consult: could not fix up clinical_encounter_notes link for async_consult %: %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

do $$
declare
  v_def text;
begin
  v_def := pg_get_functiondef('private.sync_clinical_encounter_video_consultation'::regproc);
  if v_def !~ 'exception when others' then
    raise exception 'sync_clinical_encounter_video_consultation fix-up UPDATE is not exception-wrapped';
  end if;
  v_def := pg_get_functiondef('private.sync_clinical_encounter_escalation'::regproc);
  if v_def !~ 'exception when others' then
    raise exception 'sync_clinical_encounter_escalation fix-up UPDATE is not exception-wrapped';
  end if;
  v_def := pg_get_functiondef('private.sync_clinical_encounter_async_consult'::regproc);
  if v_def !~ 'exception when others' then
    raise exception 'sync_clinical_encounter_async_consult fix-up UPDATE is not exception-wrapped';
  end if;
  raise notice 'PASS: all 3 clinical_encounters sync triggers'' note-link fix-up is now exception-wrapped and can never block the source-table write it runs alongside';
end $$;

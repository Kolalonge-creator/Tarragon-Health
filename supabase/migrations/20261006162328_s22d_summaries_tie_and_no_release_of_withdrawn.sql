-- S22 part 5: two hardening fixes (docs/BUILD-PROGRESS.md follow-ups; OQ-157, partly).
--
--   1. consultation_patient_summaries: a staff read needs a real relationship with the patient (INV-12). The old policy admitted
--      any org staff account. The only staff reader is the clinician's own consultation screen (the doctor who just signed the
--      note, tied through the video consultation), so tying the policy to private.clinician_has_patient_access() loses nothing.
--      The patient's own read is unchanged. (care_messages and its attachments are the care team's shared inbox: whether that
--      stays org-wide is a founder and CMO decision, recorded in OQ-157, and is not changed here.)
--   2. A withdrawn note cannot be requested or released. The patient was only shown the withdrawn marker, so nothing leaked,
--      but they were told "a note is available" and a clinician could release a note that no longer stands.

-- ---------------------------------------------------------------------------
-- 1. Summaries: staff only through a tie
-- ---------------------------------------------------------------------------
drop policy if exists consultation_patient_summaries_select on public.consultation_patient_summaries;
create policy consultation_patient_summaries_select on public.consultation_patient_summaries
  for select to authenticated
  using (
    patient_id = (select auth.uid())
    or (private.is_org_staff(organisation_id) and private.clinician_has_patient_access(patient_id))
  );

-- ---------------------------------------------------------------------------
-- 2. No request or release for a withdrawn note
-- ---------------------------------------------------------------------------
create or replace function public.request_note_release(p_note uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  r public.note_releases%rowtype;
  v_author_profile uuid;
begin
  select * into n from public.clinical_encounter_notes where id = p_note and patient_id = v_uid and status = 'finalized';
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_note) then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into r from public.note_releases where note_id = p_note;
  if found then
    if r.state = 'declined' then
      update public.note_releases set state = 'requested', requested_at = now(), requested_by = v_uid, decided_at = null, decided_by = null where id = r.id;
    else
      return;   -- already requested or released: nothing to do
    end if;
  else
    insert into public.note_releases (organisation_id, note_id, patient_id, state, requested_at, requested_by, is_test)
    values (n.organisation_id, n.id, n.patient_id, 'requested', now(), v_uid, n.is_test);
  end if;
  select cs.profile_id into v_author_profile from public.clinical_staff cs where cs.id = n.authored_by_staff;
  if v_author_profile is not null then
    perform private.written_care_notify(v_author_profile, n.organisation_id, 'note_release_requested', jsonb_build_object('note_id', n.id));
  end if;
  perform private.notify_clinical_leads(n.organisation_id, n.is_test, 'A note release was requested',
    'A patient asked to open a signed note.', jsonb_build_object('note_id', n.id), v_author_profile);
end;
$$;

create or replace function public.decide_note_release(p_note uuid, p_release boolean, p_reason text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  n public.clinical_encounter_notes%rowtype;
  v_cmo boolean;
begin
  perform private.may_work_on_note(p_note);
  select * into n from public.clinical_encounter_notes where id = p_note and status = 'finalized';
  if not found then raise exception 'only a signed note can be released' using errcode = 'P0001'; end if;
  if exists (select 1 from public.note_error_flags where note_id = p_note) then
    raise exception 'note_withdrawn_cannot_release' using errcode = 'P0001';
  end if;
  v_cmo := exists (select 1 from public.clinical_staff cs where cs.profile_id = v_uid and cs.active and cs.doctor_tier = 'chief_medical_officer');
  if n.is_protected and not v_cmo then raise exception 'note_release_cmo_only' using errcode = '42501'; end if;
  if p_release is not true and char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'note_withhold_reason_needed' using errcode = '22023'; end if;
  insert into public.note_releases (organisation_id, note_id, patient_id, state, decided_at, decided_by, withhold_reason, is_test)
  values (n.organisation_id, n.id, n.patient_id, case when p_release then 'released' else 'declined' end, now(), v_uid,
          case when p_release then null else btrim(p_reason) end, n.is_test)
  on conflict (note_id) do update
     set state = excluded.state, decided_at = excluded.decided_at, decided_by = excluded.decided_by, withhold_reason = excluded.withhold_reason;
  perform private.audit_chart_read(n.patient_id, array['notes'], case when p_release then 'release note' else 'withhold note' end, 'success');
  perform private.written_care_notify(n.patient_id, n.organisation_id, case when p_release then 'note_released' else 'note_release_declined' end,
                                      jsonb_build_object('note_id', n.id));
  if p_release then
    perform private.emit_domain_event('note.released', n.organisation_id, jsonb_build_object('note_id', n.id),
      'note.released:' || n.id || ':' || extract(epoch from now())::bigint, n.patient_id, 'clinical_note', n.id);
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.request_note_release(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_note_release(uuid,boolean,text)', 'EXECUTE') then
    raise exception 'S22d assertion: anon can execute a note release function';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'consultation_patient_summaries' and cmd = 'SELECT') <> 1 then
    raise exception 'S22d assertion: exactly one select policy on consultation_patient_summaries';
  end if;
end $$;

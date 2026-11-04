-- A doctor's line for the family (Care Circle, 2026-11-03).
--
-- After a consultation a doctor may write ONE short, plain-language note meant for the patient's family. It is not a clinical note:
-- the form says "Plain words. No results, diagnoses or medicine names." Supporters see it only through the Care Circle supporter view,
-- behind a NEW permission `doctor_note` that the patient ticks or unticks like every other one, and only the latest RELEASED note.
--
-- PATIENT FIRST (review fix, privacy): a new note is visible to the PATIENT only. It reaches supporters only after the patient taps
-- "Share with my Care Circle" on that very note (released_at/released_by, set only by public.set_family_note_shared, where auth.uid() must
-- be the patient). The patient can un-share it again. So a line written after, say, a contraception or mental-health consultation never
-- reaches family unless the patient has read it and chosen to share it; no category list has to be right for that to hold.
--
-- Shape and rules:
--   * public.family_doctor_notes: patient_id, organisation_id (taken from the patient, never from the caller), author_staff_id
--     (clinical_staff.id), encounter_id (S21 encounters) or appointment_id, body (1 to 280 characters), is_test (from the patient).
--   * RLS, written fresh (not copied from any older table): the patient reads their own notes; the author reads the notes they wrote
--     (an INSERT ... RETURNING needs a SELECT policy); a doctor inserts only through private.family_note_author_may_write, which demands
--     an active doctor-tier clinical_staff row for the caller and a COMPLETED consultation of THIS patient that THIS doctor held, ended
--     in the last 30 days. The assignment is the authority, not organisation equality (review fix: patients and staff can sit in
--     different organisations, e.g. an employer-organisation patient seen by a Tarragon doctor). Care coordinators cannot write one. private.is_org_staff is not used or
--     changed. No UPDATE or DELETE policy or grant, and a trigger refuses any UPDATE except the release columns, and those only from inside
--     set_family_note_shared: the body and author never change, a correction is a new row. (DELETE is left to the profile cascade so
--     account erasure keeps working; nobody holds a DELETE grant.)
--   * The supporter block comes from private.circle_view_blocks, the one builder behind the supporter page and the patient's preview, so
--     the gate stays private.circle_member_for and every read stays audited by circle_supporter_view. The doctor's name is null-gated: it
--     is sent only when the author's clinical_staff row is active and named; otherwise the screen says "your care team".
--   * reproductive-health access is not touched. No go-live guard, no platform module.
-- Row counts at writing (live, read-only): care_circle_members 0, encounters completed 1. No data is converted.

-- ---------------------------------------------------------------------------
-- 1. The permission (live body of private.circle_permissions_valid read with pg_get_functiondef; one value added, cap 6 -> 7)
-- ---------------------------------------------------------------------------
create or replace function private.circle_permissions_valid(p text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p) between 1 and 7
         and p <@ array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care', 'attend_consultation', 'doctor_note']::text[]
         and cardinality(p) = (select count(distinct x) from unnest(p) x), false)
$$;
revoke all on function private.circle_permissions_valid(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The table
-- ---------------------------------------------------------------------------
create table public.family_doctor_notes (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  author_staff_id  uuid not null references public.clinical_staff (id) on delete restrict,
  encounter_id     uuid references public.encounters (id) on delete restrict,
  appointment_id   uuid references public.appointments (id) on delete restrict,
  body             text not null check (char_length(btrim(body)) between 1 and 280),
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  -- patient-first release: null until the patient shares it; released_by is always the patient (no FK, so a profile cascade never has to
  -- update this row); share_decided_at records that the patient answered at all (share or don't share), so the card can stop asking
  released_at      timestamptz,
  released_by      uuid,
  share_decided_at timestamptz,
  check (encounter_id is not null or appointment_id is not null),
  check ((released_at is null) = (released_by is null)),
  check (released_by is null or released_by = patient_id)
);
create index family_doctor_notes_patient_idx on public.family_doctor_notes (patient_id, created_at desc);
create index family_doctor_notes_author_idx on public.family_doctor_notes (author_staff_id, created_at desc);
comment on table public.family_doctor_notes is
  'A doctor''s short plain-language line for the patient''s family after a consultation. Append only (a correction is a new row). '
  'The patient sees it first; supporters read only the latest note the patient released, through circle_supporter_view behind doctor_note.';

-- organisation and test flag always come from the patient, and the time from the server
create function private.family_doctor_notes_fill() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare p public.profiles%rowtype;
begin
  select * into p from public.profiles where id = new.patient_id;
  if not found or p.organisation_id is null then raise exception 'family_note_not_allowed' using errcode = '42501'; end if;
  new.organisation_id := p.organisation_id;
  new.is_test := coalesce(p.is_test, false);
  -- clock_timestamp, not now(): two notes written in one transaction must still have an order, or "the latest" is a coin toss
  new.created_at := clock_timestamp();
  new.body := btrim(new.body);
  -- a new note is never born shared, whatever the caller sends (the columns are not in the insert grant either)
  new.released_at := null;
  new.released_by := null;
  new.share_decided_at := null;
  return new;
end $$;
revoke all on function private.family_doctor_notes_fill() from public, anon, authenticated;
create trigger family_doctor_notes_fill before insert on public.family_doctor_notes
  for each row execute function private.family_doctor_notes_fill();

-- The body, author, patient, consultation and dates never change. Only the three release columns may, and only while
-- set_family_note_shared has raised its transaction-local flag (nobody else holds UPDATE on the table anyway).
create function private.family_doctor_notes_no_update() returns trigger
language plpgsql set search_path = ''
as $$
begin
  if (new.id, new.organisation_id, new.patient_id, new.author_staff_id, new.encounter_id, new.appointment_id, new.body, new.is_test, new.created_at)
       is distinct from
     (old.id, old.organisation_id, old.patient_id, old.author_staff_id, old.encounter_id, old.appointment_id, old.body, old.is_test, old.created_at)
     or coalesce(current_setting('tarragon.family_note_release', true), '') <> 'on' then
    raise exception 'family_note_is_append_only' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.family_doctor_notes_no_update() from public, anon, authenticated;
create trigger family_doctor_notes_no_update before update on public.family_doctor_notes
  for each row execute function private.family_doctor_notes_no_update();

-- ---------------------------------------------------------------------------
-- 3. Who may write: the doctor who held this patient's completed consultation, recently (the assignment is the authority)
-- ---------------------------------------------------------------------------
create function private.family_note_author_may_write(p_author uuid, p_patient uuid, p_encounter uuid, p_appointment uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.clinical_staff cs
        where cs.id = p_author
          and cs.profile_id = (select auth.uid())
          and cs.active
          and cs.doctor_tier is not null
          and cs.doctor_tier <> 'care_coordinator')
     and (
       (p_encounter is not null and exists (
          select 1 from public.encounters e
           where e.id = p_encounter and e.patient_id = p_patient and e.clinician_id = (select auth.uid())
             and e.status = 'completed' and coalesce(e.ended_at, e.updated_at) > now() - interval '30 days'
             and (p_appointment is null or e.appointment_id = p_appointment)))
       or
       (p_encounter is null and p_appointment is not null and exists (
          select 1 from public.appointments a
           where a.id = p_appointment and a.patient_id = p_patient and a.clinician_id = (select auth.uid())
             and a.status = 'completed' and coalesce(a.completed_at, a.updated_at) > now() - interval '30 days'))
     )
$$;
revoke all on function private.family_note_author_may_write(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.family_note_author_may_write(uuid, uuid, uuid, uuid) to authenticated;

alter table public.family_doctor_notes enable row level security;

create policy family_doctor_notes_patient_read on public.family_doctor_notes for select to authenticated
  using (patient_id = (select auth.uid()));
create policy family_doctor_notes_author_read on public.family_doctor_notes for select to authenticated
  using (author_staff_id = (select private.my_clinical_staff_id()));
create policy family_doctor_notes_author_insert on public.family_doctor_notes for insert to authenticated
  with check (private.family_note_author_may_write(author_staff_id, patient_id, encounter_id, appointment_id));

revoke all on public.family_doctor_notes from public, anon, authenticated;
grant select on public.family_doctor_notes to authenticated;
grant insert (patient_id, author_staff_id, encounter_id, appointment_id, body) on public.family_doctor_notes to authenticated;

-- The clinician screen's one call. SECURITY INVOKER on purpose: the encounter is read under the caller's own RLS and the insert is
-- checked by the policy above, so this function adds convenience (the screen need not know the patient or its own staff id), never access.
create function public.write_family_note(p_encounter uuid, p_body text) returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare v_patient uuid; v_id uuid;
begin
  if (select auth.uid()) is null then raise exception 'family_note_not_allowed' using errcode = '42501'; end if;
  select e.patient_id into v_patient from public.encounters e where e.id = p_encounter;
  if v_patient is null then raise exception 'family_note_not_allowed' using errcode = '42501'; end if;
  insert into public.family_doctor_notes (patient_id, author_staff_id, encounter_id, body)
  values (v_patient, (select private.my_clinical_staff_id()), p_encounter, p_body)
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.write_family_note(uuid, text) from public, anon;
grant execute on function public.write_family_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3b. Patient first: the patient reads their notes and decides, note by note, whether the Care Circle may see each one
-- ---------------------------------------------------------------------------
create function public.set_family_note_shared(p_note uuid, p_share boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); n public.family_doctor_notes%rowtype;
begin
  if v_uid is null or p_share is null then raise exception 'family_note_not_allowed' using errcode = '42501'; end if;
  perform set_config('tarragon.family_note_release', 'on', true);
  update public.family_doctor_notes
     set released_at = case when p_share then coalesce(released_at, now()) end,
         released_by = case when p_share then v_uid end,
         share_decided_at = now()
   where id = p_note and patient_id = v_uid
   returning * into n;
  perform set_config('tarragon.family_note_release', 'off', true);
  -- one answer for "not yours" and "no such note"
  if n.id is null then raise exception 'family_note_not_found' using errcode = 'P0002'; end if;
  return n.released_at is not null;
end $$;
revoke all on function public.set_family_note_shared(uuid, boolean) from public, anon;
grant execute on function public.set_family_note_shared(uuid, boolean) to authenticated;

-- The patient's own latest notes (3), with whether each is shared and whether they have answered. Doctor's name null-gated.
create function public.my_family_notes() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'note_id', x.id, 'body', x.body, 'written_at', x.created_at,
           'author_staff_id', x.author_staff_id, 'author_name', x.author_name,
           'shared', x.released_at is not null, 'decided', x.share_decided_at is not null) order by x.created_at desc), '[]'::jsonb)
    from (select n.id, n.body, n.created_at, n.released_at, n.share_decided_at,
                 case when cs.active and nullif(btrim(cs.full_name), '') is not null then cs.id end as author_staff_id,
                 case when cs.active then nullif(btrim(cs.full_name), '') end as author_name
            from public.family_doctor_notes n
            left join public.clinical_staff cs on cs.id = n.author_staff_id
           where n.patient_id = (select auth.uid())
           order by n.created_at desc, n.id desc
           limit 3) x
$$;
revoke all on function public.my_family_notes() from public, anon;
grant execute on function public.my_family_notes() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The supporter block (the latest note the PATIENT RELEASED, never an unreleased one; doctor's name null-gated)
-- ---------------------------------------------------------------------------
create function private.circle_doctor_note_block(p_patient uuid, p_permissions text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select case when not ('doctor_note' = any (coalesce(p_permissions, '{}'::text[]))) then '{}'::jsonb
  else jsonb_build_object('doctor_note', (
    select jsonb_build_object(
             'body', n.body,
             'written_at', n.created_at,
             'author_staff_id', case when cs.active and nullif(btrim(cs.full_name), '') is not null then cs.id end,
             'author_name', case when cs.active then nullif(btrim(cs.full_name), '') end)
      from public.family_doctor_notes n
      left join public.clinical_staff cs on cs.id = n.author_staff_id
     where n.patient_id = p_patient and n.released_at is not null
     order by n.created_at desc, n.id desc
     limit 1))
  end
$$;
revoke all on function private.circle_doctor_note_block(uuid, text[]) from public, anon, authenticated;

-- live body of private.circle_view_blocks read with pg_get_functiondef; the doctor note block appended
create or replace function private.circle_view_blocks(p_patient uuid, p_permissions text[]) returns jsonb
language sql stable security definer set search_path = ''
as $$ select private.circle_view_blocks_core(p_patient, p_permissions) || private.circle_monthly_block(p_patient, p_permissions)
             || private.circle_doctor_note_block(p_patient, p_permissions) $$;

-- ---------------------------------------------------------------------------
-- 5. The two registries every patient table must be in (s39d_registry_purge_export, rls_shape_gate). Class assigned by the migration
--    author ('clinical_record', in the patient's own export), not yet reviewed by the CMO and DPO. Staff read scope 'tied': the only staff
--    read path is the author reading the notes they wrote, which is stricter than tied.
-- ---------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('family_doctor_notes', 'patient_id', 'clinical_record', 'review', true, false,
        'A doctor''s short plain-language line for the family after a consultation. Class assigned by the migration author, not yet reviewed by the CMO and DPO.')
on conflict (table_name) do nothing;
insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
values ('family_doctor_notes', 'tied', 'patient_id', 'medical_history', null)
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------
-- 6. Self-checks
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.circle_permissions_valid(array['doctor_note']) or private.circle_permissions_valid(array['doctor_note', 'doctor_note'])
     or private.circle_permissions_valid(array['doctor_notes']) or not private.circle_permissions_valid(array['attend_consultation']) then
    raise exception 'family note: the permission list is wrong';
  end if;
  if has_table_privilege('anon', 'public.family_doctor_notes', 'SELECT') or has_table_privilege('anon', 'public.family_doctor_notes', 'INSERT') then
    raise exception 'family note: anon can reach the table';
  end if;
  if has_table_privilege('authenticated', 'public.family_doctor_notes', 'UPDATE') or has_table_privilege('authenticated', 'public.family_doctor_notes', 'DELETE') then
    raise exception 'family note: a signed-in user can change or remove a note';
  end if;
  if has_column_privilege('authenticated', 'public.family_doctor_notes', 'organisation_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.family_doctor_notes', 'is_test', 'INSERT')
     or has_column_privilege('authenticated', 'public.family_doctor_notes', 'released_at', 'INSERT')
     or has_column_privilege('authenticated', 'public.family_doctor_notes', 'released_by', 'INSERT') then
    raise exception 'family note: the caller can choose the organisation or test flag';
  end if;
  if has_function_privilege('anon', 'private.family_note_author_may_write(uuid, uuid, uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.write_family_note(uuid, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_family_note_shared(uuid, boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_family_notes()', 'EXECUTE')
     or (select prosecdef from pg_proc where oid = 'public.write_family_note(uuid, text)'::regprocedure)
     or has_function_privilege('authenticated', 'private.circle_doctor_note_block(uuid, text[])', 'EXECUTE') then
    raise exception 'family note: a helper is executable by the wrong role';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.family_doctor_notes'::regclass) then
    raise exception 'family note: RLS is off';
  end if;
end $$;

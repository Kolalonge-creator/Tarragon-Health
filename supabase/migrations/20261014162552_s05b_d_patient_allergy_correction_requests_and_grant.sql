-- S05b-d: a patient's own allergy correction waits for a clinician; then the correction function is opened to signed-in users.
--
-- FOUNDER DECISION (2026-10-14, chosen in chat, docs/DECISIONS.md): when a PATIENT voids or corrects an allergy she entered herself and
-- that no clinician verified, her request is saved but the ORIGINAL allergy stays active (prescription safety, the emergency card and every
-- reader) until a clinician confirms. A clinician tied to the patient (not a care coordinator) corrects immediately, as before. Reason: an
-- allergy is the one entry where a wrong removal can hurt (a prescription blocked today is allowed tomorrow), and the S05b-c review had
-- flagged this as an open risk before the grant.
--
-- WHAT THIS ADDS
--   1. private.is_correcting_clinician(patient): the one "tied, active, not a care coordinator" test; correct_clinical_value now calls it
--      (patched in place) instead of carrying its own copy, so RLS, confirm, reject and the correction function cannot drift apart.
--   2. public.patient_allergy_correction_requests (the pending request) and public.patient_allergy_correction_events (append only: who
--      asked, who confirmed or rejected, when). Clients can only read; every write goes through the functions below. The patient sees her
--      own requests; a tied clinician sees the requests of her patients.
--   3. The patient path of public.correct_clinical_value on patient_allergies now creates the request (via
--      private.request_patient_allergy_correction) and returns status 'pending'. Nothing on the allergy row changes. Every other table, and
--      every clinician call, is unchanged (the vitals patient guards are untouched).
--   4. public.confirm_patient_allergy_correction: the tied clinician confirms; it calls correct_clinical_value itself, so the original is
--      marked and the replacement inserted in one transaction by the same supersede path (replacement stored as a clinician entry).
--      public.reject_patient_allergy_correction: the original is untouched; the patient gets one in-app notice with no clinical words.
--   5. public.my_corrected_record_entries(): the patient's own superseded values and her own requests, so her data export is complete
--      (S05b-c checklist item 5). A trigger on the four-table supersede marks any still-pending request for an allergy `void` when the
--      allergy is superseded another way (a clinician corrected it directly), so no request is left pending for good.
--      Clients read only the safe columns of the request and audit tables: the clinician's note and identity are never exposed (INV-07).
--   6. THE GRANT (last step): execute on correct_clinical_value to authenticated, revoked from public and anon.
--
-- THE S05b-c GRANT CHECKLIST (docs/design/S05b.md section 6), how each item is met:
--   (1) proof and full replay on a real database: run on a local stack before this was written (both S05b proofs pass) and again with this
--       migration; (2) the nine writers that read every row are intended; (3) care_plans.patient_condition_id: no function and no app
--       code reads the column, the foreign key stays valid, repointing is not done (care_plans carries signed-change triggers);
--       (4) alerts raised for an original reading: no reader joins an alert to its reading (they only test that the id is set), an alert
--       stays open for the clinician who made the correction to resolve, and a patient cannot correct a reading that has one;
--       (5) the export: my_corrected_record_entries below; (6) a `select *` view freezes its column list: the self-check at the end fails
--       if a _current view no longer has exactly the columns of its table, so the next added column fails the replay instead of hiding.
-- The S05b-a and S05b-c self-checks in their own (already applied) files still say "authenticated must not execute": they were true at the
-- time they ran in the replay and stay as history; the assertion that holds from here on is the one at the end of THIS migration and in
-- the proofs.
-- Counted first: patient_allergies had 0 rows live when S05b-a was written; no request table exists yet, nothing to convert.

-- 1. The clinician test --------------------------------------------------------------------------------------------------------------
create function private.is_correcting_clinician(p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as
$$
  select exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> 'care_coordinator'
  ) and private.clinician_has_patient_access(p_patient)
$$;
revoke all on function private.is_correcting_clinician(uuid) from public, anon;
grant execute on function private.is_correcting_clinician(uuid) to authenticated, service_role;

-- 2. The request and its audit trail -------------------------------------------------------------------------------------------------
create table public.patient_allergy_correction_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id),
  patient_id uuid not null references public.profiles (id) on delete cascade,
  allergy_id uuid not null references public.patient_allergies (id),
  requested_status public.correction_status not null check (requested_status in ('corrected', 'amended', 'entered_in_error')),
  reason text not null check (length(btrim(reason)) >= 5),
  replacement jsonb check (replacement is null or jsonb_typeof(replacement) = 'object'),
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected', 'void', 'withdrawn')),
  decided_by uuid,   -- no foreign key: its SET NULL update would hit the decided-request guard when a profile is removed
  decided_at timestamptz,
  decision_note text,
  replacement_id uuid,
  created_at timestamptz not null default now(),
  check ((status = 'pending') = (decided_at is null)),
  check (requested_status = 'entered_in_error' or replacement is not null)
);
create unique index patient_allergy_correction_one_pending on public.patient_allergy_correction_requests (allergy_id) where status = 'pending';
create index patient_allergy_correction_patient_idx on public.patient_allergy_correction_requests (patient_id, status);

create table public.patient_allergy_correction_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.patient_allergy_correction_requests (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id),
  event text not null check (event in ('requested', 'confirmed', 'rejected', 'void', 'withdrawn')),
  actor_id uuid,
  actor_role text not null check (actor_role in ('patient', 'clinician', 'system')),
  note text,
  at timestamptz not null default now()
);
create index patient_allergy_correction_events_request_idx on public.patient_allergy_correction_events (request_id);

-- Append only. A cascade from the parent request (a removed test account) is the one delete that may pass: it fires at depth 2.
create function private.patient_allergy_correction_events_append_only() returns trigger language plpgsql set search_path = '' as
$$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'the correction audit trail is append only' using errcode = '42501';
end $$;
revoke all on function private.patient_allergy_correction_events_append_only() from public, anon, authenticated;
create trigger patient_allergy_correction_events_append_only before update or delete on public.patient_allergy_correction_events
  for each row execute function private.patient_allergy_correction_events_append_only();

-- A request can only be created or decided by the functions below (they run as postgres); a decided request is final.
create function private.patient_allergy_correction_requests_guard() returns trigger language plpgsql set search_path = '' as
$$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'correction requests are created and decided through the correction functions only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' then raise exception 'this correction request was already decided' using errcode = '42501'; end if;
    if new.patient_id is distinct from old.patient_id or new.allergy_id is distinct from old.allergy_id
       or new.organisation_id is distinct from old.organisation_id or new.requested_status is distinct from old.requested_status
       or new.reason is distinct from old.reason or new.replacement is distinct from old.replacement or new.created_at is distinct from old.created_at then
      raise exception 'a correction request cannot be edited' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.patient_allergy_correction_requests_guard() from public, anon, authenticated;
create trigger patient_allergy_correction_requests_guard before insert or update on public.patient_allergy_correction_requests
  for each row execute function private.patient_allergy_correction_requests_guard();

alter table public.patient_allergy_correction_requests enable row level security;
alter table public.patient_allergy_correction_events enable row level security;
create policy patient_allergy_correction_requests_select on public.patient_allergy_correction_requests
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_correcting_clinician(patient_id));
create policy patient_allergy_correction_events_select on public.patient_allergy_correction_events
  for select to authenticated
  using (exists (select 1 from public.patient_allergy_correction_requests r where r.id = request_id));
-- table privileges: the default grant to authenticated is more than these tables allow (RLS has no write policy, the grant is cut too)
revoke all on public.patient_allergy_correction_requests, public.patient_allergy_correction_events from public, anon, authenticated;
-- column grants (a client names its columns: `select *` on these two tables is refused by design): decided_by, decision_note, and the audit trail's actor_id and note are never readable by a client (the patient must not see a
-- clinician's note or identity: INV-07); the functions and the database owner read them
grant select (id, organisation_id, patient_id, allergy_id, requested_status, reason, replacement, status, decided_at, replacement_id, created_at)
  on public.patient_allergy_correction_requests to authenticated;
grant select (id, request_id, organisation_id, event, actor_role, at) on public.patient_allergy_correction_events to authenticated;

-- Under-18 dependant scope (S04b-1): a clinical patient table is guarded like patient_allergies itself (a proof fails for an unclassified one).
select private.guard_minor_dependant_table('patient_allergy_correction_requests', 'patient_id');

-- S39d data registry: every patient-keyed table is registered (the S39d proof asserts it). Default classification, marked unreviewed.
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
select t, 'patient_id', private.retention_class_for(t),
       case when private.retention_class_for(t) = 'operational' then 'delete' else 'review' end,
       false,   -- not in the registry export: it dumps whole rows (decided_by, decision_note); the patient's own requests, safe columns only, are in my_corrected_record_entries
       'Registered when the allergy correction requests were added (S05b-d); in_export is false on purpose (clinician note and identity); awaiting review.'
  from unnest(array['patient_allergy_correction_requests']) as t
on conflict (table_name) do nothing;

-- The one notice this feature sends (in-app only, neutral: INV-07, INV-08), registered like every other in-app template.
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('record_change_not_confirmed', 'operational', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'S05b-d: a clinician left a change the patient asked for in her record as it was. Names no entry, value or note (INV-07).')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('record_change_not_confirmed', 'en', 'in_app', 'Your record was left as it was',
   'Your care team looked at the change you asked for and left your record as it was. You can message them about it.')
on conflict (template_key, locale, channel) do nothing;

-- 3. Patient path: save the request, change nothing -----------------------------------------------------------------------------------
create function private.request_patient_allergy_correction(p_id uuid, p_status public.correction_status, p_reason text, p_replacement jsonb)
returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_al public.patient_allergies;
  v_key text;
  v_probe public.patient_allergies;
  v_req uuid;
begin
  if v_uid is null then raise exception 'sign in to correct a record' using errcode = '42501'; end if;
  select * into v_al from private.patient_allergies_current where id = p_id;   -- a definer reader: the current entries only (S05b-c rule)
  if v_al.id is null or v_al.patient_id <> v_uid then raise exception 'you cannot correct this record' using errcode = '42501'; end if;
  if p_status not in ('corrected', 'amended', 'entered_in_error') then
    raise exception 'a patient cannot request status %', p_status using errcode = '42501';
  end if;
  if p_status in ('corrected', 'amended') then
    for v_key in select jsonb_object_keys(p_replacement) loop
      if v_key not in ('allergen', 'reaction', 'severity') then
        raise exception 'column % cannot be part of a correction', v_key using errcode = '22023';
      end if;
    end loop;
    -- the values must be valid now (a bad severity fails here, not weeks later in front of the clinician)
    v_probe := jsonb_populate_record(v_al, p_replacement);
    if v_probe.allergen is null or length(btrim(v_probe.allergen)) = 0 then
      raise exception 'an allergy needs a name' using errcode = '22023';
    end if;
    -- the unique rule on current entries would only fail later, in front of the clinician: refuse it now
    if exists (select 1 from private.patient_allergies_current c where c.patient_id = v_uid and c.allergen = v_probe.allergen and c.id <> p_id) then
      raise exception 'you already have an allergy with that name' using errcode = '22023';
    end if;
  end if;
  if exists (select 1 from public.patient_allergy_correction_requests where allergy_id = p_id and status = 'pending') then
    raise exception 'a request for this entry is already waiting for your care team' using errcode = '22023';
  end if;

  insert into public.patient_allergy_correction_requests (organisation_id, patient_id, allergy_id, requested_status, reason, replacement)
  values (v_al.organisation_id, v_uid, p_id, p_status, btrim(p_reason), case when p_status = 'entered_in_error' then null else p_replacement end)
  returning id into v_req;
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role) values (v_req, v_al.organisation_id, 'requested', v_uid, 'patient');

  return jsonb_build_object('table', 'patient_allergies', 'original_id', p_id, 'replacement_id', null, 'status', 'pending', 'request_id', v_req);
end;
$$;
revoke all on function private.request_patient_allergy_correction(uuid, public.correction_status, text, jsonb) from public, anon, authenticated;

-- 3b. A request whose allergy is superseded another way is closed, never left pending ------------------------------------------------
create function private.void_pending_allergy_requests() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if coalesce(nullif(current_setting('app.allergy_request_confirming', true), ''), 'off') = 'on' then return null; end if;
  for r in select id, organisation_id from public.patient_allergy_correction_requests where allergy_id = new.id and status = 'pending' for update loop
    update public.patient_allergy_correction_requests set status = 'void', decided_at = now(), decision_note = 'entry already changed' where id = r.id;
    insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_role, note)
    values (r.id, r.organisation_id, 'void', 'system', 'entry already changed');
  end loop;
  return null;
end;
$$;
revoke all on function private.void_pending_allergy_requests() from public, anon, authenticated;
create trigger z_void_pending_allergy_requests after update of correction_status on public.patient_allergies
  for each row when (old.correction_status is null and new.correction_status is not null)
  execute function private.void_pending_allergy_requests();

-- Patch correct_clinical_value in place from its live definition, ONE block, two anchors (the S05b-c convention; each anchor is asserted):
--   (1) the patient path on an allergy becomes the request; (2) the inline "tied, active, not a care coordinator" test becomes the shared helper.
do $$
declare
  v_def text;
  v_anchor constant text := E'raise exception ''this entry was already superseded'' using errcode = ''22023'';\n  end if;\n';
  v_add constant text :=
    E'  -- S05b-d: a patient''s own allergy correction is only a request until a clinician confirms; the original stays active meanwhile\n'
    || E'  if not v_is_staff and p_table = ''patient_allergies'' then\n'
    || E'    return private.request_patient_allergy_correction(p_id, p_status, p_reason, p_replacement);\n'
    || E'  end if;\n';
  v_old constant text := E'select exists (\n    select 1 from public.clinical_staff cs\n     where cs.profile_id = v_uid and cs.active and cs.doctor_tier is not null and cs.doctor_tier <> ''care_coordinator''\n  ) and private.clinician_has_patient_access(v_patient) into v_is_staff;';
  v_new constant text := E'select private.is_correcting_clinician(v_patient) into v_is_staff;';
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
  if v_def is null or position(v_anchor in v_def) = 0 or position(v_old in v_def) = 0 then
    raise exception 'correct_clinical_value: an expected statement was not found, refusing to guess';
  end if;
  v_def := replace(v_def, v_anchor, v_anchor || v_add);
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- 4. The clinician decides -----------------------------------------------------------------------------------------------------------
create function public.confirm_patient_allergy_correction(p_request_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_req public.patient_allergy_correction_requests;
  v_res jsonb;
  v_aid uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- authorise first on an unlocked read, so an unauthorised caller never takes a lock; one answer for missing and not permitted
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id;
  if v_req.id is null or not private.is_correcting_clinician(v_req.patient_id) then
    raise exception 'you cannot resolve this request' using errcode = '42501';
  end if;
  -- then lock the allergy BEFORE the request, the order the voiding trigger and correct_clinical_value use, so a confirmation racing a direct
  -- correction cannot deadlock (a no-op when the entry is no longer current: the trigger has then already voided the request); re-read after
  v_aid := v_req.allergy_id;
  perform 1 from private.patient_allergies_current where id = v_aid for update;
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'this request was already decided' using errcode = '22023'; end if;

  -- the same supersede path as any clinician correction (original marked, replacement inserted, one transaction)
  if v_req.requested_status in ('corrected', 'amended') and v_req.replacement ? 'allergen'
     and exists (select 1 from private.patient_allergies_current c
                  where c.patient_id = v_req.patient_id and c.allergen = v_req.replacement ->> 'allergen' and c.id <> v_req.allergy_id) then
    raise exception 'another current allergy already has that name: reject this request, or correct the entry yourself' using errcode = '22023';
  end if;
  -- (the flag keeps the voiding trigger from closing this very request while its allergy is being marked)
  perform set_config('app.allergy_request_confirming', 'on', true);
  v_res := public.correct_clinical_value('patient_allergies', v_req.allergy_id, v_req.requested_status,
                                         v_req.reason || ' (requested by the patient, confirmed by a clinician)', v_req.replacement);
  perform set_config('app.allergy_request_confirming', 'off', true);
  update public.patient_allergy_correction_requests
     set status = 'confirmed', decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         replacement_id = nullif(v_res ->> 'replacement_id', '')::uuid
   where id = p_request_id;
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role, note)
  values (p_request_id, v_req.organisation_id, 'confirmed', v_uid, 'clinician', nullif(btrim(p_note), ''));
  return v_res || jsonb_build_object('request_id', p_request_id, 'status', v_req.requested_status);
end;
$$;

create function public.reject_patient_allergy_correction(p_request_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_req public.patient_allergy_correction_requests;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id for update;
  if v_req.id is null or not private.is_correcting_clinician(v_req.patient_id) then
    raise exception 'you cannot resolve this request' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then raise exception 'this request was already decided' using errcode = '22023'; end if;

  update public.patient_allergy_correction_requests
     set status = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(p_note), '')
   where id = p_request_id;
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role, note)
  values (p_request_id, v_req.organisation_id, 'rejected', v_uid, 'clinician', nullif(btrim(p_note), ''));
  -- in-app only, and no clinical word: the entry's name and the clinician's note are never in the notice (INV-07, INV-08)
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
  values (v_req.organisation_id, v_req.patient_id, 'in_app', 'pending', 'record_change_not_confirmed',
          jsonb_build_object('request_id', p_request_id), 'non_clinical');
  return jsonb_build_object('request_id', p_request_id, 'status', 'rejected');
end;
$$;
-- The patient may take a pending request back (it blocks any further request on that allergy while it waits).
create function public.withdraw_patient_allergy_correction(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_req public.patient_allergy_correction_requests;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id for update;
  if v_req.id is null or v_req.patient_id <> v_uid then raise exception 'you cannot withdraw this request' using errcode = '42501'; end if;
  if v_req.status <> 'pending' then raise exception 'this request was already decided' using errcode = '22023'; end if;
  update public.patient_allergy_correction_requests set status = 'withdrawn', decided_at = now() where id = p_request_id;   -- decided_by stays for clinicians only
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role)
  values (p_request_id, v_req.organisation_id, 'withdrawn', v_uid, 'patient');
  return jsonb_build_object('request_id', p_request_id, 'status', 'withdrawn');
end;
$$;
revoke all on function public.confirm_patient_allergy_correction(uuid, text), public.reject_patient_allergy_correction(uuid, text),
  public.withdraw_patient_allergy_correction(uuid) from public, anon;
grant execute on function public.confirm_patient_allergy_correction(uuid, text), public.reject_patient_allergy_correction(uuid, text),
  public.withdraw_patient_allergy_correction(uuid) to authenticated;

-- 5. The patient's own superseded values (for her data export) ------------------------------------------------------------------------
-- Which columns of the four tables identify staff or hold clinical review internals: never returned to the patient. By NAME PATTERN, so a staff
-- id column added later is excluded without anyone remembering to list it (the proof asserts every such column of the four tables matches).
create function private.is_staff_identifier_column(p_col text) returns boolean language sql immutable set search_path = '' as
$$
  select p_col in ('search_vector', 'validation_flags') or (p_col <> 'superseded_by_id' and p_col ~ '(_by|_by_id|clinician_id|staff_id|doctor_id|profile_id)$')
$$;
revoke all on function private.is_staff_identifier_column(text) from public, anon;
grant execute on function private.is_staff_identifier_column(text) to authenticated, service_role;

create function public.my_corrected_record_entries(p_patient uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_out jsonb := '{}'::jsonb;
  t text;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- an export built for somebody else must fail loudly, never come back as the caller's own history mixed into it
  if p_patient is not null and p_patient <> v_uid then raise exception 'this is only available for your own record' using errcode = '42501'; end if;
  foreach t in array array['vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings'] loop
    execute format(
      $q$select coalesce(jsonb_agg((select jsonb_object_agg(e.key, e.value) from jsonb_each(to_jsonb(x)) e where not private.is_staff_identifier_column(e.key)) order by x.corrected_at), '[]'::jsonb)
           from public.%I x where x.patient_id = $1 and x.correction_status is not null$q$, t) into v_rows using v_uid;
    v_out := v_out || jsonb_build_object(t, v_rows);
  end loop;
  -- her own correction requests (safe columns only: no clinician note or identity)
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'allergy_id', r.allergy_id, 'requested_status', r.requested_status, 'reason', r.reason,
                                               'replacement', r.replacement, 'status', r.status, 'decided_at', r.decided_at, 'created_at', r.created_at)
                            order by r.created_at), '[]'::jsonb)
    into v_rows from public.patient_allergy_correction_requests r where r.patient_id = v_uid;
  v_out := v_out || jsonb_build_object('patient_allergy_correction_requests', v_rows);
  return v_out;
end;
$$;
revoke all on function public.my_corrected_record_entries(uuid) from public, anon;
grant execute on function public.my_corrected_record_entries(uuid) to authenticated;

-- 6. THE GRANT (last step) -------------------------------------------------------------------------------------------------------------
revoke all on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) from public, anon;
grant execute on function public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb) to authenticated;

-- 7. Self-check ------------------------------------------------------------------------------------------------------------------------
do $$
declare
  t text;
  v_cols_table text;
  v_cols_view text;
  f text;
begin
  if not has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'authenticated cannot execute correct_clinical_value';
  end if;
  if has_function_privilege('anon', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'anon can execute correct_clinical_value (it inherits through PUBLIC: revoke from public)';
  end if;
  foreach f in array array['public.confirm_patient_allergy_correction(uuid, text)', 'public.reject_patient_allergy_correction(uuid, text)', 'public.withdraw_patient_allergy_correction(uuid)', 'public.my_corrected_record_entries(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or not has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'wrong execute grants on %', f;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.request_patient_allergy_correction(uuid, public.correction_status, text, jsonb)', 'EXECUTE') then
    raise exception 'authenticated can call the request function directly';
  end if;
  foreach f in array array['public.patient_allergy_correction_requests', 'public.patient_allergy_correction_events'] loop
    if has_table_privilege('authenticated', f, 'INSERT') or has_table_privilege('authenticated', f, 'UPDATE')
       or has_table_privilege('authenticated', f, 'DELETE') or has_table_privilege('authenticated', f, 'TRUNCATE') then
      raise exception '% is writable by authenticated', f;
    end if;
  end loop;
  -- checklist item 6: a _current view is `select *` frozen at creation, so it must keep exactly the columns of its table
  foreach t in array array['vitals_readings', 'patient_conditions', 'patient_allergies', 'lab_analyte_readings'] loop
    select string_agg(column_name, ',' order by column_name) into v_cols_table from information_schema.columns where table_schema = 'public' and table_name = t;
    select string_agg(a.attname, ',' order by a.attname) into v_cols_view
      from pg_attribute a where a.attrelid = ('private.' || t || '_current')::regclass and a.attnum > 0 and not a.attisdropped;
    if v_cols_table is distinct from v_cols_view then
      raise exception 'private.%_current is out of step with public.%: add the new column to the view', t, t;
    end if;
  end loop;
end $$;

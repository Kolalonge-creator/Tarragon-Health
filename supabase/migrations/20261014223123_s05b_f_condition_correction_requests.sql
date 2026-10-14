-- S05b-f: the S05b-d hold rule, extended from allergies to conditions the patient entered herself.
--
-- FOUNDER DECISION (2026-10-14, chosen in chat, docs/DECISIONS.md): when a PATIENT voids or corrects a condition she entered herself
-- (patient_conditions, source patient) that no clinician verified, her request is saved and the ORIGINAL stays active in every reader
-- until a tied clinician (not a care coordinator) confirms or rejects. A clinician-tied user's own correction stays immediate. Other
-- tables (vitals, lab values) keep their rules: a patient still corrects her own manual reading at once.
--
-- WHAT THIS DOES (one mechanism, now keyed on a record table instead of copied):
--   1. public.patient_allergy_correction_requests gains record_table ('patient_allergies' or 'patient_conditions') and condition_id (foreign
--      key, cascade, like allergy_id); allergy_id becomes nullable; exactly one of the two is set and it must match record_table. One waiting
--      request per record (a second partial unique index for conditions). The table keeps its name: renaming a live table, its policies,
--      grants, the S39d registry row, the export key and every query would add risk for no behaviour. The same goes for the three public
--      functions (confirm_/reject_/withdraw_patient_allergy_correction): they now work for either table and keep their names so no caller breaks.
--   2. private.request_patient_allergy_correction becomes private.request_patient_record_correction(table, ...), one function with a small
--      per-table rule (which columns a replacement may name, the name rule, the duplicate-name rule that only allergies have). The old
--      function is dropped once correct_clinical_value no longer calls it.
--   3. correct_clinical_value is patched in place from its live definition (two anchors, each asserted exactly once): the patient branch now
--      covers both tables, and a patient can no longer touch a condition with a diagnosing clinician or a clinician review (the condition equivalent of an
--      allergy a clinician verified). Nothing else in the function changes.
--   4. confirm_patient_allergy_correction works for either table (it still calls correct_clinical_value itself, so the original is marked and
--      the replacement inserted by the one supersede path, stored as a clinician entry). Reject and withdraw were already table-agnostic.
--   5. The stale-request voiding trigger is one function for both tables (private.void_pending_record_requests) and is installed on both.
--   6. The resubmit limit (3 requests per record in a rolling 7 days, void excluded) now counts per record, whichever table it belongs to.
--   7. The patient's own export lists her condition requests as well (record_table and condition_id are in the safe columns).
--   Notices need no change: the clinician-arrival and patient-confirmed notices and their recipients never named a table or a value
--   (INV-07), are in-app only (INV-08), and are triggered by the request row itself.
-- NOT changed: the table's RLS (patient_id based), the audit table, the minor-dependant guard (it is keyed on patient_id, which is
-- unchanged; the self-check asserts the policy row is still 'guarded'), the data_registry row (still in_export = false: the registry export
-- dumps whole rows, which carry the clinician's note and identity), and every grant on correct_clinical_value.
-- Counted first: patient_conditions had 0 rows live when S05b-a was written and no condition request table existed, so there is nothing to convert.

-- 1. The request table covers both record tables ---------------------------------------------------------------------------------------
alter table public.patient_allergy_correction_requests
  alter column allergy_id drop not null,
  add column record_table text not null default 'patient_allergies' check (record_table in ('patient_allergies', 'patient_conditions')),
  add column condition_id uuid references public.patient_conditions (id) on delete cascade;   -- like allergy_id: a request is meaningless once its record is gone
alter table public.patient_allergy_correction_requests
  add constraint patient_record_correction_one_record check (
    (record_table = 'patient_allergies' and allergy_id is not null and condition_id is null)
    or (record_table = 'patient_conditions' and condition_id is not null and allergy_id is null)
  );
create unique index patient_condition_correction_one_pending on public.patient_allergy_correction_requests (condition_id) where status = 'pending';
create index patient_condition_correction_condition_idx on public.patient_allergy_correction_requests (condition_id) where condition_id is not null;
grant select (record_table, condition_id) on public.patient_allergy_correction_requests to authenticated;   -- safe columns, like allergy_id

-- the guard that makes a request immutable now also protects the two new columns
create or replace function private.patient_allergy_correction_requests_guard() returns trigger language plpgsql set search_path = '' as
$$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    raise exception 'correction requests are created and decided through the correction functions only' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.status <> 'pending' then raise exception 'this correction request was already decided' using errcode = '42501'; end if;
    if new.patient_id is distinct from old.patient_id or new.allergy_id is distinct from old.allergy_id
       or new.condition_id is distinct from old.condition_id or new.record_table is distinct from old.record_table
       or new.organisation_id is distinct from old.organisation_id or new.requested_status is distinct from old.requested_status
       or new.reason is distinct from old.reason or new.replacement is distinct from old.replacement or new.created_at is distinct from old.created_at then
      raise exception 'a correction request cannot be edited' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

-- 2. The one patient path: save the request, change nothing ------------------------------------------------------------------------------
create function private.request_patient_record_correction(p_table text, p_id uuid, p_status public.correction_status, p_reason text, p_replacement jsonb)
returns jsonb language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_row jsonb;
  v_key text;
  v_allowed text[];
  v_name_key text;
  v_name text;
  v_repl jsonb := p_replacement;
  v_req uuid;
begin
  if v_uid is null then raise exception 'sign in to correct a record' using errcode = '42501'; end if;
  if p_table not in ('patient_allergies', 'patient_conditions') then
    raise exception 'a patient request is not available for %', p_table using errcode = '22023';
  end if;
  -- (only ever called from correct_clinical_value, which has already locked this row FOR UPDATE and checked it is not superseded, so a
  -- clinician's direct correction cannot slip in between this read and the insert below)
  execute format('select to_jsonb(c) from private.%I_current c where id = $1', p_table) into v_row using p_id;   -- a definer reader: current entries only (S05b-c rule)
  if v_row is null or (v_row ->> 'patient_id')::uuid <> v_uid then raise exception 'you cannot correct this record' using errcode = '42501'; end if;
  if p_status not in ('corrected', 'amended', 'entered_in_error') then
    raise exception 'a patient cannot request status %', p_status using errcode = '42501';
  end if;
  v_allowed := case p_table when 'patient_allergies' then array['allergen', 'reaction', 'severity']
                                                         else array['condition_name', 'icd10_code', 'date_identified'] end;
  v_name_key := case p_table when 'patient_allergies' then 'allergen' else 'condition_name' end;
  if p_status in ('corrected', 'amended') then
    if p_replacement is null or jsonb_typeof(p_replacement) <> 'object' or p_replacement = '{}'::jsonb then
      raise exception 'a correction needs the new values' using errcode = '22023';
    end if;
    for v_key in select jsonb_object_keys(p_replacement) loop
      if not (v_key = any (v_allowed)) then
        raise exception 'column % cannot be part of a correction', v_key using errcode = '22023';
      end if;
    end loop;
    -- the values must be valid now (a bad severity or date fails here, not weeks later in front of the clinician)
    execute format('select to_jsonb(jsonb_populate_record(null::public.%I, $1))', p_table) using p_replacement;
    v_name := coalesce(p_replacement ->> v_name_key, v_row ->> v_name_key);
    if v_name is null or length(btrim(v_name)) = 0 then
      raise exception 'an entry needs a name' using errcode = '22023';
    end if;
    -- the unique rule on current allergies would only fail later, in front of the clinician: refuse it now (conditions have no such rule)
    if p_table = 'patient_allergies'
       and exists (select 1 from private.patient_allergies_current c where c.patient_id = v_uid and c.allergen = v_name and c.id <> p_id) then
      raise exception 'you already have an allergy with that name' using errcode = '22023';
    end if;
    -- a condition renamed without a new code must not keep the OLD code (correct_clinical_value copies every column she did not name):
    -- the replacement states "no code" explicitly, which the clinician sees in the queue and can complete
    if p_table = 'patient_conditions' and p_replacement ? 'condition_name' and not (p_replacement ? 'icd10_code') then
      v_repl := p_replacement || jsonb_build_object('icd10_code', null);
    end if;
  end if;
  if exists (select 1 from public.patient_allergy_correction_requests r
              where coalesce(r.allergy_id, r.condition_id) = p_id and r.status = 'pending') then
    raise exception 'a request for this entry is already waiting for your care team' using errcode = '22023';
  end if;

  insert into public.patient_allergy_correction_requests (organisation_id, patient_id, record_table, allergy_id, condition_id, requested_status, reason, replacement)
  values ((v_row ->> 'organisation_id')::uuid, v_uid, p_table,
          case when p_table = 'patient_allergies' then p_id end, case when p_table = 'patient_conditions' then p_id end,
          p_status, btrim(p_reason), case when p_status = 'entered_in_error' then null else v_repl end)
  returning id into v_req;
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role)
  values (v_req, (v_row ->> 'organisation_id')::uuid, 'requested', v_uid, 'patient');

  return jsonb_build_object('table', p_table, 'original_id', p_id, 'replacement_id', null, 'status', 'pending', 'request_id', v_req);
end;
$$;
revoke all on function private.request_patient_record_correction(text, uuid, public.correction_status, text, jsonb) from public, anon, authenticated;

-- 3. correct_clinical_value, patched in place from its live definition (each anchor asserted exactly once) ------------------------------
do $$
declare
  v_def text;
  v_a_old constant text :=
$a$  -- S05b-d: a patient's own allergy correction is only a request until a clinician confirms; the original stays active meanwhile
  if not v_is_staff and p_table = 'patient_allergies' then
    return private.request_patient_allergy_correction(p_id, p_status, p_reason, p_replacement);
$a$;
  v_a_new constant text :=
$a$  -- S05b-d/f: a patient's own allergy or condition correction is only a request until a clinician confirms; the original stays active meanwhile
  if not v_is_staff and p_table in ('patient_allergies', 'patient_conditions') then
    return private.request_patient_record_correction(p_table, p_id, p_status, p_reason, p_replacement);
$a$;
  v_b_old constant text := $b$or (p_table = 'patient_allergies' and v_old ->> 'verified_by' is not null) then$b$;
  v_b_new constant text :=
$b$or (p_table = 'patient_allergies' and v_old ->> 'verified_by' is not null)
       or (p_table = 'patient_conditions' and (v_old ->> 'diagnosing_clinician_id' is not null or v_old ->> 'last_reviewed_at' is not null)) then$b$;
begin
  select pg_get_functiondef(p.oid) into v_def from pg_proc p
   where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
  if v_def is null
     or (length(v_def) - length(replace(v_def, v_a_old, ''))) <> length(v_a_old)
     or (length(v_def) - length(replace(v_def, v_b_old, ''))) <> length(v_b_old) then
    raise exception 'correct_clinical_value: each expected statement must occur exactly once, refusing to guess';
  end if;
  v_def := replace(v_def, v_a_old, v_a_new);
  v_def := replace(v_def, v_b_old, v_b_new);
  execute v_def;
end $$;
drop function private.request_patient_allergy_correction(uuid, public.correction_status, text, jsonb);

-- 4. Confirm works for either table ------------------------------------------------------------------------------------------------------
create or replace function public.confirm_patient_allergy_correction(p_request_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as
$$
declare
  v_uid uuid := (select auth.uid());
  v_req public.patient_allergy_correction_requests;
  v_res jsonb;
  v_rid uuid;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- authorise first on an unlocked read, so an unauthorised caller never takes a lock; one answer for missing and not permitted
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id;
  if v_req.id is null or not private.is_correcting_clinician(v_req.patient_id) then
    raise exception 'you cannot resolve this request' using errcode = '42501';
  end if;
  -- then lock the record BEFORE the request, the order the voiding trigger and correct_clinical_value use, so a confirmation racing a direct
  -- correction cannot deadlock (a no-op when the entry is no longer current: the trigger has then already voided the request); re-read after
  v_rid := coalesce(v_req.allergy_id, v_req.condition_id);
  execute format('select 1 from private.%I_current where id = $1 for update', v_req.record_table) using v_rid;
  select * into v_req from public.patient_allergy_correction_requests where id = p_request_id for update;
  if v_req.status <> 'pending' then raise exception 'this request was already decided' using errcode = '22023'; end if;

  -- the same supersede path as any clinician correction (original marked, replacement inserted, one transaction)
  if v_req.record_table = 'patient_allergies' and v_req.requested_status in ('corrected', 'amended') and v_req.replacement ? 'allergen'
     and exists (select 1 from private.patient_allergies_current c
                  where c.patient_id = v_req.patient_id and c.allergen = v_req.replacement ->> 'allergen' and c.id <> v_req.allergy_id) then
    raise exception 'another current allergy already has that name: reject this request, or correct the entry yourself' using errcode = '22023';
  end if;
  -- (the flag keeps the voiding trigger from closing this very request while its record is being marked)
  perform set_config('app.record_request_confirming', 'on', true);
  v_res := public.correct_clinical_value(v_req.record_table, v_rid, v_req.requested_status,
                                         v_req.reason || ' (requested by the patient, confirmed by a clinician)', v_req.replacement);
  perform set_config('app.record_request_confirming', 'off', true);
  update public.patient_allergy_correction_requests
     set status = 'confirmed', decided_by = v_uid, decided_at = now(), decision_note = nullif(btrim(p_note), ''),
         replacement_id = nullif(v_res ->> 'replacement_id', '')::uuid
   where id = p_request_id;
  insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_id, actor_role, note)
  values (p_request_id, v_req.organisation_id, 'confirmed', v_uid, 'clinician', nullif(btrim(p_note), ''));
  -- 'status' is the request's state, like the other three functions; the kind of correction applied is 'correction_status'
  return v_res || jsonb_build_object('request_id', p_request_id, 'status', 'confirmed', 'correction_status', v_req.requested_status);
end;
$$;

-- 5. One voiding trigger function for both tables ----------------------------------------------------------------------------------------
create function private.void_pending_record_requests() returns trigger
language plpgsql security definer set search_path = '' as
$$
declare
  r record;
begin
  if coalesce(nullif(current_setting('app.record_request_confirming', true), ''), 'off') = 'on' then return null; end if;
  for r in select id, organisation_id from public.patient_allergy_correction_requests
            where record_table = tg_table_name and coalesce(allergy_id, condition_id) = new.id and status = 'pending' for update loop
    update public.patient_allergy_correction_requests set status = 'void', decided_at = now(), decision_note = 'entry already changed' where id = r.id;
    insert into public.patient_allergy_correction_events (request_id, organisation_id, event, actor_role, note)
    values (r.id, r.organisation_id, 'void', 'system', 'entry already changed');
  end loop;
  return null;
end;
$$;
revoke all on function private.void_pending_record_requests() from public, anon, authenticated;
drop trigger z_void_pending_allergy_requests on public.patient_allergies;
create trigger z_void_pending_allergy_requests after update of correction_status on public.patient_allergies
  for each row when (old.correction_status is null and new.correction_status is not null)
  execute function private.void_pending_record_requests();
create trigger z_void_pending_condition_requests after update of correction_status on public.patient_conditions
  for each row when (old.correction_status is null and new.correction_status is not null)
  execute function private.void_pending_record_requests();
drop function private.void_pending_allergy_requests();

-- 6. The resubmit limit counts per record, whichever table ------------------------------------------------------------------------------
create or replace function private.patient_allergy_request_rate_limit() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  -- one request at a time per record while counting, so two quick taps cannot both slip under the limit
  perform pg_advisory_xact_lock(hashtextextended('record_request_rate:' || coalesce(new.allergy_id, new.condition_id)::text, 0));
  if (select count(*) from public.patient_allergy_correction_requests r
       where coalesce(r.allergy_id, r.condition_id) = coalesce(new.allergy_id, new.condition_id)
         and r.status <> 'void' and r.created_at > now() - interval '7 days') >= 3 then
    raise exception 'You have asked about this entry a few times this week. Please message your care team about it instead, and they will help.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

-- 7. The patient's own export lists condition requests too ----------------------------------------------------------------------------
create or replace function public.my_corrected_record_entries(p_patient uuid default null) returns jsonb
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
  -- her own correction requests, allergies and conditions (safe columns only: no clinician note or identity)
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'record_table', r.record_table, 'allergy_id', r.allergy_id, 'condition_id', r.condition_id,
                                               'requested_status', r.requested_status, 'reason', r.reason,
                                               'replacement', r.replacement, 'status', r.status, 'decided_at', r.decided_at, 'created_at', r.created_at)
                            order by r.created_at), '[]'::jsonb)
    into v_rows from public.patient_allergy_correction_requests r where r.patient_id = v_uid;
  v_out := v_out || jsonb_build_object('patient_allergy_correction_requests', v_rows);
  return v_out;
end;
$$;

-- 8. S39d registry: the row is unchanged (still not in the registry export); say what the table now holds ---------------------------------
update public.data_registry
   set notes = 'Registered when the allergy correction requests were added (S05b-d); since S05b-f it holds condition requests too (record_table). in_export is false on purpose (clinician note and identity); the patient''s own requests, safe columns only, are in my_corrected_record_entries; awaiting review.'
 where table_name = 'patient_allergy_correction_requests';

-- 9. The audited chart reader must show CURRENT entries only ----------------------------------------------------------------------------
-- read_patient_chart_audited is a definer function (owner postgres, BYPASSRLS), so the restrictive "hide superseded" policy of S05b-c does not
-- apply to what it reads through public.allergies and public.conditions: found while proving this change, a clinician would have been shown
-- the original AND its replacement after a confirmation. The queue screen takes the current record of a request from this reader, so both
-- views now carry the predicate themselves (same columns in the same order, so existing callers and grants are untouched).
create or replace view public.conditions with (security_invoker = true) as
select
  c.id,
  c.organisation_id,
  c.patient_id,
  c.icd10_code as code,
  c.condition_name as display,
  c.status,
  c.recorded_by,
  (c.diagnosing_clinician_id is not null) as verified_by_clinician,
  c.source,
  c.created_at,
  c.next_review_due_at,
  c.last_reviewed_at,
  c.date_identified
from public.patient_conditions c
where c.correction_status is null;
create or replace view public.allergies with (security_invoker = true) as
select
  a.id,
  a.organisation_id,
  a.patient_id,
  a.allergen as substance,
  a.reaction,
  a.severity,
  a.verification_status,
  a.recorded_by,
  a.created_at,
  a.source,
  a.noted_at
from public.patient_allergies a
where a.correction_status is null;

-- 10. Self-check -----------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  if position('correction_status' in pg_get_viewdef('public.conditions'::regclass)) = 0
     or position('correction_status' in pg_get_viewdef('public.allergies'::regclass)) = 0 then
    raise exception 'S05b-f self-check: a chart view still returns superseded entries';
  end if;
  select pg_get_functiondef(p.oid) into v_def from pg_proc p where p.proname = 'correct_clinical_value' and p.pronamespace = 'public'::regnamespace;
  if position('request_patient_record_correction' in v_def) = 0 or position('request_patient_allergy_correction' in v_def) > 0
     or position('diagnosing_clinician_id' in v_def) = 0 then
    raise exception 'S05b-f self-check: correct_clinical_value was not patched';
  end if;
  if exists (select 1 from pg_proc where proname in ('request_patient_allergy_correction', 'void_pending_allergy_requests') and pronamespace = 'private'::regnamespace) then
    raise exception 'S05b-f self-check: an old allergy-only function is still there';
  end if;
  if has_function_privilege('anon', 'private.request_patient_record_correction(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.request_patient_record_correction(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'private.void_pending_record_requests()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.void_pending_record_requests()', 'EXECUTE') then
    raise exception 'S05b-f self-check: a private function is executable by a client role';
  end if;
  if has_function_privilege('anon', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.correct_clinical_value(text, uuid, public.correction_status, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_patient_allergy_correction(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.confirm_patient_allergy_correction(uuid, text)', 'EXECUTE') then
    raise exception 'S05b-f self-check: a grant changed (correct_clinical_value or confirm)';
  end if;
  if (select count(*) from pg_trigger where tgname in ('z_void_pending_allergy_requests', 'z_void_pending_condition_requests')
        and tgfoid = 'private.void_pending_record_requests()'::regprocedure) <> 2 then
    raise exception 'S05b-f self-check: a voiding trigger is missing';
  end if;
  if has_table_privilege('authenticated', 'public.patient_allergy_correction_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.patient_allergy_correction_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.patient_allergy_correction_requests', 'DELETE') then
    raise exception 'S05b-f self-check: the request table became writable by authenticated';
  end if;
  if not exists (select 1 from public.minor_dependant_table_policy where table_name = 'patient_allergy_correction_requests' and policy = 'guarded') then
    raise exception 'S05b-f self-check: the request table lost its minor-dependant guard';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'patient_allergy_correction_requests' and in_export = false) then
    raise exception 'S05b-f self-check: the request table is exported whole by the registry export';
  end if;
end $$;

-- S09y: My Health gaps (docs/design/S09y.md). Additive. Not applied to production by the session that wrote it (merge applies it).
--
-- (1) Emergency card: optional HMO / NHIA member number and plan name. The patient types them; they show on the printed card and the live emergency
--     view ONLY when filled. Same provenance idea as the blood group and genotype: a fixed source ('patient_entered'), the actor is the server's
--     auth.uid() (never a client value), every save is audited (field names only, never the number). The lock-screen payload
--     (public.my_lock_screen_facts) is NOT touched: its governed field list is awaiting CMO sign-off, and a proof check below confirms it never
--     mentions cover.
-- (2) Outside records: a patient photo or file from another hospital already lands in public.patient_documents (private bucket, 10 MB, image/PDF
--     only, patient-folder policies, S39c audited staff open). What was missing was the verification step. Each patient-supplied document now has a
--     verification_status: 'unchecked' (default; "supplied by you, not yet checked"), 'verified' or 'not_verified', decided ONLY by a clinical-tier
--     doctor through public.verify_outside_record (server-derived reviewed_by / reviewed_at, audited, care-tie gate). Nothing in this table is ever
--     copied into a structured clinical table, by anyone or anything (INV-01, INV-11: no OCR write), so an unchecked document never "enters the
--     record"; the FHIR export lists it with its status. The clinician queue is the existing public.clinical_worklist() with one more kind.
-- LIVE COUNT BEFORE (2026-10-20): patient_documents 0 rows, so no data conversion exists. emergency_cards untouched.

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 1. Emergency card cover
-- ---------------------------------------------------------------------------------------------------------------------------------------------
create table public.emergency_card_coverage (
  patient_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  scheme           text not null check (scheme in ('hmo', 'nhia')),
  member_number    text check (member_number is null or (char_length(member_number) between 3 and 40 and member_number ~ '^[A-Za-z0-9][A-Za-z0-9 /._-]*$')),
  plan_name        text check (plan_name is null or (char_length(plan_name) between 2 and 80 and plan_name !~ '[[:cntrl:]<>]')),
  -- provenance: the patient typed it; nothing checked it against a scheme. The card says so.
  provenance       text not null default 'patient_entered' check (provenance = 'patient_entered'),
  entered_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint emergency_card_coverage_not_empty check (member_number is not null or plan_name is not null)
);
alter table public.emergency_card_coverage enable row level security;
create policy emergency_card_coverage_own_select on public.emergency_card_coverage
  for select to authenticated using (patient_id = (select auth.uid()));
-- reads only for the patient; the RPC below is the one door for writes (a default privilege may have granted more, so revoke explicitly)
grant select on public.emergency_card_coverage to authenticated;
revoke insert, update, delete, truncate, references, trigger on public.emergency_card_coverage from authenticated;
revoke all on public.emergency_card_coverage from anon;
create trigger emergency_card_coverage_set_updated_at before update on public.emergency_card_coverage
  for each row execute function private.set_updated_at();

create function public.set_emergency_card_coverage(p_scheme text, p_member_number text, p_plan_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_member text := nullif(btrim(coalesce(p_member_number, '')), '');
  v_plan text := nullif(btrim(coalesce(p_plan_name, '')), '');
begin
  if v_uid is null then raise exception 'sign in to save this' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = v_uid and role = 'patient' and is_active;
  if v_org is null then raise exception 'only a patient can save cover on their own card' using errcode = '42501'; end if;

  if v_member is null and v_plan is null then
    -- both blank = remove it from the card
    delete from public.emergency_card_coverage where patient_id = v_uid;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (v_org, v_uid, 'emergency_card_coverage.cleared', 'emergency_card_coverage', v_uid, jsonb_build_object('cleared', true));
    return jsonb_build_object('status', 'cleared');
  end if;
  if p_scheme is null or p_scheme not in ('hmo', 'nhia') then raise exception 'choose HMO or NHIA' using errcode = '22023'; end if;
  if v_member is not null and (char_length(v_member) not between 3 and 40 or v_member !~ '^[A-Za-z0-9][A-Za-z0-9 /._-]*$') then
    raise exception 'that member number does not look right' using errcode = '22023';
  end if;
  if v_plan is not null and (char_length(v_plan) not between 2 and 80 or v_plan ~ '[[:cntrl:]<>]') then
    raise exception 'that plan name does not look right' using errcode = '22023';
  end if;

  insert into public.emergency_card_coverage (patient_id, organisation_id, scheme, member_number, plan_name, entered_by)
  values (v_uid, v_org, p_scheme, v_member, v_plan, v_uid)
  on conflict (patient_id) do update
    set scheme = excluded.scheme, member_number = excluded.member_number, plan_name = excluded.plan_name, entered_by = excluded.entered_by;
  -- the audit row names which fields are set, never their values
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (v_org, v_uid, 'emergency_card_coverage.saved', 'emergency_card_coverage', v_uid,
          jsonb_build_object('scheme', p_scheme, 'has_member_number', v_member is not null, 'has_plan_name', v_plan is not null));
  return jsonb_build_object('status', 'saved');
end;
$$;
revoke all on function public.set_emergency_card_coverage(text, text, text) from public;
grant execute on function public.set_emergency_card_coverage(text, text, text) to authenticated;

-- The live card wrapper, started from its live body (not from a file): add the cover, only when filled.
do $$
declare
  v_def text := pg_get_functiondef('public.emergency_card_by_token(text)'::regprocedure);
  v_new text;
begin
  v_new := replace(v_def, 'v_total integer; v_kept jsonb;', 'v_total integer; v_kept jsonb; cov public.emergency_card_coverage%rowtype;');
  v_new := replace(v_new, $a$return v_full || jsonb_build_object('hidden_fields', to_jsonb(v_hidden));$a$,
$b$select * into cov from public.emergency_card_coverage where patient_id = v_patient;
  if found and (cov.member_number is not null or cov.plan_name is not null) then
    v_full := v_full || jsonb_build_object('coverage', jsonb_build_object(
      'scheme', cov.scheme, 'member_number', cov.member_number, 'plan_name', cov.plan_name, 'provenance', cov.provenance));
  end if;
  return v_full || jsonb_build_object('hidden_fields', to_jsonb(v_hidden));$b$);
  if v_new = v_def or position('emergency_card_coverage%rowtype' in v_new) = 0 or position('''coverage''' in v_new) = 0 then
    raise exception 'S09y: the live emergency_card_by_token body did not have the expected shape; nothing was changed';
  end if;
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 2. Outside records: verification
-- ---------------------------------------------------------------------------------------------------------------------------------------------
alter table public.patient_documents
  add column verification_status text not null default 'unchecked'
    check (verification_status in ('unchecked', 'verified', 'not_verified', 'not_applicable'));
alter table public.patient_documents
  add constraint patient_documents_verification_stamp check ((verification_status in ('verified', 'not_verified')) = (reviewed_at is not null));

-- A document the patient supplied is 'unchecked'; one that a clinician or a laboratory filed is not "supplied" and needs no check.
create function private.patient_documents_verification_on_insert() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  new.verification_status := case when new.source = 'patient' then 'unchecked' else 'not_applicable' end;
  return new;
end $$;
create trigger patient_documents_verification_insert before insert on public.patient_documents
  for each row execute function private.patient_documents_verification_on_insert();

-- The status moves only through public.verify_outside_record (which sets a transaction-local marker naming this one document), only once, only for
-- a patient-supplied document. This is a second lock behind RLS (there is no UPDATE policy on the table at all).
create function private.patient_documents_verification_guard() returns trigger
language plpgsql security definer set search_path = '' as
$$
begin
  if new.verification_status is distinct from old.verification_status then
    if current_setting('tarragon.verifying_document', true) is distinct from old.id::text
       or old.source <> 'patient' or old.verification_status <> 'unchecked'
       or new.verification_status not in ('verified', 'not_verified') then
      raise exception 'a document is checked only by a clinician, once' using errcode = '42501';
    end if;
  elsif old.verification_status in ('verified', 'not_verified') and new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'a check cannot be changed' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger patient_documents_verification_guard before update on public.patient_documents
  for each row execute function private.patient_documents_verification_guard();

create function public.verify_outside_record(p_document uuid, p_outcome text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.patient_documents%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  if p_outcome is null or p_outcome not in ('verified', 'not_verified') then raise exception 'outcome must be verified or not_verified' using errcode = '22023'; end if;
  if v_note is not null and char_length(v_note) > 500 then raise exception 'note is too long' using errcode = '22023'; end if;
  if p_outcome = 'not_verified' and v_note is null then raise exception 'say briefly why this could not be checked' using errcode = '22023'; end if;

  select * into d from public.patient_documents where id = p_document for update;
  if d.id is null then raise exception 'not found' using errcode = 'P0002'; end if;
  -- a clinical-tier doctor of the patient's organisation, never the patient themself, never a care coordinator
  if not private.is_clinical_tier(d.organisation_id) or d.patient_id = v_uid then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  if d.source <> 'patient' then raise exception 'this document was not supplied by the patient' using errcode = '22023'; end if;
  if d.verification_status <> 'unchecked' then raise exception 'this document has already been checked' using errcode = '22023'; end if;
  -- the care tie itself (S39b/S39c), not the broader read gate: emergency access (break-glass) and a support-view session can READ a record but must
  -- never attest "checked by Dr X" for a patient they are not treating. Without the tie the refusal is audited, and nothing changes
  -- (returned, not raised: a raise would roll the denied-read audit row back with it)
  if not private.clinician_has_patient_access(d.patient_id) then
    perform private.audit_denied_read('staff.outside_record_verify', 'patient_documents', d.patient_id, 'Verifying an outside record the patient supplied');
    return jsonb_build_object('status', 'refused');
  end if;

  perform set_config('tarragon.verifying_document', d.id::text, true);
  -- reviewed_at only has to be non-null: the existing update guard stamps reviewed_by = auth.uid() and reviewed_at = now() itself
  update public.patient_documents
     set verification_status = p_outcome, reviewed_at = now(), review_note = v_note
   where id = d.id;
  perform set_config('tarragon.verifying_document', '', true);
  perform private.audit_patient_read(d.patient_id, 'patient_documents', d.id, 'Verifying an outside record the patient supplied',
                                     case p_outcome when 'verified' then 'staff.outside_record_verified' else 'staff.outside_record_not_verified' end);
  return jsonb_build_object('status', p_outcome);
end;
$$;
revoke all on function public.verify_outside_record(uuid, text, text) from public;
grant execute on function public.verify_outside_record(uuid, text, text) to authenticated;

-- Opening one outside record to check it: the care-tie gate, one audited read, and the few facts the check page needs. The file itself is signed by the
-- server afterwards (the bucket has no staff policy). A refusal is RETURNED so its denied-read audit row is not rolled back with an exception.
create function public.open_outside_record_for_check(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  d public.patient_documents%rowtype;
  v_name text;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into d from public.patient_documents where id = p_document;
  if d.id is null or d.source <> 'patient' then return jsonb_build_object('status', 'not_found'); end if;
  if not private.is_clinical_tier(d.organisation_id) or d.patient_id = v_uid then raise exception 'not authorised' using errcode = '42501'; end if;
  if not private.can_staff_read_clinical(d.patient_id, 'medical_history') then
    perform private.audit_denied_read('staff.outside_record_open', 'patient_documents', d.patient_id, 'Opening an outside record the patient supplied, to check it');
    return jsonb_build_object('status', 'refused');
  end if;
  perform private.audit_patient_read(d.patient_id, 'patient_documents', d.id, 'Opening an outside record the patient supplied, to check it', 'staff.outside_record_open');
  select full_name into v_name from public.profiles where id = d.patient_id;
  return jsonb_build_object('status', 'ok', 'path', d.file_path, 'patient_id', d.patient_id, 'patient_name', v_name,
    'document_type', d.document_type::text, 'original_filename', d.original_filename, 'mime_type', d.mime_type,
    'document_date', d.document_date, 'uploaded_at', d.created_at, 'verification_status', d.verification_status);
end;
$$;
revoke all on function public.open_outside_record_for_check(uuid) from public;
grant execute on function public.open_outside_record_for_check(uuid) to authenticated;

-- The staff chart view carries the status (a column added at the end keeps the view valid; security_invoker stays on).
create or replace view public.documents with (security_invoker = true) as
  select id, organisation_id, patient_id, document_type as kind, file_path as storage_path, uploaded_by,
         (case source when 'patient'::public.patient_document_source then 'patient'::text
                      when 'lab_liaison'::public.patient_document_source then 'partner'::text
                      when 'clinician'::public.patient_document_source then 'clinician'::text
                      when 'admin'::public.patient_document_source then 'system'::text
                      else null::text end)::public.record_source as source,
         document_date, created_at, verification_status
    from public.patient_documents d;

-- Timeline: the title no longer says "added to your record" for a file the patient supplied. The title carries no checked / not-checked claim (the
-- timeline is append-only, so such a claim would go stale the moment a doctor checks it); the status lives on the document row. Files filed by a
-- clinician, laboratory or admin keep the old title.
do $$
declare
  v_def text := pg_get_functiondef('private.timeline_from_patient_document()'::regprocedure);
  v_new text := replace(v_def, $a$'Document added to your record'$a$, $b$case when new.source = 'patient' then 'Document you supplied' else 'Document added to your record' end$b$);
begin
  if v_new = v_def then raise exception 'S09y: timeline_from_patient_document did not have the expected title'; end if;
  execute v_new;
end $$;

-- FHIR export: the document list says which ones a clinician checked.
do $$
declare
  v_def text := pg_get_functiondef('public.fhir_export_snapshot(uuid,text[],text)'::regprocedure);
  v_new text := replace(v_def, 'mime_type, source::text as source, created_at', 'mime_type, source::text as source, verification_status, created_at');
begin
  if v_new = v_def then raise exception 'S09y: fhir_export_snapshot did not have the expected document list'; end if;
  execute v_new;
end $$;

-- The clinician queue: one more kind in the existing shared worklist and its organisation totals.
do $$
declare
  v_def text := pg_get_functiondef('public.clinical_worklist()'::regprocedure);
  v_new text := replace(v_def, E'\n  ), ranked as (',
    E'\n    union all\n    select ''outside_records'', o.id, o.patient_id, ''Outside record to check'', o.created_at\n      from public.patient_documents o where o.organisation_id = v_org and o.source = ''patient'' and o.verification_status = ''unchecked''\n  ), ranked as (');
  v_cdef text := pg_get_functiondef('public.org_open_work_counts()'::regprocedure);
  v_cnew text := replace(v_cdef, 'union all select ''async_consults''',
    'union all select ''outside_records'', count(*) from public.patient_documents where organisation_id = v_org and source = ''patient'' and verification_status = ''unchecked''' || E'\n    union all select ''async_consults''');
  v_new2 text;
  v_cnew2 text;
begin
  if v_new = v_def or v_cnew = v_cdef then raise exception 'S09y: the worklist functions did not have the expected shape'; end if;
  -- A care coordinator is non-clinical (logistics only) and gets no clinical reads. The S39e header says the worklist refuses a coordinator, but the live
  -- body only checked for an active clinical_staff row, which a coordinator also has. Close it here, for the list and for the totals.
  v_new2 := replace(v_new, 'where cs.profile_id = (select auth.uid()) and cs.active) then', 'where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier <> ''care_coordinator'') then');
  v_cnew2 := replace(v_cnew, 'where cs.profile_id = p.id and cs.active)', 'where cs.profile_id = p.id and cs.active and cs.doctor_tier <> ''care_coordinator'')');
  if v_new2 = v_new or v_cnew2 = v_cnew then raise exception 'S09y: the worklist guards did not have the expected shape; nothing was changed'; end if;
  execute v_new2;
  execute v_cnew2;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 3. Data registry (S39d): both new facts are patient-keyed
-- ---------------------------------------------------------------------------------------------------------------------------------------------
insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, notes)
values ('emergency_card_coverage', 'patient_id', private.retention_class_for('emergency_card_coverage'),
        case when private.retention_class_for('emergency_card_coverage') = 'operational' then 'delete' else 'review' end, true,
        'S09y 2026-10-20: PROPOSED, to be confirmed by the CMO and DPO. Patient-typed HMO / NHIA member number and plan name for the emergency card.')
on conflict (table_name) do nothing;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- 4. Closing assertions
-- ---------------------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.set_emergency_card_coverage(text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.verify_outside_record(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.open_outside_record_for_check(uuid)', 'EXECUTE') then
    raise exception 'S09y: anon can execute a new function';
  end if;
  if not has_function_privilege('authenticated', 'public.set_emergency_card_coverage(text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.verify_outside_record(uuid,text,text)', 'EXECUTE') then
    raise exception 'S09y: authenticated cannot execute a new function';
  end if;
  if has_table_privilege('authenticated', 'public.emergency_card_coverage', 'INSERT') or has_table_privilege('authenticated', 'public.emergency_card_coverage', 'UPDATE')
     or has_table_privilege('authenticated', 'public.emergency_card_coverage', 'DELETE') or has_table_privilege('anon', 'public.emergency_card_coverage', 'SELECT') then
    raise exception 'S09y: emergency_card_coverage is writable by clients or readable by anon';
  end if;
  if not has_table_privilege('authenticated', 'public.emergency_card_coverage', 'SELECT') then
    raise exception 'S09y: the patient cannot read their own cover row';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'patient_documents' and cmd in ('UPDATE', 'ALL')) then
    raise exception 'S09y: patient_documents gained an UPDATE policy; the verification status must stay behind the RPC';
  end if;
  if position('coverage' in pg_get_functiondef('public.my_lock_screen_facts()'::regprocedure)) > 0 then
    raise exception 'S09y: the lock-screen payload must not mention cover (its field list is awaiting CMO sign-off)';
  end if;
  if position('emergency_card_coverage' in pg_get_functiondef('public.emergency_card_by_token(text)'::regprocedure)) = 0 then
    raise exception 'S09y: the live card wrapper does not read cover';
  end if;
  if position('outside_records' in pg_get_functiondef('public.clinical_worklist()'::regprocedure)) = 0
     or position('outside_records' in pg_get_functiondef('public.org_open_work_counts()'::regprocedure)) = 0 then
    raise exception 'S09y: the worklist functions do not carry the new queue';
  end if;
  if not exists (select 1 from public.data_registry where table_name = 'emergency_card_coverage') then
    raise exception 'S09y: emergency_card_coverage is not in the data registry';
  end if;
end $$;

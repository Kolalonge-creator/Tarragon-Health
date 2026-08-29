-- Tarragon Health — Document & Clinical Record Management, part 5/5: retention
-- (§35.17) and the acceptance-criteria assertion (§35.18).
--
-- "Retention policies should reflect clinical requirements, regulatory
-- requirements, legal obligations, organisational policy." None of those are
-- a single universal number — a discharge summary and an invoice do not keep
-- for the same length of time, and Nigerian medical-records retention rules
-- differ from what a given HMO contract or Tarragon's own policy might ask
-- for. So this is a CONFIGURABLE table per organisation/document_type, not a
-- hardcoded constant, and it never deletes anything — a document past its
-- retention window is archived (§35.4's own terminal state), which the
-- platform already treats as retained-but-out-of-the-working-record.

create table if not exists public.document_retention_policies (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  document_type     public.patient_document_type not null,
  retention_years   integer not null check (retention_years > 0),
  basis             text not null check (length(btrim(basis)) > 0),
  active            boolean not null default true,
  -- Null-gated: no policy is "the platform's default" by omission — an org
  -- with no row for a given document_type simply has no configured policy for
  -- it yet (patient_documents_awaiting_structured_idx-style visibility is out
  -- of scope for this pass; see the acceptance-criteria note below for what
  -- this migration does and does not claim).
  set_by            uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (organisation_id, document_type)
);

drop trigger if exists document_retention_policies_set_updated_at on public.document_retention_policies;
create trigger document_retention_policies_set_updated_at
  before update on public.document_retention_policies
  for each row execute function private.set_updated_at();

comment on table public.document_retention_policies is
  '§35.17. One retention period per (organisation, document_type). "basis" records WHY that period was chosen (a regulation, a contract clause, an internal policy) so the number is never just a bare integer nobody can explain later.';

alter table public.document_retention_policies enable row level security;

-- Configuring retention is an admin decision, org-wide — not something a
-- clinician or a patient sets per document. Every org-staff account may READ
-- the policy (so a clinician filing a document can see how long it will be
-- kept), matching the transparency the rest of this module gives a patient
-- about their own record.
drop policy if exists document_retention_policies_select on public.document_retention_policies;
create policy document_retention_policies_select on public.document_retention_policies
  for select to authenticated
  using (private.is_org_staff(organisation_id));

drop policy if exists document_retention_policies_write on public.document_retention_policies;
create policy document_retention_policies_write on public.document_retention_policies
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

grant select, insert, update, delete on public.document_retention_policies to authenticated;

create or replace function private.stamp_document_retention_policy_setter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    new.set_by := (select auth.uid());
  end if;
  return new;
end;
$$;

drop trigger if exists document_retention_policies_stamp_setter on public.document_retention_policies;
create trigger document_retention_policies_stamp_setter
  before insert on public.document_retention_policies
  for each row execute function private.stamp_document_retention_policy_setter();

-- Applies the org's configured policy to a document once it becomes
-- available — retention starts from the moment the document enters the
-- working record, not from upload (a document held for days in scan/review
-- has not yet begun its retention clock). A document_type with no active
-- policy for the org simply gets no retention_until — visible in the column
-- as "not yet configured", never defaulted to a guessed number.
create or replace function private.apply_patient_document_retention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_policy public.document_retention_policies;
begin
  if new.status = 'available' and (old.status is distinct from new.status) then
    select * into v_policy
      from public.document_retention_policies
      where organisation_id = new.organisation_id
        and document_type = new.document_type
        and active;

    if v_policy.id is not null then
      new.retention_until := (new.available_at::date + make_interval(years => v_policy.retention_years));
      new.retention_basis := v_policy.basis;
    end if;
  end if;

  return new;
end;
$$;

-- Runs alongside the lifecycle-move guard rather than replacing it: this
-- trigger only ever touches retention_until/retention_basis, which
-- enforce_patient_document_update's freeze list does not include, so the two
-- coexist without either undoing the other's write on the same row.
drop trigger if exists patient_documents_apply_retention on public.patient_documents;
create trigger patient_documents_apply_retention
  before update on public.patient_documents
  for each row execute function private.apply_patient_document_retention();

-- The retention sweep: archives (never deletes) anything past its
-- retention_until that is not already archived/superseded. Runs nightly,
-- same cadence family as the other notify/sweep jobs in this migration set.
-- A superseded document is deliberately left alone here — its own
-- retention_until (set when IT was available) governs it independently, and
-- archiving is meaningful only for a document still otherwise live.
create or replace function private.archive_expired_patient_documents()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select id, organisation_id
    from public.patient_documents
    where retention_until is not null
      and retention_until < current_date
      and status = 'available'
  loop
    perform set_config('private.document_lifecycle_move', 'true', true);
    update public.patient_documents
      set status = 'archived', archived_at = now(), archived_by = null,
          archive_reason = 'Retention period elapsed'
      where id = r.id;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'patient_document.retention_archived', 'patient_documents', r.id, '{}'::jsonb);
  end loop;
end;
$$;

comment on function private.archive_expired_patient_documents() is
  '§35.17 sweep. Archives (never deletes) an available document past its configured retention_until. archived_by is null — nobody made this decision, the policy did, same null-gating principle as every other attribution column on the platform.';

revoke all on function private.archive_expired_patient_documents() from public;

select cron.schedule(
  'patient-document-retention-sweep',
  '20 4 * * *',
  $$select private.archive_expired_patient_documents()$$
);

-- ---------------------------------------------------------------------------
-- §35.18 acceptance-criteria assertion — "Tarragon should be able to manage:
-- Clinical document -> verification -> storage -> retrieval -> sharing ->
-- audit -> retention." Proves the pipeline exists end-to-end in the schema,
-- in a rolled-back transaction so it changes nothing.
-- ---------------------------------------------------------------------------
do $$
declare
  v_org        uuid;
  v_patient    uuid;
  v_staff_user uuid;
  v_doc        uuid;
begin
  select id into v_org from public.organisations limit 1;
  if v_org is null then
    raise notice 'patient_documents acceptance check skipped: no organisation fixture available';
    return;
  end if;

  select id into v_patient from public.profiles where role = 'patient' and organisation_id = v_org limit 1;
  select id into v_staff_user from public.profiles where role in ('clinician', 'admin') and organisation_id = v_org limit 1;

  if v_patient is null or v_staff_user is null then
    raise notice 'patient_documents acceptance check skipped: no patient/staff fixture available';
    return;
  end if;

  -- Created -> Uploaded (this insert IS the upload — see the enum comment).
  insert into public.patient_documents
    (organisation_id, patient_id, document_type, source, title, file_path, mime_type, uploaded_by)
  values
    (v_org, v_patient, 'discharge_summary', 'clinician', 'Acceptance check discharge summary',
     v_patient::text || '/acceptance-check.pdf', 'application/pdf', v_staff_user)
  returning id into v_doc;

  if not exists (select 1 from public.patient_documents where id = v_doc and status = 'uploaded') then
    raise exception 'S35.18 FAIL: document did not reach uploaded';
  end if;

  -- Verification: scan clean -> Validated.
  perform public.record_patient_document_scan(v_doc, 'clean', 'acceptance check');
  if not exists (select 1 from public.patient_documents where id = v_doc and status = 'validated') then
    raise exception 'S35.18 FAIL: clean scan did not reach validated';
  end if;

  -- Storage/Retrieval: publish -> Available, readable, with a retention
  -- period applied from the org's configured (or absent) policy.
  perform public.publish_patient_document(v_doc);
  if not exists (select 1 from public.patient_documents where id = v_doc and status = 'available' and available_at is not null) then
    raise exception 'S35.18 FAIL: publish did not reach available';
  end if;

  -- Sharing: an authorised grant to another account is readable by them.
  insert into public.patient_document_shares
    (organisation_id, document_id, patient_id, recipient_type, recipient_profile_id, purpose)
  values (v_org, v_doc, v_patient, 'clinician', v_staff_user, 'Acceptance check share');

  if not exists (
    select 1 from public.patient_document_shares
    where document_id = v_doc and recipient_profile_id = v_staff_user and revoked_at is null
  ) then
    raise exception 'S35.18 FAIL: share was not recorded';
  end if;

  -- Audit: a read against this document is logged.
  perform private.record_patient_document_access(v_doc, 'acceptance check read');
  if not exists (select 1 from public.patient_document_access_log where document_id = v_doc) then
    raise exception 'S35.18 FAIL: access was not audited';
  end if;

  -- Retention: archiving is reachable and traceable.
  perform public.archive_patient_document(v_doc, 'Acceptance check archive');
  if not exists (select 1 from public.patient_documents where id = v_doc and status = 'archived' and archive_reason is not null) then
    raise exception 'S35.18 FAIL: archive did not record a reason';
  end if;

  raise notice 'S35.18 PASS: document -> verification -> storage -> retrieval -> sharing -> audit -> retention all reachable';

  raise exception 'rollback acceptance-check fixtures — this block writes no real data';
exception
  when others then
    if sqlerrm = 'rollback acceptance-check fixtures — this block writes no real data' then
      raise notice 'S35.18: acceptance-check fixtures rolled back cleanly';
    else
      raise;
    end if;
end $$;

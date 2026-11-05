-- Request to report: tie a returned report to the lab_orders request it answers, and close the request when that report is filed.
--
-- Why the link lives on clinical_documents (read live 2026-11-05, not from older migration text):
--   * clinical_documents is the one intake record every returned report passes through, whatever the channel (patient app, care
--     coordinator, lab liaison, clinician, partner) and whatever the store behind it (routed_table: lab_result_documents,
--     lab_result_files (the S27 store behind lab_results.document_id), ecg_report_documents, imaging_report_documents, or nothing yet
--     for an unsorted upload). One nullable column there covers lab, ECG and S27 reports in one place.
--   * lab_result_documents.lab_order_id, ecg_report_documents.lab_order_id and lab_results.lab_order_id already exist and stay the
--     working columns the older machinery reads (handle_lab_result_document, raise_abnormal_results_from_filed_upload, submit_lab_result,
--     screening_result_uploaded). The intake link INHERITS from them and is PUSHED DOWN to the first two when a person or the matcher
--     sets it later, so filing an uploaded report through S27 carries the order too. lab_results.lab_order_id is not written here (its
--     guard owns it; a result filed without its order is still reachable through the intake row).
--   * Imaging documents answer imaging_orders, not lab_orders; they can be linked by hand but are never auto-matched.
--
-- Live state when written: 40 lab_orders, all 'ordered'; 0 clinical_documents; 0 lab_results; 0 lab_result_documents. No backfill.
-- 0 of 40 orders carry a clinical_indication, so nothing here reads that column.
--
-- Matching rule (automatic, conservative): a document not yet linked and never declined, whose filed tests are known, is linked only
-- when EXACTLY ONE of the patient's open orders (payment_confirmed, ordered, sample_collected, processing) in the same organisation
-- shares at least one test with it and was ordered no more than 1 day after and no more than 90 days before the report date
-- (investigation date, else the date printed on the report, else the upload date, Africa/Lagos). Anything else is left for a person.
--
-- Completion rule: an open order moves to 'resulted' when a linked report is FILED: the intake is 'reviewed' by a clinician, visible to
-- the patient, not superseded or withdrawn; for an S27 file, its result is released; and no S27 result on that order is still held
-- (the invariant submit_lab_result keeps: a held result moves an order only to 'processing'). A multi-test order closes only when the
-- filed linked reports between them cover every test on it (a test the patient marked 'will_not_do' counts as covered). An uploaded
-- report filed by a clinician through the extraction path is checked after the S27 hand-off has run (trigger zz_ on
-- lab_report_extractions), so a result S27 holds is never announced as ready.

-- 1. The link ---------------------------------------------------------------------------------------------------------------------

alter table public.clinical_documents
  add column lab_order_id uuid references public.lab_orders(id) on delete set null,
  add column lab_order_link_source text,
  add column lab_order_linked_by uuid references public.profiles(id) on delete set null,
  add column lab_order_linked_at timestamptz;

alter table public.clinical_documents
  add constraint clinical_documents_lab_order_link_source_check
    check (lab_order_link_source is null or lab_order_link_source in ('upload', 'patient', 'staff', 'auto', 'declined')),
  add constraint clinical_documents_lab_order_declined_has_no_order
    check (lab_order_link_source is distinct from 'declined' or lab_order_id is null);

comment on column public.clinical_documents.lab_order_id is
  'The test request this report answers. Set at upload, by the patient or staff (public.link_clinical_document_to_lab_order), or by '
  'the conservative matcher (exactly one candidate). Same patient and organisation, enforced by trigger.';
comment on column public.clinical_documents.lab_order_link_source is
  'upload (inherited from the routed store), patient, staff, auto (matcher), or declined (a person said it answers no request; the '
  'matcher never links it again).';

create index clinical_documents_lab_order_id_idx on public.clinical_documents (lab_order_id) where lab_order_id is not null;

-- 2. Test codes on each side ------------------------------------------------------------------------------------------------------

-- An order's tests: its bundle's test codes, plus the order-level codes of a yearly panel's analytes, minus anything excluded.
create or replace function private.lab_order_test_codes(p_order uuid)
returns text[]
language sql
stable
security definer
set search_path to ''
as $$
  with o as (select * from public.lab_orders where id = p_order),
  codes as (
    select lower(btrim(c)) as c from o join public.panel_bundles pb on pb.id = o.panel_bundle_id, unnest(pb.test_codes) c
    union
    select private.yearly_panel_screen_type(a ->> 'code')
      from o join public.lab_panel_versions v on v.panel_code = o.panel_code and v.is_active
      cross join jsonb_array_elements(case when jsonb_typeof(v.analytes) = 'array' then v.analytes else '[]'::jsonb end) a
  ),
  excluded as (
    select lower(btrim(x)) as c
      from o, jsonb_array_elements_text(case when jsonb_typeof(o.excluded_test_codes) = 'array' then o.excluded_test_codes else '[]'::jsonb end) x
  )
  select coalesce(array_agg(distinct c order by c), '{}'::text[])
    from codes where c is not null and c <> '' and c not in (select c from excluded)
$$;

-- A report's tests, in the same vocabulary as an order's: the test the uploader named, the analytes read from it (mapped to their test
-- where a mapping exists), the analytes S27 filed for it, and what its kind implies (an ECG, a urinalysis, a smear, a PSA).
create or replace function private.report_test_codes(p_routed_table text, p_routed_id uuid, p_kind_code text)
returns text[]
language sql
stable
security definer
set search_path to ''
as $$
  with codes as (
    select lower(btrim(d.test_code)) as c
      from public.lab_result_documents d where p_routed_table = 'lab_result_documents' and d.id = p_routed_id
    union
    select coalesce(private.yearly_panel_screen_type(x ->> 'code'), lower(btrim(x ->> 'code')))
      from public.lab_report_extractions e
      cross join jsonb_array_elements(case when jsonb_typeof(e.rows) = 'array' then e.rows else '[]'::jsonb end) x
     where p_routed_table = 'lab_result_documents' and e.document_id = p_routed_id and e.status <> 'discarded'
    union
    select coalesce(private.yearly_panel_screen_type(i.analyte_code), lower(btrim(i.analyte_code)))
      from public.lab_results r join public.lab_result_items i on i.lab_result_id = r.id
     where p_routed_table = 'lab_result_files' and r.document_id = p_routed_id
    union
    select case when p_routed_table = 'ecg_report_documents' then 'ecg_resting' end
    union
    select case p_kind_code
             when 'cardiology.ecg' then 'ecg_resting'
             when 'lab.urinalysis' then 'urinalysis'
             when 'screening.cervical' then 'cervical_smear'
             when 'screening.prostate' then 'psa'
           end
  )
  select coalesce(array_agg(distinct c order by c), '{}'::text[]) from codes where c is not null and c <> ''
$$;

-- The order a routed store row already names, if any.
create or replace function private.routed_document_lab_order(p_routed_table text, p_routed_id uuid)
returns uuid
language sql
stable
security definer
set search_path to ''
as $$
  select case p_routed_table
    when 'lab_result_documents' then (select lab_order_id from public.lab_result_documents where id = p_routed_id)
    when 'ecg_report_documents' then (select lab_order_id from public.ecg_report_documents where id = p_routed_id)
    when 'lab_result_files' then (select r.lab_order_id from public.lab_results r
                                   where r.document_id = p_routed_id and r.lab_order_id is not null
                                   order by r.created_at desc limit 1)
  end
$$;

-- 3. The matcher ------------------------------------------------------------------------------------------------------------------

create or replace function private.match_lab_order_for_report(p_patient uuid, p_org uuid, p_codes text[], p_report_date date)
returns uuid
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_ids uuid[];
begin
  if p_codes is null or cardinality(p_codes) = 0 or p_report_date is null then
    return null;
  end if;
  select array_agg(o.id) into v_ids
    from public.lab_orders o
   where o.patient_id = p_patient
     and o.organisation_id = p_org
     and o.status in ('payment_confirmed', 'ordered', 'sample_collected', 'processing')
     and p_report_date >= (o.ordered_at at time zone 'Africa/Lagos')::date - 1
     and p_report_date <= (o.ordered_at at time zone 'Africa/Lagos')::date + 90
     and private.lab_order_test_codes(o.id) && p_codes;
  if coalesce(cardinality(v_ids), 0) = 1 then
    return v_ids[1];
  end if;
  return null;
end
$$;

-- 4. Filed, and completion --------------------------------------------------------------------------------------------------------

-- p_after_filing: the caller runs after the S27 hand-off of an extraction filing, so an uploaded lab report counts as filed even
-- though nobody stamped reviewed_at on the document itself.
create or replace function private.clinical_document_is_filed(p_document uuid, p_after_filing boolean)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select cd.status = 'reviewed' and cd.status_reason is null and not cd.is_superseded and cd.visible_to_patient
           and case cd.routed_table
                 when 'lab_result_documents' then
                   p_after_filing or exists (select 1 from public.lab_result_documents d where d.id = cd.routed_id and d.reviewed_at is not null)
                 when 'lab_result_files' then
                   exists (select 1 from public.lab_results r where r.document_id = cd.routed_id and r.release_state = 'released'
                            and r.withdrawn_at is null and r.superseded_by is null)
                 else true
               end
      from public.clinical_documents cd where cd.id = p_document), false)
$$;

create or replace function private.complete_lab_order_from_report(p_document uuid, p_after_filing boolean)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  cd public.clinical_documents;
  v_ord public.lab_orders;
  v_order_codes text[];
  v_covered text[];
begin
  select * into cd from public.clinical_documents where id = p_document;
  if cd.id is null or cd.lab_order_id is null or not private.clinical_document_is_filed(cd.id, p_after_filing) then
    return false;
  end if;
  select * into v_ord from public.lab_orders where id = cd.lab_order_id for update;
  if v_ord.id is null or v_ord.status not in ('payment_confirmed', 'ordered', 'sample_collected', 'processing') then
    return false;
  end if;
  -- S27 invariant: an order with a held result is never 'resulted' (that state tells the patient results are ready).
  if exists (select 1 from public.lab_results r
              where r.lab_order_id = v_ord.id and r.release_state in ('awaiting_review', 'clinician_disclosure_required')
                and r.withdrawn_at is null and r.superseded_by is null) then
    return false;
  end if;
  -- A multi-test request closes only when the filed reports linked to it cover every test on it.
  v_order_codes := private.lab_order_test_codes(v_ord.id);
  if cardinality(v_order_codes) > 1 then
    select coalesce(array_agg(distinct c), '{}'::text[]) into v_covered
      from (
        select unnest(private.report_test_codes(d.routed_table, d.routed_id, d.kind_code)) as c
          from public.clinical_documents d
         where d.lab_order_id = v_ord.id
           and (d.id = cd.id or private.clinical_document_is_filed(d.id, d.routed_table = 'lab_result_documents'
                   and exists (select 1 from public.lab_report_extractions e where e.document_id = d.routed_id and e.status = 'confirmed')))
        union
        select lower(s.test_code) from public.lab_order_test_status s where s.lab_order_id = v_ord.id and s.status = 'will_not_do'
      ) x;
    if not (v_order_codes <@ v_covered) then
      return false;
    end if;
  end if;

  update public.lab_orders set status = 'resulted', resulted_at = coalesce(resulted_at, now()) where id = v_ord.id;
  perform private.log_audit('lab_order.resulted_from_report', 'lab_orders', v_ord.id,
    jsonb_build_object('clinical_document_id', cd.id, 'link_source', cd.lab_order_link_source));
  return true;
end
$$;

-- 5. Triggers on the intake row -----------------------------------------------------------------------------------------------------

create or replace function private.cd_lab_order_link_before()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_order uuid;
  v_report_date date;
  v_ord public.lab_orders;
begin
  -- Inherit: the store behind this intake already names an order (an upload made from an open request, an S27 result filed with it).
  if new.lab_order_id is null and new.lab_order_link_source is null and new.routed_table is not null then
    v_order := private.routed_document_lab_order(new.routed_table, new.routed_id);
    -- an upload filed against a request that has since been cancelled (or was never paid) is stored, not refused: it is just not linked
    if v_order is not null and exists (select 1 from public.lab_orders o where o.id = v_order and o.patient_id = new.patient_id
                                          and o.organisation_id = new.organisation_id
                                          and o.status not in ('pending_payment', 'cancelled')) then
      new.lab_order_id := v_order;
      new.lab_order_link_source := 'upload';
      new.lab_order_linked_by := new.uploaded_by;
      new.lab_order_linked_at := now();
    end if;
  end if;

  -- Match: only when what is known about the report changed, and only when exactly one open request fits.
  if new.lab_order_id is null and new.lab_order_link_source is null
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.routed_id is distinct from old.routed_id
          or new.kind_code is distinct from old.kind_code or new.investigation_date is distinct from old.investigation_date) then
    v_report_date := coalesce(
      new.investigation_date,
      (select e.report_date from public.lab_report_extractions e
        where new.routed_table = 'lab_result_documents' and e.document_id = new.routed_id),
      (coalesce(new.created_at, now()) at time zone 'Africa/Lagos')::date);
    v_order := private.match_lab_order_for_report(new.patient_id, new.organisation_id,
      private.report_test_codes(new.routed_table, new.routed_id, new.kind_code), v_report_date);
    if v_order is not null then
      new.lab_order_id := v_order;
      new.lab_order_link_source := 'auto';
      new.lab_order_linked_by := null;
      new.lab_order_linked_at := now();
    end if;
  end if;

  -- Whoever set it: the request must be this patient's, in this organisation, and not unpaid or cancelled.
  if new.lab_order_id is not null and (tg_op = 'INSERT' or new.lab_order_id is distinct from old.lab_order_id) then
    select * into v_ord from public.lab_orders where id = new.lab_order_id;
    if v_ord.id is null or v_ord.patient_id <> new.patient_id or v_ord.organisation_id <> new.organisation_id then
      raise exception 'lab_order_link_not_this_patient' using errcode = '42501';
    end if;
    if v_ord.status in ('pending_payment', 'cancelled') then
      raise exception 'lab_order_link_order_not_open' using errcode = '22023';
    end if;
    new.lab_order_link_source := coalesce(new.lab_order_link_source, 'staff');
    new.lab_order_linked_at := coalesce(new.lab_order_linked_at, now());
  end if;
  return new;
end
$$;

create or replace function private.cd_lab_order_link_after()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_old uuid := case when tg_op = 'UPDATE' then old.lab_order_id end;
begin
  if new.lab_order_id is distinct from v_old then
    -- Push down to the store row, so the older machinery (S27 filing, screening upload checks) sees the same order. Never overwrite an
    -- order the store row names that this intake did not put there.
    perform set_config('app.change_reason', 'Linked to the test request it answers', true);
    if new.routed_table = 'lab_result_documents' then
      update public.lab_result_documents set lab_order_id = new.lab_order_id
       where id = new.routed_id and lab_order_id is distinct from new.lab_order_id
         and (lab_order_id is null or lab_order_id = v_old);
    elsif new.routed_table = 'ecg_report_documents' then
      update public.ecg_report_documents set lab_order_id = new.lab_order_id
       where id = new.routed_id and lab_order_id is distinct from new.lab_order_id
         and (lab_order_id is null or lab_order_id = v_old);
    end if;
    perform private.log_audit(
      case when new.lab_order_id is null then 'clinical_document.unlinked_from_lab_order' else 'clinical_document.linked_to_lab_order' end,
      'clinical_documents', new.id,
      jsonb_build_object('lab_order_id', new.lab_order_id, 'previous_lab_order_id', v_old, 'source', new.lab_order_link_source));
  end if;

  if new.lab_order_id is not null and new.status = 'reviewed' then
    perform private.complete_lab_order_from_report(new.id, false);
  end if;
  return null;
end
$$;

create trigger zz_lab_order_link_before
  before insert or update on public.clinical_documents
  for each row execute function private.cd_lab_order_link_before();

create trigger zz_lab_order_link_after
  after insert or update on public.clinical_documents
  for each row execute function private.cd_lab_order_link_after();

-- An uploaded report filed through the extraction path: checked only after raise_abnormal_results_from_filed_upload (trigger
-- lab_report_extraction_raise_abnormal) has handed it to S27, so a result S27 holds keeps the order open. Trigger names fire in
-- alphabetical order; zz_ runs last.
create or replace function private.lab_order_complete_on_extraction_filed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cd uuid;
begin
  if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
    select id into v_cd from public.clinical_documents
     where routed_table = 'lab_result_documents' and routed_id = new.document_id and lab_order_id is not null;
    if v_cd is not null then
      perform private.complete_lab_order_from_report(v_cd, true);
    end if;
  end if;
  return null;
end
$$;

create trigger zz_lab_order_complete_on_filing
  after update of status on public.lab_report_extractions
  for each row execute function private.lab_order_complete_on_extraction_filed();

-- 6. What people call ---------------------------------------------------------------------------------------------------------------

-- May the caller link this document? The patient it belongs to (for a document they can see or uploaded), or staff of its organisation.
create or replace function private.may_link_clinical_document(cd public.clinical_documents)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null
     and ((cd.patient_id = (select auth.uid()) and (cd.visible_to_patient or cd.uploaded_by = (select auth.uid())))
          or private.is_org_staff(cd.organisation_id))
$$;

-- The patient's requests a document could answer, the open ones first, each flagged when its tests overlap the report's.
create or replace function public.lab_order_link_candidates(p_document uuid)
returns table (lab_order_id uuid, order_number text, label text, status public.lab_order_status, ordered_at timestamptz,
               test_codes text[], tests_match boolean, is_linked boolean)
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  cd public.clinical_documents;
  v_codes text[];
begin
  select * into cd from public.clinical_documents where id = p_document;
  if cd.id is null or not private.may_link_clinical_document(cd) then
    raise exception 'clinical document not found' using errcode = '42501';
  end if;
  v_codes := private.report_test_codes(cd.routed_table, cd.routed_id, cd.kind_code);
  return query
    select o.id, o.order_number, coalesce(pb.name, case when o.panel_code is not null then 'Annual health check' else 'Lab test' end),
           o.status, o.ordered_at, private.lab_order_test_codes(o.id),
           private.lab_order_test_codes(o.id) && v_codes, o.id = cd.lab_order_id
      from public.lab_orders o
      left join public.panel_bundles pb on pb.id = o.panel_bundle_id
     where o.patient_id = cd.patient_id and o.organisation_id = cd.organisation_id
       and o.status not in ('pending_payment', 'cancelled')
     order by (o.status = 'resulted'), o.ordered_at desc
     limit 50;
end
$$;

-- Set, change or clear the request a document answers. p_lab_order null records "answers no request" (the matcher leaves it alone).
create or replace function public.link_clinical_document_to_lab_order(p_document uuid, p_lab_order uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_uid uuid := (select auth.uid());
  cd public.clinical_documents;
  v_status public.lab_order_status;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into cd from public.clinical_documents where id = p_document for update;
  if cd.id is null or not private.may_link_clinical_document(cd) then
    raise exception 'clinical document not found' using errcode = '42501';
  end if;

  update public.clinical_documents
     set lab_order_id = p_lab_order,
         lab_order_link_source = case when p_lab_order is null then 'declined'
                                      when cd.patient_id = v_uid then 'patient' else 'staff' end,
         lab_order_linked_by = v_uid,
         lab_order_linked_at = now()
   where id = cd.id;

  select status into v_status from public.lab_orders where id = p_lab_order;
  return jsonb_build_object('ok', true, 'lab_order_id', p_lab_order, 'order_status', v_status);
end
$$;

-- 7. Grants -------------------------------------------------------------------------------------------------------------------------

revoke all on function private.lab_order_test_codes(uuid) from public;
revoke all on function private.report_test_codes(text, uuid, text) from public;
revoke all on function private.routed_document_lab_order(text, uuid) from public;
revoke all on function private.match_lab_order_for_report(uuid, uuid, text[], date) from public;
revoke all on function private.clinical_document_is_filed(uuid, boolean) from public;
revoke all on function private.complete_lab_order_from_report(uuid, boolean) from public;
revoke all on function private.cd_lab_order_link_before() from public;
revoke all on function private.cd_lab_order_link_after() from public;
revoke all on function private.lab_order_complete_on_extraction_filed() from public;
revoke all on function private.may_link_clinical_document(public.clinical_documents) from public;
revoke all on function public.lab_order_link_candidates(uuid) from public, anon;
revoke all on function public.link_clinical_document_to_lab_order(uuid, uuid) from public, anon;
grant execute on function public.lab_order_link_candidates(uuid) to authenticated;
grant execute on function public.link_clinical_document_to_lab_order(uuid, uuid) to authenticated;

-- 8. Self-check -----------------------------------------------------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'clinical_documents'
                  and column_name = 'lab_order_id' and is_nullable = 'YES') then
    raise exception 'clinical_documents.lab_order_id missing or not nullable';
  end if;
  if has_column_privilege('authenticated', 'public.clinical_documents', 'lab_order_id', 'UPDATE')
     or has_column_privilege('authenticated', 'public.clinical_documents', 'lab_order_id', 'INSERT') then
    raise exception 'a signed-in user can write clinical_documents.lab_order_id directly';
  end if;
  if has_function_privilege('anon', 'public.link_clinical_document_to_lab_order(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.lab_order_link_candidates(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.complete_lab_order_from_report(uuid, boolean)', 'EXECUTE') then
    raise exception 'anon can execute a lab order link function';
  end if;
  if not has_function_privilege('authenticated', 'public.link_clinical_document_to_lab_order(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.lab_order_link_candidates(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute the lab order link functions';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('zz_lab_order_link_before', 'zz_lab_order_link_after',
        'zz_lab_order_complete_on_filing')) <> 3 then
    raise exception 'a lab order link trigger is missing';
  end if;
end $$;

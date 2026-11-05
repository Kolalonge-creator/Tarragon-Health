-- Request to report: tie a returned report to the lab_orders request it answers, and close the request when that report is filed.
--
-- Why the link lives on clinical_documents (read live 2026-11-05, not from older migration text):
--   * clinical_documents is the one intake record every returned report passes through, whatever the channel (patient app, care
--     coordinator, lab liaison, clinician, partner) and whatever the store behind it (routed_table: lab_result_documents,
--     lab_result_files (the S27 store behind lab_results.document_id), ecg_report_documents, imaging_report_documents, or nothing yet
--     for an unsorted upload). One nullable column there covers lab, ECG, imaging and S27 reports in one place.
--   * lab_result_documents.lab_order_id, ecg_report_documents.lab_order_id and lab_results.lab_order_id already exist and stay the
--     working columns the older machinery reads (handle_lab_result_document, raise_abnormal_results_from_filed_upload, submit_lab_result,
--     screening_result_uploaded). The intake link INHERITS from them and is PUSHED DOWN to the first two when a person or the matcher
--     sets it later, so filing an uploaded report through S27 carries the order too. lab_results.lab_order_id is immutable (its guard,
--     private.guard_lab_result, refuses any change), so a result filed before the link is reached through the document instead:
--     private.document_lab_result_ids ties a document to its S27 results (an S27 file by document_id; an uploaded report by the same
--     stored file path, or by the 'lab_upload.submitted_to_s27' audit row its extraction filing wrote; plus one level of corrections).
--
-- Live state when written: 40 lab_orders, all 'ordered'; 0 clinical_documents; 0 lab_results; 0 lab_result_documents. No backfill.
-- 0 of 40 orders carry a clinical_indication, so nothing here reads that column.
--
-- Matching rule (automatic, conservative): a document not yet linked, never declined, not superseded and not failed, whose tests are
-- known, is linked only when EXACTLY ONE of the patient's open orders (payment_confirmed, ordered, sample_collected, processing) in the
-- same organisation shares at least one test with it and was ordered no more than 1 day after and no more than 90 days before the
-- report date (investigation date, else the date printed on the report, else the upload date, Africa/Lagos). Otherwise a person decides.
--
-- Who may link (public.link_clinical_document_to_lab_order):
--   * staff who may read the document (private.staff_may_read on its access category, the same test as clinical_documents_select):
--     any of the patient's requests that is not unpaid or cancelled, including relinking a filed document;
--   * the patient: only their own document that no clinician has reviewed or filed yet, only one they or nobody linked (never over a
--     staff or automatic link, never over a decline staff recorded), and only to an open request that shares a test with the report
--     inside the same date window the matcher uses. A patient may also decline (record "answers no request") under the same limits.
--
-- Completion rule (private.complete_lab_order_from_report): an open order moves to 'resulted' only when ALL of these hold:
--   * every test on the order is covered by the tests of FILED reports linked to it (a single-test order too). An order whose tests
--     cannot be read never closes from a link. 'will_not_do' marks are ignored: patients can write them, so they never close an order.
--     Imaging codes: abdominal_ultrasound and breast_imaging are covered by imaging documents of the matching kind
--     (imaging.ultrasound.abdomen; imaging.mammography, imaging.ultrasound.breast, screening.breast). prostate_ultrasound has no document
--     kind on this platform, so it is EXCLUDED from coverage explicitly (screen_comprehensive is the only bundle that names it).
--   * filed means: reviewed by a clinician, not superseded; an S27 file only when its result is released; an uploaded lab report only
--     when its S27 hand-off has run and released (or found no panel test), and never while its extraction still holds panel analytes
--     that have not been filed ("mark reviewed" alone waits for the S27 hand-off);
--   * no S27 result on the order, or tied to any document linked to it, is anything but released (held, awaiting disclosure or
--     withheld all keep the order open), unless withdrawn or superseded;
--   * a document that already closed one order (clinical_documents.resulted_lab_order_id) never counts towards another.
-- It runs when the intake row changes, after an extraction filing has been handed to S27 (zz_ trigger on lab_report_extractions), and
-- when an S27 result tied to a linked document is released or withdrawn (zz_ trigger on lab_results).

-- 1. The link ---------------------------------------------------------------------------------------------------------------------

alter table public.clinical_documents
  add column lab_order_id uuid references public.lab_orders(id) on delete set null,
  add column lab_order_link_source text,
  add column lab_order_linked_by uuid references public.profiles(id) on delete set null,
  add column lab_order_linked_at timestamptz,
  add column resulted_lab_order_id uuid references public.lab_orders(id) on delete set null;

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
comment on column public.clinical_documents.resulted_lab_order_id is
  'The order this document helped close. A document that closed one order never counts towards closing another.';

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
-- where a mapping exists), the analytes S27 filed for it, and what its kind implies (ECG, urinalysis, smear, PSA, abdominal or breast
-- imaging). A thyroid reading also covers the bundle-level 'tft' code.
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
             when 'imaging.ultrasound.abdomen' then 'abdominal_ultrasound'
             when 'imaging.mammography' then 'breast_imaging'
             when 'imaging.ultrasound.breast' then 'breast_imaging'
             when 'screening.breast' then 'breast_imaging'
           end
  ),
  with_tft as (
    select c from codes
    union
    select 'tft' from codes where c in ('tsh', 'free_t4')
  )
  select coalesce(array_agg(distinct c order by c), '{}'::text[]) from with_tft where c is not null and c <> ''
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

-- The date a report speaks for: investigation date, else the date printed on it, else the upload date (Africa/Lagos).
create or replace function private.report_date(p_investigation_date date, p_routed_table text, p_routed_id uuid, p_created_at timestamptz)
returns date
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce(
    p_investigation_date,
    (select e.report_date from public.lab_report_extractions e
      where p_routed_table = 'lab_result_documents' and e.document_id = p_routed_id),
    (coalesce(p_created_at, now()) at time zone 'Africa/Lagos')::date)
$$;

-- Does this order fit a report: open, same patient and organisation, a shared test, ordered inside the window?
create or replace function private.lab_order_fits_report(p_order uuid, p_patient uuid, p_org uuid, p_codes text[], p_report_date date)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select p_codes is not null and cardinality(p_codes) > 0 and p_report_date is not null
           and o.patient_id = p_patient and o.organisation_id = p_org
           and o.status in ('payment_confirmed', 'ordered', 'sample_collected', 'processing')
           and p_report_date >= (o.ordered_at at time zone 'Africa/Lagos')::date - 1
           and p_report_date <= (o.ordered_at at time zone 'Africa/Lagos')::date + 90
           and private.lab_order_test_codes(o.id) && p_codes
      from public.lab_orders o where o.id = p_order), false)
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
   where o.patient_id = p_patient and o.organisation_id = p_org
     and private.lab_order_fits_report(o.id, p_patient, p_org, p_codes, p_report_date);
  if coalesce(cardinality(v_ids), 0) = 1 then
    return v_ids[1];
  end if;
  return null;
end
$$;

-- 4. S27 results behind a document, filed, and completion --------------------------------------------------------------------------

create or replace function private.document_lab_result_ids(p_document uuid)
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $$
  with cd as (select * from public.clinical_documents where id = p_document),
  direct as (
    -- an S27 file: its own results
    select r.id from cd join public.lab_results r on cd.routed_table = 'lab_result_files' and r.document_id = cd.routed_id
    union
    -- an uploaded report filed into S27: the S27 file stored at the same path
    select r.id from cd
      join public.lab_result_documents d on cd.routed_table = 'lab_result_documents' and d.id = cd.routed_id
      join public.lab_result_files f on f.patient_id = d.patient_id and f.file_path = d.file_path
      join public.lab_results r on r.document_id = f.id
    union
    -- an uploaded report whose extraction filing handed values to S27 (raise_abnormal_results_from_filed_upload's audit row)
    select (a.event ->> 'lab_result_id')::uuid from cd
      join public.lab_report_extractions e on cd.routed_table = 'lab_result_documents' and e.document_id = cd.routed_id
      join public.audit_log a on a.entity_type = 'lab_report_extractions' and a.entity_id = e.id
                             and a.action = 'lab_upload.submitted_to_s27' and (a.event ->> 'lab_result_id') is not null
  )
  select coalesce(array_agg(distinct id), '{}'::uuid[]) from (
    select id from direct
    union
    select c.id from public.lab_results c where c.corrects_result_id in (select id from direct)
  ) x where id is not null
$$;

-- A lab result keeps an order open unless released, withdrawn or replaced.
create or replace function private.lab_result_is_open_hold(p_result uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (select 1 from public.lab_results r where r.id = p_result
                  and r.release_state <> 'released' and r.withdrawn_at is null and r.superseded_by is null)
$$;

-- Has a clinician reviewed or filed this document (or does it belong to the care team's S27 store)?
create or replace function private.clinical_document_clinician_touched(p_document uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select coalesce((
    select cd.status = 'reviewed' or cd.resulted_lab_order_id is not null or cd.routed_table = 'lab_result_files'
           or exists (select 1 from public.lab_result_documents d where cd.routed_table = 'lab_result_documents'
                       and d.id = cd.routed_id and d.reviewed_at is not null)
           or exists (select 1 from public.lab_report_extractions e where cd.routed_table = 'lab_result_documents'
                       and e.document_id = cd.routed_id and e.status = 'confirmed')
           or exists (select 1 from public.ecg_report_documents d where cd.routed_table = 'ecg_report_documents'
                       and d.id = cd.routed_id and d.reviewed_at is not null)
      from public.clinical_documents cd where cd.id = p_document), false)
$$;

create or replace function private.clinical_document_is_filed(p_document uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  cd public.clinical_documents;
  v_results uuid[];
  v_any_hold boolean;
  v_any_released boolean;
  v_reviewed boolean;
  e public.lab_report_extractions;
  v_pending_panel boolean;
  v_no_panel boolean;
begin
  select * into cd from public.clinical_documents where id = p_document;
  if cd.id is null or cd.is_superseded or cd.status <> 'reviewed' or cd.status_reason is not null then
    return false;
  end if;
  v_results := private.document_lab_result_ids(cd.id);
  select coalesce(bool_or(private.lab_result_is_open_hold(x)), false),
         coalesce(bool_or(exists (select 1 from public.lab_results r where r.id = x and r.release_state = 'released'
                                   and r.withdrawn_at is null and r.superseded_by is null)), false)
    into v_any_hold, v_any_released
    from unnest(v_results) x;
  if v_any_hold then
    return false;
  end if;

  if cd.routed_table = 'lab_result_files' then
    return v_any_released;
  elsif cd.routed_table = 'lab_result_documents' then
    select * into e from public.lab_report_extractions where document_id = cd.routed_id;
    if e.id is not null and e.status = 'confirmed' then
      -- filed through the extraction path: only once S27 released what it was handed, or S27 found no panel test to take
      select exists (select 1 from public.audit_log a where a.entity_type = 'lab_report_extractions' and a.entity_id = e.id
                      and a.action = 'lab_upload.filed_no_panel_tests') into v_no_panel;
      return v_any_released or (cardinality(v_results) = 0 and v_no_panel);
    end if;
    select d.reviewed_at is not null into v_reviewed from public.lab_result_documents d where d.id = cd.routed_id;
    if not coalesce(v_reviewed, false) or not cd.visible_to_patient then
      return false;
    end if;
    -- "Mark reviewed" before the values are filed: if the reading still holds yearly-panel analytes that S27 has not taken, wait
    select e.id is not null and e.status not in ('failed', 'discarded')
           and exists (select 1 from jsonb_array_elements(case when jsonb_typeof(e.rows) = 'array' then e.rows else '[]'::jsonb end) x
                        where private.yearly_panel_screen_type(x ->> 'code') is not null or lower(btrim(x ->> 'code')) = 'anti_hbs')
      into v_pending_panel;
    if coalesce(v_pending_panel, false) then
      return false;
    end if;
    return cardinality(v_results) = 0 or v_any_released;
  else
    -- ECG, imaging, or an unrouted document a clinician reviewed
    return cd.visible_to_patient;
  end if;
end
$$;

create or replace function private.complete_lab_order_from_report(p_document uuid)
returns boolean
language plpgsql
security definer
set search_path to ''
as $$
declare
  cd public.clinical_documents;
  v_ord public.lab_orders;
  v_required text[];
  v_covered text[];
  v_docs uuid[];
begin
  select * into cd from public.clinical_documents where id = p_document;
  if cd.id is null or cd.lab_order_id is null then
    return false;
  end if;
  -- a document that already closed another order never closes this one
  if cd.resulted_lab_order_id is not null and cd.resulted_lab_order_id <> cd.lab_order_id then
    return false;
  end if;
  select * into v_ord from public.lab_orders where id = cd.lab_order_id for update;
  if v_ord.id is null or v_ord.status not in ('payment_confirmed', 'ordered', 'sample_collected', 'processing') then
    return false;
  end if;

  -- every test on the order must be covered; prostate_ultrasound has no document kind and is excluded (see header)
  v_required := array(select c from unnest(private.lab_order_test_codes(v_ord.id)) c where c <> 'prostate_ultrasound');
  if cardinality(v_required) = 0 then
    return false;
  end if;

  -- held S27 results: on the order itself, or tied to any document linked to it
  if exists (select 1 from public.lab_results r where r.lab_order_id = v_ord.id and private.lab_result_is_open_hold(r.id))
     or exists (select 1 from public.clinical_documents d, unnest(private.document_lab_result_ids(d.id)) x
                 where d.lab_order_id = v_ord.id and not d.is_superseded and private.lab_result_is_open_hold(x)) then
    return false;
  end if;

  select coalesce(array_agg(d.id), '{}'::uuid[]) into v_docs
    from public.clinical_documents d
   where d.lab_order_id = v_ord.id
     and (d.resulted_lab_order_id is null or d.resulted_lab_order_id = v_ord.id)
     and private.clinical_document_is_filed(d.id);
  if cardinality(v_docs) = 0 then
    return false;
  end if;
  select coalesce(array_agg(distinct c), '{}'::text[]) into v_covered
    from public.clinical_documents d, unnest(private.report_test_codes(d.routed_table, d.routed_id, d.kind_code)) c
   where d.id = any (v_docs);
  if not (v_required <@ v_covered) then
    return false;
  end if;

  update public.lab_orders set status = 'resulted', resulted_at = coalesce(resulted_at, now()) where id = v_ord.id;
  update public.clinical_documents set resulted_lab_order_id = v_ord.id where id = any (v_docs) and resulted_lab_order_id is null;
  perform private.log_audit('lab_order.resulted_from_report', 'lab_orders', v_ord.id,
    jsonb_build_object('clinical_document_ids', to_jsonb(v_docs), 'triggered_by', cd.id));
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
  v_ord public.lab_orders;
begin
  -- Inherit: the store behind this intake already names an order (an upload made from an open request, an S27 result filed with it).
  if new.lab_order_id is null and new.lab_order_link_source is null and new.routed_table is not null then
    v_order := private.routed_document_lab_order(new.routed_table, new.routed_id);
    -- an upload filed against a request that has since been cancelled (or was never paid) is stored, not refused: it is just not linked
    if v_order is not null and exists (select 1 from public.lab_orders lo where lo.id = v_order and lo.patient_id = new.patient_id
                                          and lo.organisation_id = new.organisation_id
                                          and lo.status not in ('pending_payment', 'cancelled')) then
      new.lab_order_id := v_order;
      new.lab_order_link_source := 'upload';
      new.lab_order_linked_by := new.uploaded_by;
      new.lab_order_linked_at := now();
    end if;
  end if;

  -- Match: only when what is known about the report changed, never for a superseded or failed document, and only when exactly one
  -- open request fits.
  if new.lab_order_id is null and new.lab_order_link_source is null
     and not new.is_superseded and new.status not in ('superseded', 'processing_failed')
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.routed_id is distinct from old.routed_id
          or new.kind_code is distinct from old.kind_code or new.investigation_date is distinct from old.investigation_date) then
    v_order := private.match_lab_order_for_report(new.patient_id, new.organisation_id,
      private.report_test_codes(new.routed_table, new.routed_id, new.kind_code),
      private.report_date(new.investigation_date, new.routed_table, new.routed_id, new.created_at));
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
    perform private.complete_lab_order_from_report(new.id);
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
-- lab_report_extraction_raise_abnormal) has handed it to S27. Trigger names fire in alphabetical order; zz_ runs last.
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
      perform private.complete_lab_order_from_report(v_cd);
    end if;
  end if;
  return null;
end
$$;

create trigger zz_lab_order_complete_on_filing
  after update of status on public.lab_report_extractions
  for each row execute function private.lab_order_complete_on_extraction_filed();

-- An S27 result tied to a linked document is released (or withdrawn): re-check that document's order.
create or replace function private.lab_order_complete_on_result_change()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_cd uuid;
begin
  for v_cd in
    select d.id from public.clinical_documents d
     where d.patient_id = new.patient_id and d.lab_order_id is not null
       and new.id = any (private.document_lab_result_ids(d.id))
  loop
    perform private.complete_lab_order_from_report(v_cd);
  end loop;
  return null;
end
$$;

create trigger zz_lab_order_complete_on_result_change
  after update of release_state, withdrawn_at on public.lab_results
  for each row execute function private.lab_order_complete_on_result_change();

-- 6. What people call ---------------------------------------------------------------------------------------------------------------

-- Staff who may read this document (the same test clinical_documents_select applies to staff), or null for anyone else.
create or replace function private.staff_may_link_clinical_document(cd public.clinical_documents)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null and (select auth.uid()) <> cd.patient_id
     and private.staff_may_read(cd.patient_id, cd.organisation_id, cd.access_category)
$$;

-- The patient's own document they can see or uploaded.
create or replace function private.patient_owns_clinical_document(cd public.clinical_documents)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select (select auth.uid()) is not null and cd.patient_id = (select auth.uid())
     and (cd.visible_to_patient or cd.uploaded_by = (select auth.uid()))
$$;

-- The patient's requests a document could answer, the open ones first. tests_match: the request shares a test with the report inside
-- the matcher's date window (what a patient may link to).
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
  v_date date;
begin
  select * into cd from public.clinical_documents where id = p_document;
  if cd.id is null or not (private.staff_may_link_clinical_document(cd) or private.patient_owns_clinical_document(cd)) then
    raise exception 'clinical document not found' using errcode = '42501';
  end if;
  v_codes := private.report_test_codes(cd.routed_table, cd.routed_id, cd.kind_code);
  v_date := private.report_date(cd.investigation_date, cd.routed_table, cd.routed_id, cd.created_at);
  return query
    select o.id, o.order_number, coalesce(pb.name, case when o.panel_code is not null then 'Annual health check' else 'Lab test' end),
           o.status, o.ordered_at, private.lab_order_test_codes(o.id),
           private.lab_order_fits_report(o.id, cd.patient_id, cd.organisation_id, v_codes, v_date), o.id = cd.lab_order_id
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
  v_staff boolean;
  v_status public.lab_order_status;
begin
  if v_uid is null then raise exception 'sign in required' using errcode = '28000'; end if;
  select * into cd from public.clinical_documents where id = p_document for update;
  if cd.id is null then raise exception 'clinical document not found' using errcode = '42501'; end if;
  v_staff := private.staff_may_link_clinical_document(cd);
  if not v_staff then
    if not private.patient_owns_clinical_document(cd) then
      raise exception 'clinical document not found' using errcode = '42501';
    end if;
    -- A patient never changes a document a clinician has reviewed or filed, nor a link staff or the matcher made.
    if private.clinical_document_clinician_touched(cd.id) then
      raise exception 'lab_order_link_already_filed' using errcode = '42501';
    end if;
    if not (cd.lab_order_link_source is null
            or (cd.lab_order_link_source in ('patient', 'declined') and cd.lab_order_linked_by = v_uid)
            or (cd.lab_order_link_source = 'upload' and cd.uploaded_by = v_uid)) then
      raise exception 'lab_order_link_set_by_care_team' using errcode = '42501';
    end if;
    if p_lab_order is not null and not private.lab_order_fits_report(p_lab_order, cd.patient_id, cd.organisation_id,
         private.report_test_codes(cd.routed_table, cd.routed_id, cd.kind_code),
         private.report_date(cd.investigation_date, cd.routed_table, cd.routed_id, cd.created_at)) then
      if exists (select 1 from public.lab_orders o where o.id = p_lab_order and o.patient_id = cd.patient_id) then
        raise exception 'lab_order_link_tests_do_not_match' using errcode = '22023';
      end if;
      raise exception 'lab_order_link_not_this_patient' using errcode = '42501';
    end if;
  end if;

  update public.clinical_documents
     set lab_order_id = p_lab_order,
         lab_order_link_source = case when p_lab_order is null then 'declined' when v_staff then 'staff' else 'patient' end,
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
revoke all on function private.report_date(date, text, uuid, timestamptz) from public;
revoke all on function private.lab_order_fits_report(uuid, uuid, uuid, text[], date) from public;
revoke all on function private.match_lab_order_for_report(uuid, uuid, text[], date) from public;
revoke all on function private.document_lab_result_ids(uuid) from public;
revoke all on function private.lab_result_is_open_hold(uuid) from public;
revoke all on function private.clinical_document_clinician_touched(uuid) from public;
revoke all on function private.clinical_document_is_filed(uuid) from public;
revoke all on function private.complete_lab_order_from_report(uuid) from public;
revoke all on function private.cd_lab_order_link_before() from public;
revoke all on function private.cd_lab_order_link_after() from public;
revoke all on function private.lab_order_complete_on_extraction_filed() from public;
revoke all on function private.lab_order_complete_on_result_change() from public;
revoke all on function private.staff_may_link_clinical_document(public.clinical_documents) from public;
revoke all on function private.patient_owns_clinical_document(public.clinical_documents) from public;
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
     or has_column_privilege('authenticated', 'public.clinical_documents', 'lab_order_id', 'INSERT')
     or has_column_privilege('authenticated', 'public.clinical_documents', 'resulted_lab_order_id', 'UPDATE') then
    raise exception 'a signed-in user can write the lab order link columns directly';
  end if;
  if has_function_privilege('anon', 'public.link_clinical_document_to_lab_order(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.lab_order_link_candidates(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.complete_lab_order_from_report(uuid)', 'EXECUTE') then
    raise exception 'anon can execute a lab order link function';
  end if;
  if not has_function_privilege('authenticated', 'public.link_clinical_document_to_lab_order(uuid, uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.lab_order_link_candidates(uuid)', 'EXECUTE') then
    raise exception 'authenticated cannot execute the lab order link functions';
  end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('zz_lab_order_link_before', 'zz_lab_order_link_after',
        'zz_lab_order_complete_on_filing', 'zz_lab_order_complete_on_result_change')) <> 4 then
    raise exception 'a lab order link trigger is missing';
  end if;
end $$;

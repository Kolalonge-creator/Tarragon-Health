-- Tarragon Health — Imaging & Diagnostic Services Engine, part 2/3: report
-- documents + structured fields (15.6/15.7) + the abnormal-finding hook into
-- the EXISTING Abnormal Result Engine (15.9).
--
-- SHAPE mirrors ecg_report_documents (20260814193521) closely — upload
-- raises a routine clinician_review alert, a BEFORE UPDATE trigger derives
-- reviewed_by/reviewed_at from the acting session — but adds the structured
-- fields 15.6 asks for directly on this table (findings, impression,
-- reporting_clinician_name, report_date, facility_name) rather than a
-- separate AI-extraction table: unlike the lab/ECG pipelines, there is no
-- existing AI-extraction engine for narrative radiology findings/impression
-- text in this codebase, and building one is out of scope here — a
-- reviewing clinician enters these fields directly, the same "AI drafts,
-- never decides" boundary just drawn one step earlier (a human always
-- files the structured record, full stop, for this modality).
--
-- 15.9 — "should feed the same Abnormal Result Engine rather than creating a
-- separate disconnected alert mechanism": this inserts into the EXISTING
-- public.clinician_alerts table via the same shape as
-- private.handle_abnormal_screening_result, reads its SLA from the SAME
-- config-driven pathway ('screening_abnormal_result' in escalation_slas) —
-- deliberately not a new pathway, since reusing the identical name is what
-- "same engine" actually means, and adding a new one would need a fresh
-- Clinical-Director sign-off cycle for a distinction the SLA itself doesn't
-- need to make. The only schema change to clinician_alerts is one additive,
-- nullable column (diagnostic_report_id) mirroring the existing
-- screening_result_id/vital_reading_id source-link columns — none of the 9
-- existing alert-raising trigger functions are touched, matching the
-- caution the classify_and_assign migration (20260828014055) itself states.

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.diagnostic_report_source as enum (
    'patient', 'lab_liaison', 'clinician', 'admin'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. clinician_alerts: one additive, nullable source-link column, same
-- pattern as screening_result_id/vital_reading_id. Table must exist before
-- this ALTER references it — created in section 3 below is wrong order, so
-- diagnostic_reports is created first, then this column is added, then the
-- diagnostic_reports triggers (section 5) are defined last, once the column
-- they write to actually exists.
-- ---------------------------------------------------------------------------

create table public.diagnostic_reports (
  id                         uuid primary key default gen_random_uuid(),
  organisation_id            uuid not null references public.organisations (id) on delete restrict,
  patient_id                  uuid not null references public.profiles (id) on delete cascade,
  diagnostic_request_id         uuid not null references public.diagnostic_requests (id) on delete cascade,
  -- storage.objects path (bucket 'diagnostic-reports'), never a public URL.
  file_path                       text not null,
  original_filename                 text,
  mime_type                          text,
  file_size_bytes                     bigint,
  source                               public.diagnostic_report_source not null,
  uploaded_by                           uuid references public.profiles (id) on delete restrict,
  note                                   text,
  -- 15.6 structured fields.
  findings                                text,
  impression                                text,
  reporting_clinician_name                    text,
  report_date                                  date,
  facility_name                                 text,
  -- 15.9 abnormal-finding flag, set by the reviewing clinician alongside
  -- findings/impression — never inferred, never defaulted.
  is_abnormal                                    boolean,
  abnormal_severity                               text,
  clinician_alert_id                                uuid references public.clinician_alerts (id) on delete set null,
  -- Null-gated clinician-review attribution (CLINICAL_TRUST_MODEL_SPEC §2).
  reviewed_by                                        uuid references public.profiles (id) on delete restrict,
  reviewed_at                                          timestamptz,
  review_note                                            text,
  -- Same 5-state acknowledgement lifecycle as lab_result_documents
  -- (20260827204355) — reused directly, the type is already generically
  -- named and not lab-specific.
  acknowledgement_status                                   public.result_document_acknowledgement_status not null default 'new',
  action_completed_at                                        timestamptz,
  action_completed_by                                          uuid references public.profiles (id) on delete restrict,
  created_at                                                     timestamptz not null default now(),
  updated_at                                                       timestamptz not null default now(),
  constraint diagnostic_reports_abnormal_severity_valid
    check (abnormal_severity is null or abnormal_severity in ('abnormal', 'critical')),
  constraint diagnostic_reports_abnormal_requires_severity
    check (is_abnormal is not true or abnormal_severity is not null)
);

comment on table public.diagnostic_reports is
  '15.6/15.7: an uploaded diagnostic report (X-ray/ultrasound/CT/MRI/echo/mammography/etc.) plus its structured findings/impression, filed by a reviewing clinician. Multiple reports may exist per diagnostic_requests row (e.g. an addendum) — diagnostic_requests.status/reported_at track the request-level workflow, driven by triggers on this table rather than a denormalised pointer back.';
comment on column public.diagnostic_reports.abnormal_severity is
  'Mirrors screening_results.result_status''s abnormal/critical distinction (not the full 4-value enum — a report is either fine, or needs an abnormal_result alert at urgent_escalation or emergency level). Required once is_abnormal is true.';

create index diagnostic_reports_patient_idx on public.diagnostic_reports (patient_id, created_at desc);
create index diagnostic_reports_org_idx on public.diagnostic_reports (organisation_id, created_at desc);
create index diagnostic_reports_request_idx on public.diagnostic_reports (diagnostic_request_id);
create index diagnostic_reports_unreviewed_idx on public.diagnostic_reports (organisation_id, created_at) where reviewed_at is null;

create trigger diagnostic_reports_set_updated_at
  before update on public.diagnostic_reports
  for each row execute function private.set_updated_at();

-- Now that diagnostic_reports exists, extend clinician_alerts with the
-- source-link column (additive, nullable — mirrors screening_result_id /
-- vital_reading_id exactly).
alter table public.clinician_alerts
  add column if not exists diagnostic_report_id uuid references public.diagnostic_reports (id) on delete set null;

create index if not exists clinician_alerts_diagnostic_report_idx
  on public.clinician_alerts (diagnostic_report_id) where diagnostic_report_id is not null;

comment on column public.clinician_alerts.diagnostic_report_id is
  'Links an abnormal_result alert back to the diagnostic_reports row that raised it — same role as screening_result_id/vital_reading_id for their own sources. Set by the diagnostic_reports review trigger (private.handle_abnormal_diagnostic_report), never client-supplied.';

-- Extend the taxonomy classifier's type_code inference with an explicit
-- diagnostic_report_id branch — additive to the existing CASE, byte-for-byte
-- preserving every other branch (this trigger, unlike the 9 original
-- generators, is designed to be extended this way — see its own comment on
-- 20260828014055). Without this, a row with diagnostic_report_id set but no
-- explicit type_code would still land on 'abnormal_result' via the existing
-- final ELSE branch — this branch just makes that explicit and independent
-- of title-string matching, exactly like the screening_result_id branch.
create or replace function private.classify_and_assign_clinician_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_effective_level public.alert_level;
  v_rule jsonb;
  v_owner_tier public.doctor_tier;
  v_backup_tier public.doctor_tier;
  v_dupe_id uuid;
  v_dupe_created_at timestamptz;
begin
  v_effective_level := coalesce(new.override_level, new.level);

  new.severity := case v_effective_level
    when 'emergency' then 4
    when 'urgent_escalation' then 3
    when 'clinician_review' then 2
    when 'routine' then 1
  end;

  if new.type_code is null then
    new.type_code := case
      when new.screening_result_id is not null then 'abnormal_result'
      when new.diagnostic_report_id is not null then 'abnormal_result'
      when new.vital_reading_id is not null then 'abnormal_monitoring'
      when new.title ilike 'priority%: emergency reported%' then 'symptom_escalation'
      when new.title ilike '%diabetic foot%' then 'symptom_escalation'
      when new.title ilike '%eating-disorder%' or new.title ilike '%mental-health screen%' then 'symptom_escalation'
      when new.title ilike 'lifestyle red flag%' then 'deterioration'
      when new.title ilike '%glucose logs%' or new.title ilike '%blood-pressure readings%' then 'overdue_monitoring'
      else 'abnormal_result'
    end::public.alert_type_code;
  end if;

  if new.category is null then
    new.category := case new.type_code
      when 'missed_appointment' then 'care_management'
      when 'overdue_task' then 'care_management'
      when 'overdue_monitoring' then 'care_management'
      when 'failed_referral' then 'care_management'
      when 'adherence_problem' then 'medication'
      when 'refill_due' then 'medication'
      when 'potential_interaction' then 'medication'
      when 'pharmacy_problem' then 'medication'
      when 'provider_unavailable' then 'operational'
      when 'appointment_failure' then 'operational'
      when 'laboratory_failure' then 'operational'
      else 'clinical'
    end::public.alert_category;
  end if;

  v_rule := private.alert_rule_config(new.type_code);
  if v_rule is not null then
    v_owner_tier := nullif(v_rule->>'owner_tier', '')::public.doctor_tier;
    v_backup_tier := nullif(v_rule->>'backup_tier', '')::public.doctor_tier;

    if new.responsible_clinician_id is null and v_owner_tier is not null then
      select cs.id into new.responsible_clinician_id
      from public.clinical_staff cs
      left join public.clinician_alerts ca
        on ca.responsible_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
      where cs.organisation_id = new.organisation_id
        and cs.active
        and cs.doctor_tier = v_owner_tier
      group by cs.id, cs.created_at
      order by count(ca.id) asc, cs.created_at asc
      limit 1;

      if new.responsible_clinician_id is not null then
        new.assigned_at := now();
      end if;
    end if;

    if new.backup_clinician_id is null and v_backup_tier is not null then
      select cs.id into new.backup_clinician_id
      from public.clinical_staff cs
      left join public.clinician_alerts ca
        on ca.backup_clinician_id = cs.id and ca.status in ('open', 'acknowledged')
      where cs.organisation_id = new.organisation_id
        and cs.active
        and cs.doctor_tier = v_backup_tier
        and cs.id is distinct from new.responsible_clinician_id
      group by cs.id, cs.created_at
      order by count(ca.id) asc, cs.created_at asc
      limit 1;
    end if;
  end if;

  new.dedup_key := new.type_code::text || ':' || new.patient_id::text;

  select id, created_at into v_dupe_id, v_dupe_created_at
  from public.clinician_alerts
  where dedup_key = new.dedup_key
    and status in ('open', 'acknowledged')
    and created_at > now() - interval '24 hours'
  order by created_at desc
  limit 1;

  if v_dupe_id is not null then
    new.duplicate_of := v_dupe_id;
    if v_rule is not null
       and coalesce((v_rule->>'auto_suppress_duplicates')::boolean, false)
       and v_dupe_created_at > now() - (coalesce(nullif(v_rule->>'suppress_window_minutes', ''), '1440')::integer * interval '1 minute')
    then
      new.suppressed := true;
      new.suppressed_reason := 'Protocol-based duplicate suppression: same type and patient as alert ' || v_dupe_id || ' within the governed suppression window.';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. Private storage bucket (mirrors 'ecg-reports')
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'diagnostic-reports',
  'diagnostic-reports',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do nothing;

drop policy if exists "diagnostic report doc patient insert" on storage.objects;
create policy "diagnostic report doc patient insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'diagnostic-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "diagnostic report doc patient select" on storage.objects;
create policy "diagnostic report doc patient select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'diagnostic-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "diagnostic report doc patient update" on storage.objects;
create policy "diagnostic report doc patient update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'diagnostic-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'diagnostic-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "diagnostic report doc patient delete" on storage.objects;
create policy "diagnostic report doc patient delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'diagnostic-reports'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 4. RLS on diagnostic_reports (mirrors ecg_report_documents exactly)
-- ---------------------------------------------------------------------------
alter table public.diagnostic_reports enable row level security;

create policy diagnostic_reports_select on public.diagnostic_reports
  for select to authenticated
  using (patient_id = (select auth.uid()) or private.is_org_staff(organisation_id));

create policy diagnostic_reports_insert on public.diagnostic_reports
  for insert to authenticated
  with check (
    (patient_id = (select auth.uid()) and source = 'patient')
    or private.is_org_staff(organisation_id)
  );

create policy diagnostic_reports_update on public.diagnostic_reports
  for update to authenticated
  using (private.is_org_staff(organisation_id))
  with check (private.is_org_staff(organisation_id));

grant select, insert, update on public.diagnostic_reports to authenticated;

-- ---------------------------------------------------------------------------
-- 5. BEFORE INSERT: derive uploaded_by, raise a routine clinician_review
-- alert, sync the parent request's status, notify the patient. Mirrors
-- private.handle_ecg_report_document.
-- ---------------------------------------------------------------------------
create or replace function private.handle_diagnostic_report_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert_id uuid;
  v_request public.diagnostic_requests%rowtype;
begin
  select * into v_request from public.diagnostic_requests where id = new.diagnostic_request_id;
  if v_request.id is null then
    raise exception 'Diagnostic request not found' using errcode = '23503';
  end if;
  if v_request.organisation_id is distinct from new.organisation_id
     or v_request.patient_id is distinct from new.patient_id then
    raise exception 'diagnostic_reports organisation_id/patient_id must match the linked diagnostic_requests row' using errcode = '23514';
  end if;

  if (select auth.uid()) is not null then
    new.uploaded_by := (select auth.uid());
  end if;

  new.reviewed_by := null;
  new.reviewed_at := null;
  new.review_note := null;
  new.is_abnormal := null;
  new.abnormal_severity := null;
  new.acknowledgement_status := 'new';
  new.action_completed_at := null;
  new.action_completed_by := null;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, escalation_level, diagnostic_report_id)
  values (
    new.organisation_id,
    new.patient_id,
    'clinician_review',
    'open',
    format('%s report uploaded — review needed', initcap(v_request.modality::text)),
    format(
      'A %s report was uploaded for "%s" (%s)%s. Review the report, file the structured findings/impression, and flag if abnormal.',
      v_request.modality::text, v_request.service_name, new.source,
      case when new.note is not null and length(btrim(new.note)) > 0
        then format(' — %s', new.note) else '' end
    ),
    2,
    new.id
  )
  returning id into v_alert_id;

  new.clinician_alert_id := v_alert_id;

  if v_request.status not in ('reported', 'reviewed', 'actioned') then
    -- A report existing is itself proof attendance/imaging happened, even
    -- when no staff member separately logged an 'attended' transition first
    -- (the common case for self-arranged fulfilment) — backfilled here so
    -- diagnostic_requests_attended_has_timestamp holds without forcing an
    -- artificial manual step into the workflow.
    update public.diagnostic_requests
    set status = 'reported',
        attended_at = coalesce(attended_at, now()),
        reported_at = coalesce(reported_at, now())
    where id = new.diagnostic_request_id;
  end if;

  if new.source <> 'patient' then
    insert into public.notifications (organisation_id, recipient_id, channel, template, payload)
    values
      (new.organisation_id, new.patient_id, 'whatsapp', 'result_document_available', jsonb_build_object('source', new.source::text)),
      (new.organisation_id, new.patient_id, 'email', 'result_document_available', jsonb_build_object('source', new.source::text));
  end if;

  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (
    new.organisation_id,
    new.uploaded_by,
    'diagnostic_report.uploaded',
    'diagnostic_reports',
    new.id,
    jsonb_build_object('source', new.source::text, 'diagnostic_request_id', new.diagnostic_request_id, 'clinician_alert_id', v_alert_id)
  );

  return new;
end;
$$;

create trigger diagnostic_reports_on_insert
  before insert on public.diagnostic_reports
  for each row execute function private.handle_diagnostic_report_insert();

-- ---------------------------------------------------------------------------
-- 6. BEFORE UPDATE: review stamp, acknowledgement-status lifecycle (mirrors
-- 20260827204355's lab_result_documents pattern), and the abnormal-finding
-- hook into the Abnormal Result Engine (15.9).
-- ---------------------------------------------------------------------------
create or replace function private.handle_diagnostic_report_review()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level public.alert_level;
  v_sla interval;
  v_alert_id uuid;
begin
  -- Upload-time facts are immutable after insert.
  new.organisation_id       := old.organisation_id;
  new.patient_id              := old.patient_id;
  new.diagnostic_request_id     := old.diagnostic_request_id;
  new.file_path                   := old.file_path;
  new.source                        := old.source;
  new.uploaded_by                     := old.uploaded_by;
  new.clinician_alert_id                := old.clinician_alert_id;
  new.created_at                          := old.created_at;

  if new.reviewed_at is not null and old.reviewed_at is null then
    new.reviewed_by := coalesce((select auth.uid()), new.reviewed_by);
    new.reviewed_at := now();

    new.acknowledgement_status :=
      case when new.is_abnormal is true then 'action_required' else 'reviewed' end;
    new.action_completed_at := null;
    new.action_completed_by := null;

    update public.diagnostic_requests
    set status = case when status in ('actioned') then status else 'reviewed' end,
        reviewed_at = coalesce(reviewed_at, now())
    where id = new.diagnostic_request_id;

    if new.is_abnormal is true then
      if new.abnormal_severity is null then
        raise exception 'abnormal_severity is required when is_abnormal is true' using errcode = '23514';
      end if;

      v_level := case new.abnormal_severity when 'critical' then 'emergency' else 'urgent_escalation' end;
      v_sla := private.escalation_sla_minutes('screening_abnormal_result', v_level) * interval '1 minute';

      insert into public.clinician_alerts
        (organisation_id, patient_id, level, status, title, detail, sla_due_at, diagnostic_report_id, escalation_level)
      values (
        new.organisation_id,
        new.patient_id,
        v_level,
        'open',
        format('Priority %s: abnormal diagnostic finding', case v_level when 'emergency' then '1' else '2' end),
        format('Diagnostic report %s flagged %s. Impression: %s',
               new.id, new.abnormal_severity, coalesce(new.impression, new.findings, 'see report')),
        now() + v_sla,
        new.id,
        case v_level when 'emergency' then 4 else 3 end
      )
      returning id into v_alert_id;

      -- The routine upload-review alert this report already raised is
      -- superseded by the urgent one just created — resolve it rather than
      -- leaving two open alerts for the same document.
      update public.clinician_alerts
      set status = 'resolved', resolution_action = 'Superseded by urgent abnormal-finding alert ' || v_alert_id,
          resolution_outcome = 'true_positive'
      where id = old.clinician_alert_id and status = 'open';
    end if;
  elsif old.reviewed_at is not null then
    new.reviewed_by := old.reviewed_by;
    new.reviewed_at := old.reviewed_at;
    new.is_abnormal := old.is_abnormal;
    new.abnormal_severity := old.abnormal_severity;
  end if;

  if new.action_completed_at is not null and old.action_completed_at is null then
    if old.acknowledgement_status <> 'action_required' then
      raise exception 'Only a report in action_required can be marked action_completed' using errcode = '22023';
    end if;
    new.acknowledgement_status := 'action_completed';
    new.action_completed_by := coalesce((select auth.uid()), new.action_completed_by);
    new.action_completed_at := now();

    update public.diagnostic_requests
    set status = 'actioned', actioned_at = coalesce(actioned_at, now())
    where id = new.diagnostic_request_id;
  elsif old.action_completed_at is not null then
    new.action_completed_at := old.action_completed_at;
    new.action_completed_by := old.action_completed_by;
  end if;

  return new;
end;
$$;

comment on function private.handle_diagnostic_report_review() is
  '15.9: on a review that sets is_abnormal=true, raises a clinician_alerts row via the SAME Abnormal Result Engine screening abnormal results already use (type_code=abnormal_result via the classifier default, sla_due_at read from the existing screening_abnormal_result escalation_slas pathway) — not a separate mechanism. Also drives diagnostic_requests.status through reviewed/actioned.';

create trigger diagnostic_reports_on_review
  before update on public.diagnostic_reports
  for each row execute function private.handle_diagnostic_report_review();

-- ---------------------------------------------------------------------------
-- 7. Self-verification
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_table_privilege('authenticated', 'public.diagnostic_reports', 'SELECT') then
    raise exception 'diagnostic_reports: authenticated SELECT grant did not take';
  end if;
  if not has_table_privilege('authenticated', 'public.diagnostic_reports', 'INSERT') then
    raise exception 'diagnostic_reports: authenticated INSERT grant did not take';
  end if;

  if not exists (select 1 from storage.buckets where id = 'diagnostic-reports' and public = false) then
    raise exception 'diagnostic_reports: diagnostic-reports bucket missing or public';
  end if;

  if exists (
    select 1
    from pg_constraint con
    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = con.conkey[1]
    where con.conrelid = 'public.diagnostic_reports'::regclass
      and con.contype = 'f'
      and a.attname in ('uploaded_by', 'reviewed_by', 'action_completed_by')
      and con.confdeltype <> 'r'
  ) then
    raise exception 'diagnostic_reports: uploaded_by/reviewed_by/action_completed_by must be ON DELETE RESTRICT';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinician_alerts' and column_name = 'diagnostic_report_id'
  ) then
    raise exception 'clinician_alerts.diagnostic_report_id was not added';
  end if;

  -- Prove the reused pathway is actually configured, so the review trigger
  -- can never silently fail closed the first time a real abnormal finding
  -- is filed.
  perform private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation');
  perform private.escalation_sla_minutes('screening_abnormal_result', 'emergency');

  raise notice 'PASS: diagnostic report documents + structured fields + abnormal-result hook in place';
end $$;

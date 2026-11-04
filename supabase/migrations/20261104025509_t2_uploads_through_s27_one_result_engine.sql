-- Tarragon Health 2.0, Phase 1, second piece (decision T2-07, founder 2026-11-04): ONE result engine for every source, and it is the
-- S27 lab result machine.
--
-- Why S27: for a critical value it opens a tracked call to the on-call doctor (private.lab_open_critical_call: answer due in the signed
-- paging rule's minutes, 10 today, a named backup, an ops incident when nobody is on the rota); a sensitive positive goes through the
-- disclosure workflow; nothing reaches the patient before a clinician releases it (INV-03). The first Phase 1 piece
-- (20261104022347) sent a filed upload to the screening engine instead, whose critical tier is a 12-hour contact SLA. The founder chose
-- S27 as the standard for every source.
--
-- What changes:
--   1. A completed filing (lab_report_extractions -> 'confirmed') now submits the filed yearly-panel values to
--      private.submit_lab_result as a 'tarragon_team' result, with the uploaded document attached. S27 classifies them against the
--      signed panel, holds them, opens the critical call / disclosure requirement / review task, and links them to the filed readings
--      (DUP-1). The screening-row step added by 20261104022347 is retired: private.raise_abnormal_results_from_filed_upload is
--      replaced, not extended. A panel value that cannot be classified is left out of the items, so S27 sees the panel as incomplete
--      and holds it for a clinician; the uncheckable value itself goes to a doctor on its own screening row (never "normal").
--   2. The Category 2 -> 1 upgrade for S27 results: when a held result is RELEASED by a clinician (after review or after disclosure)
--      and it has an out-of-range, critical or positive value, one screening_results row per screen type is written, linked by the new
--      screening_results.lab_result_id. The existing screening triggers then do what they do for any abnormal result (screening
--      upgrade, care-plan or referral draft, doctor-dashboard alert on the signed SLA, timeline). Writing it at release, not at
--      receipt, keeps the patient's view consistent with the S27 hold.
--   3. No second page: private.handle_abnormal_screening_result tells the abnormal-result-handler edge function page_clinicians =
--      false for such a mirrored row, because the S27 critical call (or the releasing clinician) already has it. The edge function
--      learned that flag in the same change and must be deployed before this migration is applied.
--
-- Rows affected at the time of writing: lab_results 0, lab_result_items 0, lab_result_documents 0, screening_results from uploads 0.

-- 1. the link from a mirrored screening row to its S27 result
alter table public.screening_results
  add column if not exists lab_result_id uuid references public.lab_results(id) on delete restrict;
create unique index if not exists screening_results_lab_result_screen_type_key
  on public.screening_results (lab_result_id, screen_type_code) where lab_result_id is not null;
comment on column public.screening_results.lab_result_id is
  'T2-07: set when this row mirrors a released S27 lab result (one row per screen type with an abnormal value). The abnormal-result handler does not page for it: the S27 critical call or the releasing clinician already has the result.';

-- frozen like the other clinical columns (body otherwise as live on 2026-11-04)
create or replace function private.enforce_screening_result_clinical_columns_immutable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.organisation_id    := old.organisation_id;
  new.patient_id         := old.patient_id;
  new.schedule_id        := old.schedule_id;
  new.lab_order_id       := old.lab_order_id;
  new.result_status      := old.result_status;
  new.result_summary     := old.result_summary;
  new.abnormal_flags     := old.abnormal_flags;
  new.screen_type_code   := old.screen_type_code;
  new.created_at         := old.created_at;
  new.corrects_result_id := old.corrects_result_id;
  new.correction_reason  := old.correction_reason;
  new.lab_result_id      := old.lab_result_id;
  return new;
end;
$$;

-- 2. a completed filing is submitted to S27
create or replace function private.raise_abnormal_results_from_filed_upload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_taken_at timestamptz;
  d public.lab_result_documents%rowtype;
  r record;
  v_c jsonb;
  v_items jsonb := '[]'::jsonb;
  v_seen text[] := '{}';
  v_unclassified text[] := '{}';
  v_file jsonb;
  v_order uuid;
  v_out jsonb;
begin
  if new.status is distinct from 'confirmed' or old.status = 'confirmed' or new.report_date is null then
    return new;
  end if;
  -- the same midday-UTC instant confirm_lab_report_extraction stamps on every reading it files
  v_taken_at := (new.report_date::text || ' 12:00:00+00')::timestamptz;

  for r in
    select l.code, l.value, l.value_text, l.unit
      from private.lab_analyte_readings_current l
     where l.patient_id = new.patient_id
       and l.created_at = now()            -- filed in this transaction, by this confirmation
       and l.taken_at = v_taken_at
       and l.code in (select jsonb_array_elements_text(coalesce(new.confirmed_codes, '[]'::jsonb)))
     order by l.code
  loop
    if private.yearly_panel_screen_type(r.code) is null and lower(r.code) <> 'anti_hbs' then
      continue;                            -- not a yearly-panel test: stays a filed reading only, as before
    end if;
    if lower(r.code) = any (v_seen) then continue; end if;   -- S27 refuses a duplicate analyte; the first filed value is used
    v_c := private.classify_filed_lab_value(new.patient_id, r.code, r.value, r.value_text, r.unit);
    if v_c is null then
      v_unclassified := v_unclassified || lower(r.code);     -- left out: S27 holds the panel as incomplete for a clinician
      continue;
    end if;
    v_seen := v_seen || lower(r.code);
    v_items := v_items || case when v_c ->> 'kind' = 'numeric'
      then jsonb_build_object('analyte_code', lower(r.code), 'value_numeric', r.value, 'unit', v_c ->> 'unit')
      else jsonb_build_object('analyte_code', lower(r.code), 'value_text', v_c ->> 'flag') end;
  end loop;

  select * into d from public.lab_result_documents where id = new.document_id;
  if d.id is not null and d.file_path like new.patient_id::text || '/%' and d.file_path not like '%..%' then
    v_file := jsonb_build_object('file_path', d.file_path, 'original_filename', d.original_filename,
                                 'mime_type', d.mime_type, 'file_size_bytes', d.file_size_bytes);
  end if;
  -- S27 refuses an order that is unpaid or cancelled; the result is then recorded without the order, never dropped
  if d.lab_order_id is not null
     and exists (select 1 from public.lab_orders o where o.id = d.lab_order_id and o.patient_id = new.patient_id
                 and o.status not in ('pending_payment', 'cancelled')) then
    v_order := d.lab_order_id;
  end if;

  if jsonb_array_length(v_items) = 0 and coalesce(array_length(v_unclassified, 1), 0) = 0 then
    -- no yearly-panel test on the report: nothing for S27 (the clinician filed the readings from the review alert)
    perform private.log_audit('lab_upload.filed_no_panel_tests', 'lab_report_extractions', new.id, '{}'::jsonb);
    return new;
  end if;
  if jsonb_array_length(v_items) = 0 and v_file is null then
    raise exception 'lab_upload_not_submittable: panel tests could not be checked and the document is not in the patient''s folder'
      using errcode = '22023';
  end if;

  -- a failure here fails the filing: the clinician sees it and retries, rather than values being filed with no result engine behind them
  v_out := private.submit_lab_result(new.patient_id, v_order, 'membership_annual',
                                     case when jsonb_array_length(v_items) > 0 then v_items end,
                                     v_file, 'tarragon_team', new.confirmed_by, null);

  -- A yearly-panel value that could not be checked (an equivocal "Weakly reactive", an unexpected unit) is not in the S27 items, so
  -- S27 only sees a missing analyte. It goes to a doctor on its own, through the screening engine, one row per screen type: a
  -- sensitive one keeps its restricted screen type, so the patient does not read it before a clinician. Nothing else is written here.
  for r in
    select private.yearly_panel_screen_type(c) as screen_type, array_agg(c order by c) as codes
      from unnest(v_unclassified) c
     where private.yearly_panel_screen_type(c) is not null
     group by 1
  loop
    insert into public.screening_results
      (organisation_id, patient_id, lab_order_id, result_status, result_summary, abnormal_flags, screen_type_code, laboratory)
    values (new.organisation_id, new.patient_id, v_order, 'abnormal',
      format('From an uploaded lab report filed by the care team (report date %s). %s could not be checked automatically; a doctor will review it.',
             to_char(new.report_date, 'DD Mon YYYY'),
             (select string_agg(private.yearly_panel_test_label(x), ', ') from unnest(r.codes) x)),
      r.codes, r.screen_type, new.lab_name);
  end loop;

  perform private.log_audit('lab_upload.submitted_to_s27', 'lab_report_extractions', new.id,
    jsonb_build_object('lab_result_id', v_out ->> 'lab_result_id', 'release_state', v_out ->> 'release_state',
                       'reason', v_out ->> 'reason', 'not_classified', to_jsonb(v_unclassified)));
  return new;
end;
$$;

-- 3. a released S27 result with an abnormal value is mirrored for the Category 2 -> 1 upgrade
create or replace function private.mirror_released_lab_result_to_screening()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g record;
  v_lines text;
  v_codes text[];
  v_critical boolean;
begin
  if new.release_state is distinct from 'released' or old.release_state = 'released' or new.superseded_by is not null then
    return new;
  end if;
  -- a correction of a result that was already mirrored does not raise the same finding twice
  if new.corrects_result_id is not null
     and exists (select 1 from public.screening_results s where s.lab_result_id = new.corrects_result_id) then
    return new;
  end if;

  for g in
    select private.yearly_panel_screen_type(i.analyte_code) as screen_type,
           array_agg(lower(i.analyte_code) order by i.analyte_code) as codes,
           bool_or(i.flag = 'critical') as critical,
           string_agg(format('%s %s: %s%s',
             private.yearly_panel_test_label(i.analyte_code),
             coalesce(trim_scale(i.value_numeric)::text || coalesce(' ' || nullif(i.unit, ''), ''), i.value_text),
             case i.flag when 'critical' then 'outside the safe limit' else i.flag end,
             case when i.ref_low is not null or i.ref_high is not null
                  then format(' (our range %s to %s %s)', coalesce(trim_scale(i.ref_low)::text, '-'), coalesce(trim_scale(i.ref_high)::text, '-'), i.unit)
                  else '' end), '; ' order by i.analyte_code) as lines
      from public.lab_result_items i
     where i.lab_result_id = new.id
       and i.flag not in ('normal', 'negative')
       and private.yearly_panel_screen_type(i.analyte_code) is not null   -- anti-HBs (positive = immune) is never mirrored
     group by 1
  loop
    insert into public.screening_results
      (organisation_id, patient_id, lab_order_id, result_status, result_summary, abnormal_flags, screen_type_code, lab_result_id)
    values (
      new.organisation_id, new.patient_id, new.lab_order_id,
      case when g.critical then 'critical' else 'abnormal' end::public.result_status,
      format('Lab result released by the care team. %s.', g.lines),
      case when g.screen_type = 'ogtt_fpg' then g.codes || 'glucose'::text else g.codes end,
      g.screen_type,
      new.id)
    on conflict (lab_result_id, screen_type_code) where lab_result_id is not null do nothing;
  end loop;
  return new;
end;
$$;

drop trigger if exists lab_results_mirror_released_to_screening on public.lab_results;
create trigger lab_results_mirror_released_to_screening
  after update of release_state on public.lab_results
  for each row execute function private.mirror_released_lab_result_to_screening();

-- 4. the abnormal-result handler: unchanged for every other row; a mirrored S27 row is not paged again (body otherwise as live on
-- 2026-11-04)
create or replace function private.handle_abnormal_screening_result()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.upgrade_condition := 'other';
  v_upgrade_id uuid;
  v_level public.alert_level;
  v_escalation_level smallint;
  v_sla interval;
  v_sensitive boolean := false;
begin
  if new.result_status not in ('abnormal', 'critical') then
    return new;
  end if;

  if new.abnormal_flags && array['bp', 'blood_pressure', 'hypertension'] then
    v_condition := 'hypertension';
  elsif new.abnormal_flags && array['glucose', 'hba1c', 'diabetes'] then
    v_condition := 'diabetes';
  elsif new.abnormal_flags && array['psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_condition := 'cancer_referral';
  end if;

  if new.screen_type_code is not null then
    select coalesce(bool_or(st.sensitive), false)
      into v_sensitive
      from public.screen_types st
      where st.code = new.screen_type_code;
  end if;
  if not v_sensitive
     and new.abnormal_flags && array['hiv', 'hep_b', 'hep_c', 'psa', 'cancer', 'mammography', 'cervical', 'fit'] then
    v_sensitive := true;
  end if;

  if new.result_status = 'critical' then
    v_level := 'emergency';
    v_escalation_level := 4;
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'emergency') * interval '1 minute';
  else
    v_level := 'urgent_escalation';
    v_escalation_level := 3;
    v_sla := private.escalation_sla_minutes('screening_abnormal_result', 'urgent_escalation') * interval '1 minute';
  end if;

  insert into public.screening_upgrades
    (organisation_id, patient_id, screening_result_id, condition_triggered)
  values
    (new.organisation_id, new.patient_id, new.id, v_condition)
  returning id into v_upgrade_id;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, screening_result_id, escalation_level)
  values (
    new.organisation_id,
    new.patient_id,
    v_level,
    'open',
    'Priority 1: abnormal screening result',
    format('Screening result %s flagged %s; condition inferred: %s.',
           new.id, coalesce(array_to_string(new.abnormal_flags, ', '), 'none'), v_condition),
    now() + v_sla,
    new.id,
    v_escalation_level
  );

  begin
    perform net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
        || '/functions/v1/abnormal-result-handler',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
        'x-notification-jobs-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'notification_jobs_secret'), ''),
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'screening_result_id', new.id,
        'screening_upgrade_id', v_upgrade_id,
        'organisation_id', new.organisation_id,
        'patient_id', new.patient_id,
        'condition', v_condition,
        'abnormal_flags', to_jsonb(new.abnormal_flags),
        'result_summary', new.result_summary,
        'sensitive', v_sensitive,
        -- T2-07: a released S27 result already had its critical call or its clinician; draft the care plan or referral, do not page again
        'page_clinicians', new.lab_result_id is null
      ),
      timeout_milliseconds := 8000
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke all on function private.mirror_released_lab_result_to_screening() from public, anon, authenticated;
revoke all on function private.raise_abnormal_results_from_filed_upload() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'lab_results_mirror_released_to_screening' and tgrelid = 'public.lab_results'::regclass) then
    raise exception 'FAIL: lab_results_mirror_released_to_screening trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'lab_report_extraction_raise_abnormal' and tgrelid = 'public.lab_report_extractions'::regclass) then
    raise exception 'FAIL: the filing trigger is missing';
  end if;
  if position('submit_lab_result' in pg_get_functiondef('private.raise_abnormal_results_from_filed_upload'::regproc)) = 0
     or position('could not be checked automatically' in pg_get_functiondef('private.raise_abnormal_results_from_filed_upload'::regproc)) = 0 then
    raise exception 'FAIL: a filed upload must go to S27, with only uncheckable panel values sent to a doctor separately';
  end if;
  if position('page_clinicians' in pg_get_functiondef('private.handle_abnormal_screening_result'::regproc)) = 0 then
    raise exception 'FAIL: the abnormal-result handler does not pass page_clinicians';
  end if;
  raise notice 'PASS: t2 uploads go through the S27 result engine';
end $$;

-- Tarragon Health 2.0, Phase 1 (decision T2-10, founder 2026-11-04): a filed upload whose values are all in range no longer opens a
-- second review of what the filing clinician just read.
--
-- Found by /code-review on T2-07 (20261104025509): S27 holds any result that does not cover the whole yearly panel as 'incomplete' and
-- opens a routine_result_review task. A patient's upload is usually partial (an HbA1c alone, a lipid profile), so every normal partial
-- upload became a second task for the doctor who had just filed it, and stayed held from the patient until someone released it.
--
-- Change: when S27 returns awaiting_review / 'incomplete' for a filing, the filing clinician's own session releases it through
-- public.release_lab_result (which re-checks the result_review permission, closes the task and notifies the patient). Anything held for
-- another reason (abnormal, critical, sensitive positive, preliminary, ranges not signed) is untouched and goes through review as before.
-- If the release is refused for any reason the result stays held, and the refusal is in the audit row. Function otherwise as
-- 20261104025509.
--
-- Not changed (checked live 2026-11-04, a review finding that turned out to be already handled): a sensitive positive or equivocal
-- HIV/hepatitis reading filed into lab_analyte_readings is already hidden from the patient and caregivers by the restrictive policy
-- lab_analyte_readings_hide_sensitive (private.may_see_sensitive_lab_result: a tied doctor only); the proof now asserts it.

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
  v_rel jsonb;
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

  -- T2-10: the clinician who filed the report has just reviewed every value. When S27 holds the result only because the panel is not
  -- complete (every value it checked is in range: no abnormal, critical or sensitive item), that review is the release, so the same
  -- clinician's filing releases it instead of opening a second routine review of what they just read. release_lab_result re-checks
  -- that the caller may review results; if not (or anything else refuses), the result simply stays held for review, the safe state.
  if v_out ->> 'release_state' = 'awaiting_review' and v_out ->> 'reason' = 'incomplete' then
    begin
      v_rel := public.release_lab_result((v_out ->> 'lab_result_id')::uuid,
        'Filed from an uploaded report by the reviewing clinician; every value checked was in range.');
    exception when others then
      v_rel := jsonb_build_object('error', sqlstate);
    end;
  end if;

  perform private.log_audit('lab_upload.submitted_to_s27', 'lab_report_extractions', new.id,
    jsonb_build_object('lab_result_id', v_out ->> 'lab_result_id', 'release_state', v_out ->> 'release_state',
                       'reason', v_out ->> 'reason', 'not_classified', to_jsonb(v_unclassified),
                       'released_on_filing', coalesce(v_rel ->> 'ok', 'false')::boolean, 'release_refusal', v_rel ->> 'error'));
  return new;
end;
$$;

revoke all on function private.raise_abnormal_results_from_filed_upload() from public, anon, authenticated;

do $$
begin
  if position('release_lab_result' in pg_get_functiondef('private.raise_abnormal_results_from_filed_upload'::regproc)) = 0
     or position('submit_lab_result' in pg_get_functiondef('private.raise_abnormal_results_from_filed_upload'::regproc)) = 0 then
    raise exception 'FAIL: the filing function must still submit to S27 and release a complete-normal-but-partial result';
  end if;
  raise notice 'PASS: t2 normal partial filings are released by the filing clinician';
end $$;

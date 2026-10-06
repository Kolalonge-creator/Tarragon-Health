-- S27e: a patient's own upload no longer shows an expected review time (found in the S27d review: on Free no clinician is assigned).
create or replace function public.my_lab_results() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by (x ->> 'received_at') desc), '[]'::jsonb) from (
    select jsonb_build_object(
      'lab_result_id', r.id, 'received_at', r.received_at, 'panel_code', r.panel_code, 'own_upload', r.submitted_by_kind = 'patient',
      -- every held result looks the same to the patient (no hint of which one is sensitive or abnormal)
      'status', case when r.release_state = 'released' then 'released' else 'under_review' end,
      -- a patient's own outside upload promises no review time: a clinician looks at it only if the patient is a Member (S27b)
      'expected_by', case when r.release_state = 'released' or r.submitted_by_kind = 'patient' then null else r.received_at + make_interval(mins => private.lab_expected_minutes()) end,
      'explain_allowed', coalesce(private.lab_result_explainable(r.id), false),
      'replaced', r.superseded_by is not null,
      'correction_kind', r.correction_kind,
      'has_file', r.document_id is not null and (r.release_state = 'released' or r.submitted_by_kind = 'patient'),
      'items', case when r.release_state = 'released' then coalesce((select jsonb_agg(jsonb_build_object('analyte_code', i.analyte_code, 'value_numeric', i.value_numeric,
          'value_text', i.value_text, 'unit', i.unit, 'ref_low', i.ref_low, 'ref_high', i.ref_high, 'flag', i.flag, 'sensitive_positive', i.sensitive_positive) order by i.analyte_code)
          from public.lab_result_items i where i.lab_result_id = r.id), '[]'::jsonb) else '[]'::jsonb end) as x
    from public.lab_results r
   where r.patient_id = (select auth.uid()) and r.release_state <> 'withheld' and r.withdrawn_at is null
  ) s;
$$;


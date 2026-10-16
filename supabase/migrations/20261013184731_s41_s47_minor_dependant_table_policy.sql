-- S41 to S47 x S04b-1: say, for each patient-keyed table the S41 to S47 stack adds, whether an under-18 dependant may hold rows in it.
--
-- S04b-1 (20261013183512) guards every patient_id table that has no row in minor_dependant_table_policy, and on a fresh replay it runs AFTER the
-- S41 to S47 tables exist, so it guarded all of them as "clinical or personal data". In production the stack's tables arrive after that sweep and
-- would carry no guard and no policy row at all. This migration makes both histories end the same way, from either starting point:
--   * exempt: bookkeeping and consent records that must be writable for a child (a guardian records consent for the child; the age-18 hand-over
--     row is made while the person is still a dependant; the export log, report build failures and the emergency card switches are system or
--     settings rows). The guard is removed and the policy row says why.
--   * guarded: everything clinical or personal. The guard is (re)installed and the policy row says guarded.
-- Idempotent; a table that does not exist is skipped.

do $$
declare
  t text;
  v_exempt constant text[][] := array[
    ['consent_matrix_events',        'the guardian records consent choices for the child; append-only history'],
    ['dependant_handovers',          'age 18 hand-over bookkeeping: the row is made while the person is still a dependant'],
    ['external_exchange_consents',   'consent record for sharing records outside the platform'],
    ['fhir_export_log',              'audit of record exports'],
    ['health_report_build_failures', 'system bookkeeping for report generation'],
    ['emergency_card_fields',        'which fields an emergency card shows: a setting, not clinical data']
  ];
  v_guarded constant text[] := array[
    'external_records', 'health_reports', 'onboarding_answers', 'patient_item_notes', 'procedures', 'risk_assessments',
    'screening_care_team_flags', 'screening_pathway_overrides', 'screening_risk_flags'
  ];
  i integer;
begin
  for i in 1 .. array_length(v_exempt, 1) loop
    if to_regclass('public.' || v_exempt[i][1]) is not null then
      execute format('drop trigger if exists "00_minor_dependant_scope" on public.%I', v_exempt[i][1]);
      insert into public.minor_dependant_table_policy (table_name, policy, reason)
      values (v_exempt[i][1], 'exempt', v_exempt[i][2])
      on conflict (table_name) do update set policy = 'exempt', reason = excluded.reason;
    end if;
  end loop;
  foreach t in array v_guarded loop
    if to_regclass('public.' || t) is not null then
      perform private.guard_minor_dependant_table(t, 'patient_id');
    end if;
  end loop;
end $$;

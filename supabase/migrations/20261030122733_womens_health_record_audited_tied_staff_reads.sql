-- OQ-555 and OQ-558 (INV-10, INV-12): the clinician Women's Health tab reads pregnancy, antenatal, postnatal, breast and fertility rows through ONE audited,
-- tied function, with no reason typed; and the direct staff SELECT on four of those tables no longer admits more than the care tie.
--
-- WHAT WAS WRONG. S66 moved only the cycle and menopause rows to an audited function. The tab still read patient_pregnancy, antenatal_visits,
-- postnatal_profiles, breast_symptom_reports and fertility_assessment_requests straight from the tables, so opening a woman's pregnancy or fertility
-- record by a clinician left no audit row at all, and a refused open left none either.
--
-- WHAT THIS DOES
--  1. public.read_womens_health_record_audited(p_patient): SECURITY DEFINER, takes NO reason (OQ-558, NHS-style silent audit: the reader types nothing).
--     The reason written to the audit row is a fixed server-side phrase. The check is private.reproductive_staff_tied (S66): an active credentialed
--     clinician, not a care coordinator, in the patient's organisation, with a care tie (clinician_has_patient_access). It calls neither
--     private.can_staff_read_clinical nor private.has_emergency_access nor the support view-as test, so break-glass, an emergency grant and a
--     support session are all refused (reproductive_health is excluded from every one of them). Every call that reaches a real patient writes an
--     audit row through private.audit_chart_read: 'success' BEFORE any row is read (a failed audit insert raises, so nothing is returned without a
--     row), 'denied' for a refusal (the function returns normally, so the refusal row is committed). A patient-role caller is refused with 42501
--     (a patient and a caregiver read their own data directly, under their own row security). An unknown id is a plain refusal with no row, because
--     there is no patient to attach it to.
--     It is NOT behind reproductive_content_enabled: that guard is for the clinician cycle report content (OQ-554) and cannot yet be switched on, and
--     these five tables were readable by a tied clinician before this change, so gating them would remove a working screen.
--  2. public.read_reproductive_pattern_report_audited: p_reason becomes optional (default null). A caller that sends a reason of 10 or more
--     characters keeps working exactly as before; a caller that sends none gets the same fixed phrase the tab used to send. A reason that is present
--     but shorter than 10 characters is still refused. Existing callers are unbroken. Patched from the LIVE body by guarded replacement.
--  3. public.my_reproductive_access_log (the patient's "who opened my record" list) now also lists openings of the Women's Health record.
--  4. The staff arm of the SELECT policy on patient_pregnancy, antenatal_visits, postnatal_profiles and fertility_assessment_requests is replaced
--     with private.reproductive_staff_tied(patient_id), written fresh. Before: private.staff_may_read(..., 'reproductive_health'), which also
--     admitted an active support view-as session (private.can_support_view takes no category) and, with the tied-reads kill switch off, any staff
--     of the organisation. After: only the care tie. The patient arm (patient_id = auth.uid()) is kept exactly; these tables have NO caregiver arm and
--     none is added (stricter than the reproductive profile, on purpose). Break-glass and the S39c opening were already refused for reproductive_health.
--     Write policies are untouched (the fertility status update still goes through private.staff_may_write; UPDATE .. WHERE needs a visible row and
--     a tied clinician has one).
--
-- DELIBERATELY NOT CHANGED
--  * breast_symptom_reports keeps its policy. The S39b registry classifies it as medical_history (not reproductive_health), so its break-glass and
--    audited-opening paths are a standing, registered decision. It is read through the new audited function by the tab all the same.
--  * Other staff code that reads patient_pregnancy / postnatal_profiles directly for a drug-safety or pathway gate (prescribing form, titration
--    suggestion, medicine review, triage context) is unchanged: it needs a boolean for a safety decision, runs for a tied clinician, and is listed
--    in the report as a follow-up, not silently left.
--
-- KNOWN LIMITS, decided on purpose
--  * A patient-role caller (a patient or a caregiver) is refused with 42501 and NO audit row: they are not staff and have no staff read to record
--    (same as the S66 cycle report). A target id that is not a patient is refused with no row: there is no patient to attach it to.
--  * The success row is written before the reads, in the same transaction. If a later read inside the function raised, the whole call (row included)
--    rolls back and the caller gets an error and no data. A committed "attempted and failed" row would need a separate transaction, which a SECURITY
--    DEFINER function does not have; the page shows a failed read as a failed read, never as an empty record.
--  * The app only calls this when the clinician opens the Women's Health record (?tab=womens-health), not on every chart load, so the audit trail and
--    the patient's "who opened my record" list show real openings.
--
-- Live counts 2026-10-30: patient_pregnancy 0 rows, so no existing reader's data changes. No data is rewritten and there is no conversion step.
-- New function name, no overload of any existing function (the one existing function gains a default on its LAST parameter, same signature).

-- ---------------------------------------------------------------------------
-- 1. The audited, tied read of the five tables
-- ---------------------------------------------------------------------------
create function public.read_womens_health_record_audited(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  c_cap constant integer := 500;                  -- technical page cap, not a clinical value
  c_reason constant text := 'Clinician opened the Women''s Health record';
  c_sections constant text[] := array['womens_health_record'];
  v_uid uuid := (select auth.uid());
  v_preg jsonb;
  v_ante jsonb;
  v_post jsonb;
  v_breast jsonb;
  v_fert jsonb;
begin
  if v_uid is null then raise exception 'not authorised' using errcode = '42501'; end if;
  -- A patient (and a caregiver, a patient-role account) reads her own rows directly under her own row security; this is the staff path.
  if exists (select 1 from public.profiles where id = v_uid and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  -- An unknown id looks the same as a patient the caller may not read: a refusal. There is no subject to attach an audit row to.
  if not exists (select 1 from public.profiles where id = p_patient and role = 'patient') then
    return jsonb_build_object('status', 'denied', 'pregnancy', null, 'antenatal_visits', '[]'::jsonb, 'postnatal_profiles', '[]'::jsonb,
                              'breast_reports', '[]'::jsonb, 'fertility_requests', '[]'::jsonb);
  end if;
  if not private.reproductive_staff_tied(p_patient) then
    perform private.audit_chart_read(p_patient, c_sections, c_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'pregnancy', null, 'antenatal_visits', '[]'::jsonb, 'postnatal_profiles', '[]'::jsonb,
                              'breast_reports', '[]'::jsonb, 'fertility_requests', '[]'::jsonb);
  end if;

  -- The audit row is written FIRST: if it cannot be written the read raises and nothing is returned.
  perform private.audit_chart_read(p_patient, c_sections, c_reason, 'success');

  select to_jsonb(x) into v_preg
    from (select pg.is_pregnant, pg.estimated_due_date, pg.last_menstrual_period_date, pg.high_risk, pg.high_risk_notes
            from public.patient_pregnancy pg where pg.patient_id = p_patient) x;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.gestational_week_at_visit nulls last, a.visit_number), '[]'::jsonb) into v_ante
    from (select id, visit_number, gestational_week_at_visit, status, findings
            from public.antenatal_visits where patient_id = p_patient
           order by gestational_week_at_visit nulls last, visit_number limit c_cap) a;

  select coalesce(jsonb_agg(to_jsonb(p) order by p.delivery_date desc), '[]'::jsonb) into v_post
    from (select id, delivery_date, delivery_mode, complications
            from public.postnatal_profiles where patient_id = p_patient
           order by delivery_date desc limit c_cap) p;

  select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at desc), '[]'::jsonb) into v_breast
    from (select id, created_at, symptom_types, laterality
            from public.breast_symptom_reports where patient_id = p_patient
           order by created_at desc limit 5) b;

  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc), '[]'::jsonb) into v_fert
    from (select id, created_at, trying_duration_months, concern_notes, status
            from public.fertility_assessment_requests where patient_id = p_patient
           order by created_at desc limit c_cap) f;

  return jsonb_build_object('status', 'ok', 'pregnancy', v_preg, 'antenatal_visits', v_ante, 'postnatal_profiles', v_post,
                            'breast_reports', v_breast, 'fertility_requests', v_fert);
end $$;
revoke all on function public.read_womens_health_record_audited(uuid) from public, anon;
grant execute on function public.read_womens_health_record_audited(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. OQ-558: the reason on the cycle report becomes optional (guarded patch of the live body)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.read_reproductive_pattern_report_audited(uuid,text)'::regprocedure);
  v_old_sig text := '(p_patient uuid, p_reason text)';
  v_new_sig text := '(p_patient uuid, p_reason text DEFAULT NULL::text)';
  v_old_chk text := $q$  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;$q$;
  v_new_chk text := $q$  -- OQ-558: no reason to type. A caller that sends none gets the fixed phrase; one that sends a too-short reason is still refused.
  if p_reason is not null and char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  p_reason := coalesce(p_reason, 'Clinician opened the cycle pattern report');$q$;
begin
  if position(v_old_sig in v_def) = 0 or (length(v_def) - length(replace(v_def, v_old_sig, ''))) <> length(v_old_sig) then
    raise exception 'read_reproductive_pattern_report_audited: signature anchor missing or repeated; the live body has moved on, stop and read it';
  end if;
  if position(v_old_chk in v_def) = 0 or (length(v_def) - length(replace(v_def, v_old_chk, ''))) <> length(v_old_chk) then
    raise exception 'read_reproductive_pattern_report_audited: reason-check anchor missing or repeated; the live body has moved on, stop and read it';
  end if;
  execute replace(replace(v_def, v_old_sig, v_new_sig), v_old_chk, v_new_chk);
end $$;
revoke all on function public.read_reproductive_pattern_report_audited(uuid, text) from public, anon;
grant execute on function public.read_reproductive_pattern_report_audited(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The patient's "who opened my record" list also shows openings of the Women's Health record (guarded patch of the live body)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text := pg_get_functiondef('public.my_reproductive_access_log(integer)'::regprocedure);
  v_old text := $q$and a.event -> 'sections' ? 'reproductive_pattern_report'$q$;
  v_new text := $q$and (a.event -> 'sections' ? 'reproductive_pattern_report' or a.event -> 'sections' ? 'womens_health_record')$q$;
begin
  if position(v_old in v_def) = 0 or (length(v_def) - length(replace(v_def, v_old, ''))) <> length(v_old) then
    raise exception 'my_reproductive_access_log: the section filter anchor is missing or repeated; the live body has moved on, stop and read it';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;
revoke all on function public.my_reproductive_access_log(integer) from public, anon;
grant execute on function public.my_reproductive_access_log(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The direct staff read on four tables: the care tie only (written fresh; the patient arm is kept, no caregiver arm exists or is added)
-- ---------------------------------------------------------------------------
alter policy patient_pregnancy_select on public.patient_pregnancy
  using ((patient_id = (select auth.uid())) or private.reproductive_staff_tied(patient_id));
alter policy antenatal_visits_select on public.antenatal_visits
  using ((patient_id = (select auth.uid())) or private.reproductive_staff_tied(patient_id));
alter policy postnatal_profiles_select on public.postnatal_profiles
  using ((patient_id = (select auth.uid())) or private.reproductive_staff_tied(patient_id));
alter policy fertility_assessment_requests_select on public.fertility_assessment_requests
  using ((patient_id = (select auth.uid())) or private.reproductive_staff_tied(patient_id));

-- ---------------------------------------------------------------------------
-- 5. The migration proves what it claims
-- ---------------------------------------------------------------------------
do $$
declare v_t text; v_q text;
begin
  if has_function_privilege('anon', 'public.read_womens_health_record_audited(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.read_reproductive_pattern_report_audited(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.my_reproductive_access_log(integer)', 'EXECUTE') then
    raise exception 'OQ-555: anon can execute a reproductive read function';
  end if;
  if not has_function_privilege('authenticated', 'public.read_womens_health_record_audited(uuid)', 'EXECUTE') then
    raise exception 'OQ-555: authenticated must be able to call the audited Women''s Health read';
  end if;
  if pg_get_functiondef('public.read_womens_health_record_audited(uuid)'::regprocedure) ~ 'can_staff_read_clinical|has_emergency_access|can_support_view|staff_may_read' then
    raise exception 'OQ-555: the audited read names a break-glass, view-as or plain staff check';
  end if;
  foreach v_t in array array['patient_pregnancy', 'antenatal_visits', 'postnatal_profiles', 'fertility_assessment_requests'] loop
    -- permissive policies OR together, so EVERY policy that can grant a read (SELECT or ALL) must be the care tie only, and there must be one
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = v_t and cmd = 'SELECT') then
      raise exception 'OQ-555: no SELECT policy on %', v_t;
    end if;
    for v_q in select coalesce(qual, '') from pg_policies where schemaname = 'public' and tablename = v_t and permissive = 'PERMISSIVE' and cmd in ('SELECT', 'ALL') loop
      if v_q !~ 'reproductive_staff_tied' or v_q ~ 'staff_may_read|is_org_staff|can_support_view|caregiver|can_read_clinical|has_emergency_access' then
        raise exception 'OQ-555: a read policy on % is not the care tie only: %', v_t, v_q;
      end if;
      if v_q !~ 'auth\.uid\(\)' then raise exception 'OQ-555: the patient arm is missing on %', v_t; end if;
    end loop;
  end loop;
  raise notice 'PASS: OQ-555/OQ-558 audited tied Women''s Health read installed';
end $$;

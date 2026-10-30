-- OQ-S98-7 (founder decision, 2026-10-30): a caregiver or guardian can no longer read the order of a SENSITIVE bundle.
--
-- Before: lab_orders_select admitted anyone with the 'labs_results' category grant or the 'view_results' caregiver permission, so the order row
-- (panel_bundle_id, panel_code, order_number) of a sensitive screening request was readable by a caregiver, even though the S98 request status
-- function (my_screening_requests) and the PDF routes already hid the request itself from non-owners.
--
-- After: the caregiver branches of lab_orders_select (both of them) additionally require that the order's bundle is not sensitive. The patient,
-- organisation staff and an emergency-access reader are untouched.
--
-- "Sensitive bundle" has ONE definition, the one S98b already uses to mask the request notification and email: a bundle is sensitive when any of its
-- test_codes is a screen_types row flagged sensitive. private.lab_bundle_is_sensitive wraps exactly that predicate (nothing new is decided here).
-- BREADTH, for the founder: that flag is set on 15 screen types (hiv, hep_b, hep_c, syphilis, chlamydia_gonorrhoea, cervical_smear, psa, fit,
-- mammography, breast_imaging, clinical_breast_exam, prostate_ultrasound, abdominal_ultrasound, colonoscopy, echo), so on the live catalogue 14 of the
-- 32 active bundles count as sensitive, including routine ones (know_your_basics, annual_health_check, the cancer_screen_* bundles, single_fit,
-- single_psa, mens_/womens_health_check). A caregiver therefore no longer sees those orders either. Narrowing it is a change to the S98b flag, not to
-- this migration.
--
-- Other doors that expose the same order (its id, order number, bundle id, specimen number or visit) to a caregiver, found by reading the LIVE
-- policies on every table that carries lab_order_id / panel_bundle_id / order_number, and closed in this same migration so a second permissive
-- policy cannot defeat the first (policies are OR-ed):
--   lab_specimens_select      category branch (lab_order_id, specimen_number)
--   patient_timeline_select   category branch: the 'lab_completed' event (source = the order) and the 'lab_abnormal' event (source = a result that
--                             carries lab_order_id and the result summary)
--   care_vouchers_select      category branch (panel_bundle_id, redeemed order id). A voucher that care_voucher_category files under
--                             reproductive_health keeps its own rule (only an explicit reproductive_health grant opens it, unchanged), except that a
--                             bundle which ALSO holds a non-reproductive sensitive test (HIV, hepatitis, syphilis, chlamydia/gonorrhoea ...) is hidden
--   screening_results_select  caregiver branches: a result row linked (lab_order_id) to a sensitive-bundle order
--   facility_ratings_own, lab_location_reviews_select   caregiver (book_appointments) branch: a rating or review linked to a sensitive-bundle order
-- The view patient_care_gaps (security_invoker) reads lab_orders for its 'awaiting_result' gap and is closed by the lab_orders change alone.
-- Already closed before this change (patient or staff only, no caregiver helper in the policy): lab_order_test_status, lab_result_documents,
-- lab_order_refunds, lab_result_consult_requests, lab_turnaround_alerts, partner_statement_lines.
--
-- NOT changed, deliberately: (a) a result row with NO lab_order_id (recorded directly) and lab_analyte_readings follow the separate sensitive-result
-- rules (restricted release, sensitive_positive) and stay as they are; (b) screening_schedules (a due screening, not an order); (c) sponsor_payable_orders
-- (a payer helper that returns only a generic "A lab test" label, an amount and an id); (d) write RPCs that take an order id (set_lab_order_location
-- and the sponsor RPCs) - they read nothing back.
--
-- Live counts before this migration (all zero, so nothing disappears from a real screen today): sensitive-bundle orders 0, lab_specimens 0,
-- care_vouchers 0, screening_results with an order 0, caregiver grants carrying view_results 0.
--
-- Rollback (the pre-migration text, as read from the live catalogue on 2026-10-30):
--   drop policy lab_orders_select on public.lab_orders;
--   create policy lab_orders_select on public.lab_orders for select to authenticated using (patient_id = (select auth.uid())
--     or private.is_org_staff(organisation_id) or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
--     or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
--     or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission));
--   drop policy lab_specimens_select on public.lab_specimens;
--   create policy lab_specimens_select on public.lab_specimens for select to authenticated using (patient_id = (select auth.uid())
--     or private.is_org_staff(organisation_id) or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
--     or (provider_id is not null and provider_id = private.lab_partner_provider()));
--   drop policy patient_timeline_select on public.patient_timeline;
--   create policy patient_timeline_select on public.patient_timeline for select to authenticated using (patient_id = (select auth.uid())
--     or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
--     or private.can_read_clinical(patient_id, event_category) or private.has_emergency_access(patient_id, event_category));
--   drop policy care_vouchers_select on public.care_vouchers;
--   create policy care_vouchers_select on public.care_vouchers for select to authenticated using (beneficiary_profile_id = (select auth.uid())
--     or purchaser_profile_id = (select auth.uid()) or private.is_org_staff(organisation_id)
--     or private.can_read_clinical(beneficiary_profile_id, private.care_voucher_category(panel_bundle_id)));
--   drop policy screening_results_select on public.screening_results;
--   create policy screening_results_select on public.screening_results for select to authenticated using (
--     private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
--     or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
--     or ((not private.patient_result_blocked(screen_type_code, result_status)) and (patient_id = (select auth.uid())
--         or private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
--         or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))));
--   drop policy facility_ratings_own on public.facility_ratings;
--   create policy facility_ratings_own on public.facility_ratings for select to authenticated using (patient_id = (select auth.uid())
--     or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission));
--   drop policy lab_location_reviews_select on public.lab_location_reviews;
--   create policy lab_location_reviews_select on public.lab_location_reviews for select to authenticated using (patient_id = (select auth.uid())
--     or private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission) or private.is_org_staff(organisation_id) or private.is_admin());
--   then drop the four helper functions below.

create function private.lab_bundle_is_sensitive(p_bundle uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.panel_bundles b
      join public.screen_types st on st.sensitive and st.code = any (b.test_codes)
     where b.id = p_bundle);
$$;
comment on function private.lab_bundle_is_sensitive(uuid) is
  'OQ-S98-7: true when any test in the bundle is a screen_types row flagged sensitive (the same predicate S98b uses to mask the request notification). False for a null or unknown bundle.';

create function private.lab_order_is_sensitive(p_order uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.lab_orders o where o.id = p_order and private.lab_bundle_is_sensitive(o.panel_bundle_id));
$$;
comment on function private.lab_order_is_sensitive(uuid) is
  'OQ-S98-7: true when the order exists and its bundle is sensitive. Runs as definer so a policy on another table can ask without going through lab_orders row security. False for null.';

-- A timeline event points at its source row. Two kinds of source carry a lab order: the order itself ('lab_completed') and a screening result
-- ('lab_abnormal', whose payload holds lab_order_id and the result summary).
create function private.timeline_source_is_sensitive_order(p_table text, p_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select case p_table
    when 'lab_orders' then private.lab_order_is_sensitive(p_id)
    when 'screening_results' then exists (select 1 from public.screening_results sr where sr.id = p_id and private.lab_order_is_sensitive(sr.lab_order_id))
    else false
  end;
$$;
comment on function private.timeline_source_is_sensitive_order(text, uuid) is
  'OQ-S98-7: true when a patient_timeline source (lab_orders, or a screening_results row linked to an order) belongs to a sensitive-bundle order.';

-- care_voucher_category files a bundle under reproductive_health when its tests include one of these five codes (kept in step with that function;
-- the proof compares the two for every bundle). A reproductive-filed bundle that ALSO holds some other sensitive test is not a purely reproductive voucher.
create function private.lab_bundle_has_non_reproductive_sensitive_test(p_bundle uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
      from public.panel_bundles b
      join public.screen_types st on st.sensitive and st.code = any (b.test_codes)
     where b.id = p_bundle
       and st.code <> all (array['cervical_smear', 'clinical_breast_exam', 'breast_imaging', 'prostate_ultrasound', 'psa']::text[]));
$$;
comment on function private.lab_bundle_has_non_reproductive_sensitive_test(uuid) is
  'OQ-S98-7: true when the bundle holds a sensitive test other than the five codes care_voucher_category files under reproductive_health.';

revoke all on function private.lab_bundle_is_sensitive(uuid) from public, anon;
revoke all on function private.lab_order_is_sensitive(uuid) from public, anon;
revoke all on function private.timeline_source_is_sensitive_order(text, uuid) from public, anon;
revoke all on function private.lab_bundle_has_non_reproductive_sensitive_test(uuid) from public, anon;
grant execute on function private.lab_bundle_is_sensitive(uuid) to authenticated, service_role;
grant execute on function private.lab_order_is_sensitive(uuid) to authenticated, service_role;
grant execute on function private.timeline_source_is_sensitive_order(text, uuid) to authenticated, service_role;
grant execute on function private.lab_bundle_has_non_reproductive_sensitive_test(uuid) to authenticated, service_role;

-- Stop if a live policy has drifted from what this migration was written against (so we never silently drop someone else's change).
do $$
declare
  v_expect constant text[][] := array[
    array['lab_orders', 'lab_orders_select', 'private.can_read_clinical(patient_id, ''view_results''::caregiver_permission)'],
    array['lab_orders', 'lab_orders_select', 'private.can_read_clinical(patient_id, ''labs_results''::care_access_category)'],
    array['lab_orders', 'lab_orders_select', 'private.has_emergency_access(patient_id, ''labs_results''::care_access_category)'],
    array['lab_specimens', 'lab_specimens_select', 'private.can_read_clinical(patient_id, ''labs_results''::care_access_category)'],
    array['lab_specimens', 'lab_specimens_select', 'provider_id = private.lab_partner_provider()'],
    array['patient_timeline', 'patient_timeline_select', 'private.can_read_clinical(patient_id, event_category)'],
    array['patient_timeline', 'patient_timeline_select', 'private.has_emergency_access(patient_id, event_category)'],
    array['care_vouchers', 'care_vouchers_select', 'private.can_read_clinical(beneficiary_profile_id, private.care_voucher_category(panel_bundle_id))'],
    array['screening_results', 'screening_results_select', 'private.can_read_clinical(patient_id, ''view_results''::caregiver_permission)'],
    array['screening_results', 'screening_results_select', 'private.can_read_clinical(patient_id, ''labs_results''::care_access_category)'],
    array['screening_results', 'screening_results_select', 'private.patient_result_blocked(screen_type_code, result_status)'],
    array['facility_ratings', 'facility_ratings_own', 'private.can_act_for(patient_id, ''book_appointments''::caregiver_permission)'],
    array['lab_location_reviews', 'lab_location_reviews_select', 'private.can_act_for(patient_id, ''book_appointments''::caregiver_permission)']];
  i integer; v_qual text;
begin
  for i in 1 .. array_length(v_expect, 1) loop
    select qual into v_qual from pg_policies where schemaname = 'public' and tablename = v_expect[i][1] and policyname = v_expect[i][2];
    if v_qual is null then raise exception 'OQ-S98-7: policy %.% not found', v_expect[i][1], v_expect[i][2]; end if;
    if position(v_expect[i][3] in v_qual) = 0 then
      raise exception 'OQ-S98-7: live policy %.% no longer contains %, re-read it before changing it', v_expect[i][1], v_expect[i][2], v_expect[i][3];
    end if;
  end loop;
  -- exactly one SELECT policy on each, so no second permissive door is hiding next to the one being replaced
  if (select count(*) from pg_policies where schemaname = 'public'
        and tablename in ('lab_orders', 'lab_specimens', 'patient_timeline', 'care_vouchers', 'screening_results', 'facility_ratings', 'lab_location_reviews')
        and cmd in ('SELECT', 'ALL')) <> 7 then
    raise exception 'OQ-S98-7: another SELECT or ALL policy now exists on one of the seven tables; review it before continuing';
  end if;
end $$;

drop policy lab_orders_select on public.lab_orders;
create policy lab_orders_select on public.lab_orders for select to authenticated using (
  patient_id = (select auth.uid())
  or private.is_org_staff(organisation_id)
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
  -- a caregiver or guardian: ordinary orders only (OQ-S98-7)
  or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
       or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
      and not private.lab_bundle_is_sensitive(panel_bundle_id))
);

drop policy lab_specimens_select on public.lab_specimens;
create policy lab_specimens_select on public.lab_specimens for select to authenticated using (
  patient_id = (select auth.uid())
  or private.is_org_staff(organisation_id)
  or (private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
      and not private.lab_order_is_sensitive(lab_order_id))
  or (provider_id is not null and provider_id = private.lab_partner_provider())
);

drop policy patient_timeline_select on public.patient_timeline;
create policy patient_timeline_select on public.patient_timeline for select to authenticated using (
  patient_id = (select auth.uid())
  or private.staff_may_read(patient_id, organisation_id, 'medical_history'::public.care_access_category)
  or (private.can_read_clinical(patient_id, event_category)
      and not private.timeline_source_is_sensitive_order(source_table, source_id))
  or private.has_emergency_access(patient_id, event_category)
);

drop policy care_vouchers_select on public.care_vouchers;
create policy care_vouchers_select on public.care_vouchers for select to authenticated using (
  beneficiary_profile_id = (select auth.uid())
  or purchaser_profile_id = (select auth.uid())
  or private.is_org_staff(organisation_id)
  or (private.can_read_clinical(beneficiary_profile_id, private.care_voucher_category(panel_bundle_id))
      -- A voucher filed under reproductive_health keeps its own rule (only an explicit reproductive_health grant opens it; not touched here), unless the
      -- bundle also holds a non-reproductive sensitive test. Any other voucher is hidden when its bundle is sensitive.
      and not (case when private.care_voucher_category(panel_bundle_id) = 'reproductive_health'::public.care_access_category
                    then private.lab_bundle_has_non_reproductive_sensitive_test(panel_bundle_id)
                    else private.lab_bundle_is_sensitive(panel_bundle_id) end))
);

drop policy screening_results_select on public.screening_results;
create policy screening_results_select on public.screening_results for select to authenticated using (
  private.staff_may_read(patient_id, organisation_id, 'labs_results'::public.care_access_category)
  or private.has_emergency_access(patient_id, 'labs_results'::public.care_access_category)
  or ((not private.patient_result_blocked(screen_type_code, result_status))
      and (patient_id = (select auth.uid())
           -- a caregiver or guardian: not a result that belongs to a sensitive-bundle order (OQ-S98-7)
           or ((private.can_read_clinical(patient_id, 'labs_results'::public.care_access_category)
                or private.can_read_clinical(patient_id, 'view_results'::public.caregiver_permission))
               and not private.lab_order_is_sensitive(lab_order_id))))
);

drop policy facility_ratings_own on public.facility_ratings;
create policy facility_ratings_own on public.facility_ratings for select to authenticated using (
  patient_id = (select auth.uid())
  or (private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
      and not private.lab_order_is_sensitive(lab_order_id))
);

drop policy lab_location_reviews_select on public.lab_location_reviews;
create policy lab_location_reviews_select on public.lab_location_reviews for select to authenticated using (
  patient_id = (select auth.uid())
  or (private.can_act_for(patient_id, 'book_appointments'::public.caregiver_permission)
      and not private.lab_order_is_sensitive(lab_order_id))
  or private.is_org_staff(organisation_id)
  or private.is_admin()
);

do $$
begin
  if exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace
       and p.proname in ('lab_bundle_is_sensitive', 'lab_order_is_sensitive', 'timeline_source_is_sensitive_order', 'lab_bundle_has_non_reproductive_sensitive_test')
       and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
    raise exception 'OQ-S98-7 self-check: a helper is callable by anon or not by authenticated (the policies would error)';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public'
        and policyname in ('lab_orders_select', 'lab_specimens_select', 'patient_timeline_select', 'care_vouchers_select', 'screening_results_select', 'facility_ratings_own', 'lab_location_reviews_select')) <> 7 then
    raise exception 'OQ-S98-7 self-check: a policy is missing';
  end if;
  if position('lab_bundle_is_sensitive' in (select qual from pg_policies where tablename = 'lab_orders' and policyname = 'lab_orders_select')) = 0 then
    raise exception 'OQ-S98-7 self-check: lab_orders_select does not carry the exclusion';
  end if;
end $$;

-- Track E (spec 8.16, same class as the S53 pre-fix on pharmacy_medications): what Tarragon earns per lab test, panel, screening
-- type and therapy session must not be readable by a patient, a clinician, a lab partner or any other signed-in user.
-- SAFETY FIX. SHIP THE CODE FIRST: after this migration `select *` on the four tables below raises 42501 by design.
--
-- WHAT WAS EXPOSED (read live, read-only, 2026-10-07, project koiplnmbgnqnbywhpjlf)
--   Table                  rows  rows carrying a commission   exposed columns
--   public.lab_tests         60   10                          commission_rate, commission_rate_type, commission_flat_kobo
--   public.panel_bundles     42    6                          commission_rate_type, commission_rate, commission_flat_kobo
--   public.screen_types      38   21                          commission_rate
--   public.therapy_sessions   0    0                          commission_kobo (the patient's own sessions; clinicians via staff_may_read)
--   Each of the first three had `select using (true)` for role authenticated plus a table-wide SELECT grant, so every logged-in user
--   could read every commission. therapy_sessions rows are visible to the patient who booked them and to clinicians who may read
--   their medical history, and carried the commission Tarragon books on the session.
--
-- ALREADY SAFE (checked, not changed)
--   specialist_providers: select policy is admin or partners.specialists.manage only; the directory views (specialist_directory,
--   therapy_directory) are owner-run and list no commission column. lab_providers and pharmacy_partners were narrowed 2026-09-25.
--   earnings_ledger: own clinician or admin. platform_finance_inputs: no authenticated SELECT.
-- FOUND, NOT CHANGED HERE (OQ-320): lab_orders.partner_cost_kobo / partner_cost_breakdown and pharmacy_orders.partner_cost_*
--   (what Tarragon pays the partner, readable by the ordering patient and any org staff), lab_order_refunds / pharmacy_order_refunds
--   .margin_portion_kobo. All four tables have 0 rows today. Fixing them needs a wider client sweep than this PR.
--
-- LIVE CALLER INVENTORY (all four tables; apps/web, apps/mobile, apps/console, packages, supabase/functions)
--   * Every function that names a commission column (record_lab_commission, record_pharmacy_commission, record_referral_commission,
--     post_therapy_commission, enforce_therapy_session_rules, compute_pharmacy_partner_cost, restrict_lab_test_partner_edit_to_
--     availability, ...) is SECURITY DEFINER with search_path = '' (pg_proc, 8 of 8). No SECURITY INVOKER function names these
--     tables; patient_care_gaps joins screen_types / panel_bundles but reads only `name`.
--   * Client reads that used select("*") and are switched to explicit columns in the same PR: web useLabCatalogue, useAllPanelBundles
--     (now panel_bundles_admin), useLabPartnerOwnTests, useMyTherapySessions, therapy-approvals queue; mobile loadLabPanelBundles,
--     loadMyTherapySessions. Every other read (about 30 embeds and selects) already named its columns and names no commission column.
--   * public.approve_therapy_session (SECURITY DEFINER) returned the whole therapy_sessions row, handing commission_kobo back to a
--     clinician; it now returns void (section 5b). Live scan of every public function returning one of the four row types, or doing
--     `returning *` on them in a definer body: this was the only one.
--   * Writers are unchanged: the admin and partner-manager commission edits are plain UPDATEs (table UPDATE grant is untouched, no
--     RETURNING), the lab partner's is_active toggle, the patient's therapy_sessions INSERT (the BEFORE INSERT trigger fills
--     commission_kobo as the function owner).
--
-- HOW (same pattern as 20261007002834 for pharmacy_medications)
--   A column REVOKE is a no-op under a table-level grant, so the table-level SELECT is revoked from authenticated and anon and SELECT
--   is granted on the safe column list. Any column added later is NOT readable until it is added to a grant: the intended default.
--   Admin, partner managers (partners.labs.manage) and finance (commissions.view) read the full rows through
--   lab_tests_admin / panel_bundles_admin / screen_types_admin: owner-run (security_invoker = false), the predicate is in the view,
--   so any other caller gets zero rows. There is no therapy_sessions admin view: nothing reads that column from a client; the
--   commissions ledger carries the same figure for finance.
--   Row policies are unchanged.

begin;

-- 1. lab_tests
revoke select on public.lab_tests from authenticated, anon;
grant select (id, provider_id, code, name, price_kobo, turnaround_hours, is_active, created_at) on public.lab_tests to authenticated;

-- 2. panel_bundles
revoke select on public.panel_bundles from authenticated, anon;
grant select (
  id, code, name, description, price_kobo, test_codes, is_active, created_at, self_bookable, review_discount_bp, is_screen_tier,
  preparation_instructions, category, clinical_protocol_ref, guidance_only, indicative_price_kobo, indicative_price_source,
  indicative_price_checked_on, where_to_get
) on public.panel_bundles to authenticated;

-- 3. screen_types
revoke select on public.screen_types from authenticated, anon;
grant select (
  id, code, name, sex_applicability, age_from, age_to, frequency_months, recommended_provider_type, is_active, created_at, sensitive,
  fulfilment_dormant, price_kobo, price_source, once_per_lifetime, is_optional, clinical_basis, reopens_on_exposure, category,
  home_kit_available, specimen_type, preparation_instructions, units, reference_range_text, patient_explainer, guidance_only,
  indicative_price_kobo, indicative_price_source, indicative_price_checked_on, where_to_get
) on public.screen_types to authenticated;

-- 4. therapy_sessions
revoke select on public.therapy_sessions from authenticated, anon;
grant select (
  id, organisation_id, patient_id, provider_id, status, modality, requested_at, scheduled_for, completed_at, cancelled_at,
  cancelled_reason, fee_kobo, payment_provider_ref, approved_by, approved_at, clinician_alert_id, patient_note, created_at, updated_at
) on public.therapy_sessions to authenticated;

-- 5. Full rows, for admin, partner managers and finance only (owner-run, predicate inside the view)
create view public.lab_tests_admin with (security_invoker = false) as
  select lt.* from public.lab_tests lt
  where private.is_admin() or private.has_permission('partners.labs.manage'::text) or private.has_permission('commissions.view'::text);
create view public.panel_bundles_admin with (security_invoker = false) as
  select pb.* from public.panel_bundles pb
  where private.is_admin() or private.has_permission('partners.labs.manage'::text) or private.has_permission('commissions.view'::text);
create view public.screen_types_admin with (security_invoker = false) as
  select st.* from public.screen_types st
  where private.is_admin() or private.has_permission('partners.labs.manage'::text) or private.has_permission('commissions.view'::text);
comment on view public.lab_tests_admin is 'Track E 8.16. The only read path that carries lab_tests.commission_*. Owner-run on purpose; the predicate is in the view. Do not select it from patient, clinician or partner code.';
comment on view public.panel_bundles_admin is 'Track E 8.16. The only read path that carries panel_bundles.commission_*. Owner-run on purpose; the predicate is in the view. Do not select it from patient, clinician or partner code.';
comment on view public.screen_types_admin is 'Track E 8.16. The only read path that carries screen_types.commission_rate. Owner-run on purpose; the predicate is in the view. Do not select it from patient, clinician or partner code.';
revoke all on public.lab_tests_admin, public.panel_bundles_admin, public.screen_types_admin from public, anon;
grant select on public.lab_tests_admin, public.panel_bundles_admin, public.screen_types_admin to authenticated;

-- 5b. public.approve_therapy_session returned the whole therapy_sessions row (SECURITY DEFINER, `returning * into v_row`), so a
-- clinician calling it over the API received commission_kobo in the response body. The only caller (the therapy-approvals queue)
-- reads `error` and ignores the body, so it now returns void. A return type cannot change under CREATE OR REPLACE, hence drop and
-- recreate with the same body, same SECURITY DEFINER and search_path, and the same grants (authenticated only, not public/anon).
-- The deployed old web bundle ignores the body too, so this is safe in either deploy order.
drop function public.approve_therapy_session(uuid, boolean);
create function public.approve_therapy_session(p_session_id uuid, p_confirm boolean default true)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_org    uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  select organisation_id into v_org from public.therapy_sessions where id = p_session_id;
  if v_org is null then
    raise exception 'That request no longer exists.' using errcode = 'P0001';
  end if;
  if not private.is_org_staff(v_org) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- approved_by is taken from the SESSION, never from a parameter. A caller cannot nominate someone else as the approver.
  update public.therapy_sessions
     set approved_by = v_caller,
         approved_at = now(),
         status      = case when p_confirm then 'confirmed'::public.therapy_session_status
                            else 'cancelled'::public.therapy_session_status end,
         cancelled_at = case when p_confirm then null else now() end,
         cancelled_reason = case when p_confirm then null
                                 else 'Not approved by the care team' end
   where id = p_session_id;
end;
$function$;
comment on function public.approve_therapy_session(uuid, boolean) is
  'Approve or decline a psychiatry booking. Stamps approved_by from auth.uid(); the authority check itself lives in private.enforce_therapy_approver_authority so it holds on any write path, not only this one. Track E 8.16: returns void, never the row, so the commission is not handed back to a clinician.';
revoke all on function public.approve_therapy_session(uuid, boolean) from public, anon;
grant execute on function public.approve_therapy_session(uuid, boolean) to authenticated;

-- 6. Assertions
do $$
declare
  t text;
  c text;
  spec jsonb := '{"lab_tests":["commission_rate","commission_rate_type","commission_flat_kobo"],
                  "panel_bundles":["commission_rate","commission_rate_type","commission_flat_kobo"],
                  "screen_types":["commission_rate"],
                  "therapy_sessions":["commission_kobo"]}';
begin
  for t in select jsonb_object_keys(spec) loop
    for c in select jsonb_array_elements_text(spec -> t) loop
      if has_column_privilege('authenticated', format('public.%I', t), c, 'SELECT') then
        raise exception 'FAIL: authenticated can still SELECT %.%', t, c;
      end if;
      if has_column_privilege('anon', format('public.%I', t), c, 'SELECT') then
        raise exception 'FAIL: anon can SELECT %.%', t, c;
      end if;
    end loop;
    if not has_column_privilege('authenticated', format('public.%I', t), 'id', 'SELECT') then
      raise exception 'FAIL: authenticated lost SELECT on %.id', t;
    end if;
    -- the commission editors are plain UPDATEs, so the table-level UPDATE grant must survive
    if not has_table_privilege('authenticated', format('public.%I', t), 'UPDATE') then
      raise exception 'FAIL: authenticated lost UPDATE on %', t;
    end if;
  end loop;
  foreach t in array array['lab_tests_admin', 'panel_bundles_admin', 'screen_types_admin'] loop
    if has_table_privilege('anon', format('public.%I', t), 'SELECT') then raise exception 'FAIL: anon can SELECT %', t; end if;
  end loop;
  foreach c in array array['price_kobo', 'name', 'code', 'is_active'] loop
    if not has_column_privilege('authenticated', 'public.lab_tests', c, 'SELECT') then raise exception 'FAIL: lab_tests.% unreadable', c; end if;
    if not has_column_privilege('authenticated', 'public.panel_bundles', c, 'SELECT') then raise exception 'FAIL: panel_bundles.% unreadable', c; end if;
  end loop;
  -- any column that is unreadable but not a deliberate commission omission means the grant list is stale
  for t, c in
    select a.attrelid::regclass::text, a.attname from pg_attribute a
    where a.attrelid in ('public.lab_tests'::regclass, 'public.panel_bundles'::regclass, 'public.screen_types'::regclass, 'public.therapy_sessions'::regclass)
      and a.attnum > 0 and not a.attisdropped
      and not has_column_privilege('authenticated', a.attrelid, a.attname, 'SELECT')
      and a.attname not in ('commission_rate', 'commission_rate_type', 'commission_flat_kobo', 'commission_kobo')
  loop
    raise exception 'FAIL: % column % is neither granted nor a commission column; add it to the grant', t, c;
  end loop;
  if pg_get_function_result('public.approve_therapy_session(uuid, boolean)'::regprocedure) <> 'void' then
    raise exception 'FAIL: approve_therapy_session still returns a row';
  end if;
  if has_function_privilege('anon', 'public.approve_therapy_session(uuid, boolean)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.approve_therapy_session(uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: approve_therapy_session grants are wrong';
  end if;
  raise notice 'PASS: lab, screening and therapy commission columns are off the authenticated surface';
end $$;

commit;

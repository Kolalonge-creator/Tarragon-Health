-- OQ-192: close the remaining profile_access paths that admit a grantee without checking what they were granted.
--
-- Live audit 2026-10-21 against koiplnmbgnqnbywhpjlf (read-only pg_policies + pg_proc.prosrc scan):
--   * profile_access rows live: 0 (so no existing grant can lose access; there is nothing to convert).
--   * 24 policies and about 45 functions mention profile_access. S71 had already fixed create_order, booking_requests_select,
--     vaccination_adverse_events_select, vaccination_card_extractions_select and profiles_select.
--   * Still loose, fixed here:
--       - vaccination_records_insert/update, vaccination_schedules_update, vaccination_adverse_events_insert,
--         vaccination_card_extractions_insert/update: 'manage' level only. A manage grantee with no vaccinations category
--         (an adult proxy) could WRITE what the matching SELECT policy hides from them, and an expired grant still passed.
--         Now: private.can_act_for(patient) (manage + unexpired) AND can_read_clinical(patient, 'vaccinations').
--       - booking_requests_insert, menstrual_cycles / menstrual_daily_logs insert/update/delete,
--         reproductive_health_profiles insert/update: manage (and category) but no expiry check. Expiry added only; the
--         reproductive category requirement is unchanged and is NOT relaxed to the dependent bypass.
--       - dependant_handovers_read: any grantee, even expired or with an empty permission list. Now private.profile_access_active().
--       - private.can_purchase_voucher_for and public.price_review_for_patient: an EXPIRED grantee could still buy or price.
--         Expiry added only. A view-level grantee may still buy a voucher or see a price: the client picker
--         (profilesGrantedTo) documents 'money may flow in from anyone the record owner has consented to', and a price quote
--         reveals nothing clinical. Requiring manage_payments there is a product call, left to the founder (OQ-192).
--       - public.redeem_promo_code and public.create_transaction_subsidy: manage level but not manage_payments, no expiry.
--       - public.report_exposure and public.sponsor_set_dependent_basics: manage level, no expiry.
--   * Left alone on purpose: profiles_select (OQ-404, founder decision); care_receipt / resolve_patient_service_access /
--     sponsor_care_status (they only reveal what the grant already allows, care_receipt money is limited to the caller's own
--     vouchers, and expired rows are deleted by private.expire_stale_profile_access()).
--   * booking_requests_insert gets expiry only, not book_appointments: category-model grants never carry that permission
--     (private.category_permissions has no mapping to it), so requiring it would silently stop proxies booking. See OQ-192.
--
-- Function bodies are patched from their live definition with an exact-change assertion (a hand-retyped copy of a 5 000
-- character function is the likelier bug). Policies keep their roles (ALTER POLICY). CREATE OR REPLACE keeps the ACL.

create or replace function private.can_purchase_voucher_for(p_beneficiary uuid, p_purchaser uuid)
returns boolean
language sql stable security definer
set search_path to ''
as $function$
  select p_beneficiary = p_purchaser
      or exists (
        select 1 from public.profile_access pa
        where pa.profile_id = p_beneficiary and pa.grantee_user_id = p_purchaser
          and (pa.expires_at is null or pa.expires_at > now())
      );
$function$;

do $$
declare
  r record;
  v_def text;
  v_new text;
  v_q text; v_w text; v_nq text; v_nw text;
begin
  -- ---- functions ---------------------------------------------------------
  for r in select * from (values
    ('public.price_review_for_patient(uuid,text)',
     $p$exists\s*\(\s*select 1 from public\.profile_access pa\s+where pa\.profile_id = p_patient_id\s+and pa\.grantee_user_id = v_caller\s*\)$p$,
     $p$exists (select 1 from public.profile_access pa where pa.profile_id = p_patient_id and pa.grantee_user_id = v_caller and (pa.expires_at is null or pa.expires_at > now()))$p$, 'expires_at'),
    ('public.redeem_promo_code(text,text,uuid)',
     $p$not exists\s*\(\s*select 1 from public\.profile_access pa\s+where pa\.profile_id = v_patient and pa\.grantee_user_id = v_caller and pa\.permission_level = 'manage'\s*\)$p$,
     $p$not private.can_act_for(v_patient, 'manage_payments'::public.caregiver_permission)$p$, 'manage_payments'),
    ('public.create_transaction_subsidy(text,uuid,uuid)',
     $p$pa\.grantee_user_id = p_sponsor_profile_id and pa\.permission_level = 'manage'$p$,
     $p$pa.grantee_user_id = p_sponsor_profile_id and pa.permission_level = 'manage' and (pa.expires_at is null or pa.expires_at > now()) and (pa.permissions is null or 'manage_payments'::public.caregiver_permission = any(pa.permissions))$p$, 'manage_payments'),
    ('public.report_exposure(uuid,text,date,text)',
     $p$pa\.grantee_user_id = v_caller\s+and pa\.permission_level = 'manage'$p$,
     $p$pa.grantee_user_id = v_caller and pa.permission_level = 'manage' and (pa.expires_at is null or pa.expires_at > now())$p$, 'expires_at'),
    ('public.sponsor_set_dependent_basics(uuid,date,text,text,text)',
     $p$pa\.grantee_user_id = v_caller\s+and pa\.permission_level = 'manage'$p$,
     $p$pa.grantee_user_id = v_caller and pa.permission_level = 'manage' and (pa.expires_at is null or pa.expires_at > now())$p$, 'expires_at')
  ) as t(sig, pat, rep, marker)
  loop
    v_def := pg_get_functiondef(r.sig::regprocedure);
    v_new := regexp_replace(v_def, r.pat, r.rep, 'g');
    if v_new = v_def then
      raise exception 'OQ-192 patch: pattern not found in %', r.sig;
    end if;
    if position(r.marker in v_new) = 0 then
      raise exception 'OQ-192 patch: marker % missing after patching %', r.marker, r.sig;
    end if;
    execute v_new;
  end loop;

  -- ---- policies ----------------------------------------------------------
  for r in select * from (values
    ('vaccination_records','vaccination_records_insert','vacc'),
    ('vaccination_records','vaccination_records_update','vacc'),
    ('vaccination_schedules','vaccination_schedules_update','vacc'),
    ('vaccination_adverse_events','vaccination_adverse_events_insert','vacc'),
    ('vaccination_card_extractions','vaccination_card_extractions_insert','vacc'),
    ('vaccination_card_extractions','vaccination_card_extractions_update','vacc'),
    ('booking_requests','booking_requests_insert','expiry'),
    ('menstrual_cycles','menstrual_cycles_insert','expiry'),
    ('menstrual_cycles','menstrual_cycles_update','expiry'),
    ('menstrual_cycles','menstrual_cycles_delete','expiry'),
    ('menstrual_daily_logs','menstrual_daily_logs_insert','expiry'),
    ('menstrual_daily_logs','menstrual_daily_logs_update','expiry'),
    ('menstrual_daily_logs','menstrual_daily_logs_delete','expiry'),
    ('reproductive_health_profiles','reproductive_health_profiles_insert','expiry'),
    ('reproductive_health_profiles','reproductive_health_profiles_update','expiry'),
    ('dependant_handovers','dependant_handovers_read','handover')
  ) as t(tbl, pol, kind)
  loop
    select qual, with_check into v_q, v_w from pg_policies
     where schemaname = 'public' and tablename = r.tbl and policyname = r.pol;
    if not found then raise exception 'OQ-192 patch: policy %.% not found', r.tbl, r.pol; end if;

    v_nq := v_q; v_nw := v_w;
    if r.kind = 'vacc' then
      v_nq := regexp_replace(v_q, $p$\(EXISTS \( SELECT 1\s+FROM profile_access pa\s+WHERE \(\(pa\.profile_id = (\w+)\.(\w+)\) AND \(pa\.grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\) AND \(pa\.permission_level = 'manage'::profile_access_level\)\)\)\)$p$,
        $p$(private.can_act_for(\1.\2) AND private.can_read_clinical(\1.\2, 'vaccinations'::care_access_category))$p$, 'g');
      v_nw := regexp_replace(v_w, $p$\(EXISTS \( SELECT 1\s+FROM profile_access pa\s+WHERE \(\(pa\.profile_id = (\w+)\.(\w+)\) AND \(pa\.grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\) AND \(pa\.permission_level = 'manage'::profile_access_level\)\)\)\)$p$,
        $p$(private.can_act_for(\1.\2) AND private.can_read_clinical(\1.\2, 'vaccinations'::care_access_category))$p$, 'g');
    elsif r.kind = 'expiry' then
      v_nq := replace(v_q, $p$(pa.permission_level = 'manage'::profile_access_level)$p$,
                      $p$(pa.permission_level = 'manage'::profile_access_level) AND (pa.expires_at IS NULL OR pa.expires_at > now())$p$);
      v_nw := replace(v_w, $p$(pa.permission_level = 'manage'::profile_access_level)$p$,
                      $p$(pa.permission_level = 'manage'::profile_access_level) AND (pa.expires_at IS NULL OR pa.expires_at > now())$p$);
    else -- handover
      v_nq := regexp_replace(v_q, $p$\(EXISTS \( SELECT 1\s+FROM profile_access pa\s+WHERE \(\(pa\.profile_id = dependant_handovers\.patient_id\) AND \(pa\.grantee_user_id = \( SELECT auth\.uid\(\) AS uid\)\)\)\)\)$p$,
        $p$private.profile_access_active(dependant_handovers.patient_id)$p$, 'g');
    end if;

    if (nullif(v_q, '') is not null and v_nq is not distinct from v_q)
       or (nullif(v_w, '') is not null and v_nw is not distinct from v_w) then
      raise exception 'OQ-192 patch: policy %.% unchanged', r.tbl, r.pol;
    end if;

    if nullif(v_q, '') is not null and nullif(v_w, '') is not null then
      execute format('alter policy %I on public.%I using (%s) with check (%s)', r.pol, r.tbl, v_nq, v_nw);
    elsif nullif(v_q, '') is not null then
      execute format('alter policy %I on public.%I using (%s)', r.pol, r.tbl, v_nq);
    else
      execute format('alter policy %I on public.%I with check (%s)', r.pol, r.tbl, v_nw);
    end if;
  end loop;

  -- ---- self-check --------------------------------------------------------
  if exists (select 1 from pg_policies
              where schemaname = 'public'
                and coalesce(qual,'') || coalesce(with_check,'') ilike '%profile_access_level%'
                and coalesce(qual,'') || coalesce(with_check,'') not ilike '%expires_at%'
                and coalesce(qual,'') || coalesce(with_check,'') not ilike '%can_act_for%') then
    raise exception 'OQ-192: a policy still checks a manage grant without expiry';
  end if;
  if exists (select 1 from pg_policies
              where tablename in ('vaccination_records','vaccination_schedules','vaccination_adverse_events','vaccination_card_extractions')
                and cmd in ('INSERT','UPDATE')
                and coalesce(qual,'') || coalesce(with_check,'') ilike '%profile_access pa%') then
    raise exception 'OQ-192: a vaccination write policy still reads profile_access directly';
  end if;
  if has_function_privilege('anon', 'public.price_review_for_patient(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.can_purchase_voucher_for(uuid,uuid)', 'EXECUTE') then
    raise exception 'OQ-192: anon can execute a patched function';
  end if;
end $$;

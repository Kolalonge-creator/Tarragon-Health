-- S05e part 1 of 2: specialist_referrals moves to the audited, visibility-scoped path (INV-10, INV-12, OQ-54; founder rulings 2026-10-01).
--
-- Visibility rule (a referral is a work queue, so the tie alone does not fit): a staff member sees a referral when she is tied to the
-- patient (or has break-glass / a support session), or is the clinician who created it, or the specialist assigned to it, or runs the
-- referral desk (Chief Medical Officer, Care Coordinator) in the patient's organisation. Other doctors do not. Counts follow the same rule.
--
-- Counted first (live, 2026-10-01): specialist_referrals 0 rows. Staff user-session readers and writers: the referral hooks, the referral
-- detail page and its actions, the case file, the sidebar counts, and the patient_care_gaps view (overdue_referral branch). Every
-- database function touching the table is SECURITY DEFINER except private.stamp_referral_signature (it reads only NEW / OLD).
-- Patient-side readers (your referrals, the letter, fertility, mobile) read the patient's own rows and are untouched. Part 2 closes the
-- table and is applied only after this code has deployed.
--
-- Reads: list_referrals_audited, get_referral_audited, list_patient_referrals_audited, referral_worklist_count.
-- Writes (one per action, each applies the rule, then the existing triggers and CHECKs still run): create_specialist_referral,
--   submit_draft_referral, set_referral_urgency, record_referral_treatment_plan, record_referral_shared_care_handback, waitlist_referral,
--   decline_referral, close_referral, set_referral_clinical_summary, set_referral_outcome_document; set_referral_specialist_provider now
--   uses the same rule instead of any org staff.
-- patient_care_gaps: its overdue_referral branch reads through a definer function. An end user's own session sees only the referrals the
-- rule lets her see; every other reader (service role, cron, the definer functions behind analytics, population and outreach queueing)
-- keeps seeing all of them, so closing the table cannot silently drop gaps from those.

create or replace function private.referral_desk()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clinical_staff cs
     where cs.profile_id = (select auth.uid()) and cs.active and cs.doctor_tier in ('chief_medical_officer', 'care_coordinator'));
$$;
revoke all on function private.referral_desk() from public, anon;
grant execute on function private.referral_desk() to authenticated;

create or replace function private.referral_visible(p_patient uuid, p_org uuid, p_referred_by uuid, p_assigned uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select auth.uid()) is not null and (
         private.can_staff_read_clinical(p_patient, 'appointments_care_plan')
      or (private.my_clinical_staff_id() is not null
          and (p_referred_by = private.my_clinical_staff_id() or p_assigned = private.my_clinical_staff_id()))
      or (private.is_org_staff(p_org) and private.referral_desk())
    ), false);
$$;
revoke all on function private.referral_visible(uuid, uuid, uuid, uuid) from public, anon;
grant execute on function private.referral_visible(uuid, uuid, uuid, uuid) to authenticated;

-- The row, with the joins the screens render, as jsonb.
create or replace function private.referral_json(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select to_jsonb(sr)
         || jsonb_build_object(
              'patient', jsonb_build_object('full_name', p.full_name),
              'specialist_provider', case when sp.id is null then null
                                          else jsonb_build_object('name', sp.name, 'consultation_fee_kobo', sp.consultation_fee_kobo) end)
    from public.specialist_referrals sr
    left join public.profiles p on p.id = sr.patient_id
    left join public.specialist_providers sp on sp.id = sr.specialist_provider_id
   where sr.id = p_id;
$$;
revoke all on function private.referral_json(uuid) from public, anon, authenticated;

create or replace function private.may_work_on_referral(p_referral uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.specialist_referrals%rowtype;
begin
  select * into v from public.specialist_referrals where id = p_referral;
  -- An unknown id and a referral you may not see are indistinguishable on purpose.
  if v.id is null or not private.referral_visible(v.patient_id, v.organisation_id, v.referred_by, v.assigned_specialist_id) then
    raise exception 'referral not found or not available to you' using errcode = '42501';
  end if;
  return v.patient_id;
end;
$$;
revoke all on function private.may_work_on_referral(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------
create or replace function public.list_referrals_audited(p_status public.referral_status default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_page constant integer := 500;                      -- technical page size, not a clinical value
  v_rows jsonb;
begin
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(private.referral_json(x.id) order by x.sort_waitlisted nulls last, x.created_at desc), '[]'::jsonb) into v_rows from (
    select sr.id, sr.created_at, case when p_status = 'waitlisted' then sr.waitlisted_at end as sort_waitlisted
      from public.specialist_referrals sr
     where (p_status is null or sr.status = p_status)
       and private.referral_visible(sr.patient_id, sr.organisation_id, sr.referred_by, sr.assigned_specialist_id)
     order by case when p_status = 'waitlisted' then sr.waitlisted_at end asc nulls last, sr.created_at desc
     limit c_page) x;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, event, result, ip)
  values (private.current_org_id(), (select auth.uid()), 'staff.referral_queue_read', 'specialist_referrals',
          jsonb_build_object('status_filter', p_status, 'result_count', jsonb_array_length(v_rows)), 'success', private.request_ip());
  return v_rows;
end;
$$;

create or replace function public.get_referral_audited(p_referral uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.specialist_referrals%rowtype;
  v_json jsonb;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select * into v from public.specialist_referrals where id = p_referral;
  if v.id is null then
    return jsonb_build_object('status', 'denied');          -- indistinguishable from a referral you may not see
  end if;
  if not private.referral_visible(v.patient_id, v.organisation_id, v.referred_by, v.assigned_specialist_id) then
    perform private.audit_chart_read(v.patient_id, array['referrals'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied');
  end if;
  perform private.audit_chart_read(v.patient_id, array['referrals'], p_reason, 'success');
  v_json := private.referral_json(v.id)
            || jsonb_build_object('screening_result', (
                 select jsonb_build_object('id', r.id, 'result_status', r.result_status, 'result_summary', r.result_summary,
                                           'abnormal_flags', r.abnormal_flags, 'created_at', r.created_at)
                   from public.screening_upgrades su
                   join public.screening_results r on r.id = su.screening_result_id
                  where su.id = v.screening_upgrade_id));
  return jsonb_build_object('status', 'ok', 'referral', v_json);
end;
$$;

create or replace function public.list_patient_referrals_audited(p_patient uuid, p_reason text, p_include_drafts boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_tied boolean;
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a reason of at least 10 characters is required' using errcode = '22023';
  end if;
  if (select auth.uid()) is null
     or exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'patient') then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  v_tied := private.can_staff_read_clinical(p_patient, 'appointments_care_plan');
  select coalesce(jsonb_agg(private.referral_json(x.id) order by x.created_at desc), '[]'::jsonb) into v_rows from (
    select sr.id, sr.created_at from public.specialist_referrals sr
     where sr.patient_id = p_patient and (p_include_drafts or sr.status <> 'draft')
       and private.referral_visible(sr.patient_id, sr.organisation_id, sr.referred_by, sr.assigned_specialist_id)
     order by sr.created_at desc limit 500) x;
  -- Nothing visible and not tied or on the desk is a refusal, not an empty list.
  if jsonb_array_length(v_rows) = 0 and not v_tied and not private.referral_desk() then
    perform private.audit_chart_read(p_patient, array['referrals'], p_reason, 'denied');
    return jsonb_build_object('status', 'denied', 'referrals', '[]'::jsonb);
  end if;
  perform private.audit_chart_read(p_patient, array['referrals'], p_reason, 'success');
  return jsonb_build_object('status', 'ok', 'referrals', v_rows);
end;
$$;

create or replace function public.referral_worklist_count(p_kind text)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  if p_kind is null or p_kind not in ('needing_urgency', 'waitlisted', 'awaiting_closure') then
    raise exception 'unknown referral count kind' using errcode = '22023';     -- an error, not a quiet zero
  end if;
  select count(*)::integer into v_n from (
    select sr.patient_id, sr.organisation_id, sr.referred_by, sr.assigned_specialist_id
      from public.specialist_referrals sr
     where case p_kind
             when 'needing_urgency'  then sr.status = 'pending'
             when 'waitlisted'       then sr.status = 'waitlisted'
             else sr.status = 'completed' and (sr.treatment_plan_received_at is not null or sr.outcome_document_path is not null)
           end
     offset 0                             -- status filter first: the visibility rule is the expensive part
  ) s
  where private.referral_visible(s.patient_id, s.organisation_id, s.referred_by, s.assigned_specialist_id);
  return v_n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Writes
-- ---------------------------------------------------------------------------
create or replace function public.create_specialist_referral(
  p_patient uuid, p_specialist_type public.specialist_type, p_referral_source public.referral_source, p_urgency public.referral_urgency,
  p_reason text, p_requested_service text, p_flags jsonb, p_as_draft boolean)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not authorised' using errcode = '42501';
  end if;
  select organisation_id into v_org from public.profiles where id = p_patient and role = 'patient';
  if v_org is null then
    raise exception 'patient not found' using errcode = 'P0002';
  end if;
  if not private.can_staff_read_clinical(p_patient, 'appointments_care_plan') then
    raise exception 'not authorised for this patient' using errcode = '42501';
  end if;
  -- private.enforce_specialist_referral_create still requires a clinical-tier member and re-derives the organisation.
  insert into public.specialist_referrals
    (organisation_id, patient_id, specialist_type, referral_source, urgency, referral_reason, requested_service, appropriateness_flags, status)
  values
    (v_org, p_patient, p_specialist_type, p_referral_source, p_urgency, nullif(btrim(p_reason), ''), nullif(btrim(p_requested_service), ''),
     coalesce(p_flags, '[]'::jsonb), case when p_as_draft then 'draft'::public.referral_status else 'pending'::public.referral_status end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.submit_draft_referral(p_referral uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set status = 'pending' where id = p_referral;
end; $$;

create or replace function public.set_referral_urgency(p_referral uuid, p_urgency public.referral_urgency)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set urgency = p_urgency, set_by = (select auth.uid()) where id = p_referral;
end; $$;

create or replace function public.record_referral_treatment_plan(p_referral uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set treatment_plan_received_at = now(), treatment_plan_note = p_note where id = p_referral;
end; $$;

create or replace function public.record_referral_shared_care_handback(p_referral uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set shared_care_handback_at = now() where id = p_referral;
end; $$;

create or replace function public.waitlist_referral(p_referral uuid, p_interim_management_plan text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals
     set status = 'waitlisted', interim_management_plan = p_interim_management_plan, waitlisted_at = now()
   where id = p_referral;
end; $$;

create or replace function public.decline_referral(p_referral uuid, p_declined_reason text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set status = 'declined', declined_reason = p_declined_reason where id = p_referral;
end; $$;

create or replace function public.close_referral(p_referral uuid, p_care_plan_update_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set status = 'closed', care_plan_update_note = p_care_plan_update_note where id = p_referral;
end; $$;

create or replace function public.set_referral_clinical_summary(p_referral uuid, p_summary jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.may_work_on_referral(p_referral);
  update public.specialist_referrals set clinical_summary = p_summary, set_by = (select auth.uid()) where id = p_referral;
end; $$;

create or replace function public.set_referral_outcome_document(p_referral uuid, p_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_patient uuid;
begin
  v_patient := private.may_work_on_referral(p_referral);
  -- The referral page signs this path with the service role, so it may only name a file in this patient's own folder.
  if p_path is null or p_path not like v_patient::text || '/%' or p_path like '%..%' then
    raise exception 'the outcome document must be stored in this patient''s folder' using errcode = '22023';
  end if;
  -- outcome_document_uploaded_by is stamped from auth.uid() by the existing trigger, as it was for the direct update.
  update public.specialist_referrals set outcome_document_path = p_path where id = p_referral;
end; $$;

-- Assigning a provider now needs the same visibility, not just org membership. Body otherwise unchanged.
create or replace function public.set_referral_specialist_provider(p_referral_id uuid, p_specialist_provider_id uuid)
returns public.specialist_referrals
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ref public.specialist_referrals%rowtype;
  v_provider public.specialist_providers%rowtype;
begin
  select * into v_ref from public.specialist_referrals where id = p_referral_id for update;
  if v_ref.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;

  if not private.referral_visible(v_ref.patient_id, v_ref.organisation_id, v_ref.referred_by, v_ref.assigned_specialist_id) then
    raise exception 'Only your care team can assign a specialist provider' using errcode = '42501';
  end if;

  if v_ref.status not in ('pending', 'waitlisted') then
    raise exception 'This referral has already moved past assignment' using errcode = '23514';
  end if;

  select * into v_provider from public.specialist_providers where id = p_specialist_provider_id;
  if v_provider.id is null or not v_provider.is_active then
    raise exception 'That specialist is not on file as an active partner' using errcode = '23514';
  end if;
  if v_provider.specialist_type <> v_ref.specialist_type then
    raise exception 'That specialist''s type does not match this referral''s specialty' using errcode = '23514';
  end if;

  update public.specialist_referrals
  set fulfilment = 'partner',
      specialist_provider_id = p_specialist_provider_id,
      referral_fee_kobo = v_provider.consultation_fee_kobo,
      status = 'pending_payment',
      waitlisted_at = null
  where id = p_referral_id
  returning * into v_ref;

  return v_ref;
end;
$$;

-- ---------------------------------------------------------------------------
-- patient_care_gaps: the overdue_referral branch reads through a rule-applying definer function
-- ---------------------------------------------------------------------------
create or replace function private.overdue_referral_gap_rows()
returns table (gap_type text, patient_id uuid, organisation_id uuid, condition_or_type text, opened_at timestamptz, detail jsonb, visible boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select 'overdue_referral'::text, sr3.patient_id, sr3.organisation_id, sr3.specialist_type::text,
         coalesce(sr3.submitted_at, sr3.created_at),
         jsonb_build_object('referral_id', sr3.id, 'referral_number', sr3.referral_number, 'status', sr3.status,
                            'specialist_type', sr3.specialist_type),
         private.referral_visible(sr3.patient_id, sr3.organisation_id, sr3.referred_by, sr3.assigned_specialist_id)
    from public.specialist_referrals sr3
   where sr3.status <> all (array['completed'::public.referral_status, 'closed'::public.referral_status,
                                   'declined'::public.referral_status, 'draft'::public.referral_status])
     and sr3.closed_at is null and sr3.treatment_plan_received_at is null
     and coalesce(sr3.submitted_at, sr3.created_at) < (now() - interval '30 days');
$$;
revoke all on function private.overdue_referral_gap_rows() from public, anon;
grant execute on function private.overdue_referral_gap_rows() to authenticated, service_role;

create or replace view public.patient_care_gaps with (security_invoker = true) as
 SELECT 'overdue_screening'::text AS gap_type,
    ss.patient_id,
    ss.organisation_id,
    st.name AS condition_or_type,
    ss.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('screen_type', st.name, 'due_date', ss.due_date, 'status', ss.status) AS detail
   FROM screening_schedules ss
     JOIN screen_types st ON st.id = ss.screen_type_id
  WHERE (ss.status = ANY (ARRAY['pending'::screening_status, 'booked'::screening_status, 'overdue'::screening_status])) AND ss.due_date < CURRENT_DATE
UNION ALL
 SELECT 'stale_monitoring'::text AS gap_type,
    cp.patient_id,
    cp.organisation_id,
    cp.condition::text AS condition_or_type,
    cp.created_at AS opened_at,
    jsonb_build_object('condition', cp.condition, 'care_plan_id', cp.id, 'last_reading_at', latest_score.computed_at) AS detail
   FROM care_plans cp
     LEFT JOIN LATERAL ( SELECT prs.computed_at
           FROM patient_risk_scores prs
          WHERE prs.patient_id = cp.patient_id
          ORDER BY prs.computed_at DESC
         LIMIT 1) latest_score ON true
  WHERE cp.status = 'active'::care_plan_status AND (latest_score.computed_at IS NULL OR latest_score.computed_at < (now() -
        CASE cp.condition
            WHEN 'hypertension'::care_plan_condition THEN '90 days'::interval
            WHEN 'diabetes'::care_plan_condition THEN '90 days'::interval
            WHEN 'cardiovascular'::care_plan_condition THEN '90 days'::interval
            WHEN 'ckd'::care_plan_condition THEN '90 days'::interval
            ELSE '180 days'::interval
        END))
UNION ALL
 SELECT 'unactioned_abnormal'::text AS gap_type,
    sr2.patient_id,
    sr2.organisation_id,
    COALESCE(sr2.result_summary, 'abnormal result'::text) AS condition_or_type,
    sr2.created_at AS opened_at,
    jsonb_build_object('result_id', sr2.id, 'result_status', sr2.result_status, 'abnormal_flags', sr2.abnormal_flags) AS detail
   FROM screening_results sr2
  WHERE (sr2.result_status = ANY (ARRAY['abnormal'::result_status, 'critical'::result_status])) AND NOT (EXISTS ( SELECT 1
           FROM care_plans cp
          WHERE cp.patient_id = sr2.patient_id AND cp.status = 'active'::care_plan_status AND cp.created_at >= sr2.created_at))
UNION ALL
 SELECT 'awaiting_result'::text AS gap_type,
    lo.patient_id,
    lo.organisation_id,
    COALESCE(pb.name, 'lab test'::text) AS condition_or_type,
    lo.ordered_at AS opened_at,
    jsonb_build_object('lab_order_id', lo.id, 'order_number', lo.order_number, 'panel', pb.name, 'ordered_at', lo.ordered_at) AS detail
   FROM lab_orders lo
     LEFT JOIN panel_bundles pb ON pb.id = lo.panel_bundle_id
  WHERE lo.fulfilment = 'self_arranged'::fulfilment_mode AND lo.status = 'ordered'::lab_order_status AND lo.ordered_at < (now() - '21 days'::interval) AND NOT (EXISTS ( SELECT 1
           FROM lab_result_documents d
          WHERE d.lab_order_id = lo.id))
UNION ALL
 SELECT 'repeated_no_show'::text AS gap_type,
    ns.patient_id,
    ns.organisation_id,
    'appointment'::text AS condition_or_type,
    ns.last_no_show_at AS opened_at,
    jsonb_build_object('no_show_count', ns.no_show_count, 'most_recent_no_show_at', ns.last_no_show_at) AS detail
   FROM ( SELECT a.patient_id,
            a.organisation_id,
            count(*) AS no_show_count,
            max(a.scheduled_for) AS last_no_show_at
           FROM appointments a
          WHERE a.status = 'no_show'::appointment_status AND a.scheduled_for >= (now() - '90 days'::interval)
          GROUP BY a.patient_id, a.organisation_id
         HAVING count(*) >= 2) ns
  WHERE NOT (EXISTS ( SELECT 1
           FROM appointments a2
          WHERE a2.patient_id = ns.patient_id AND a2.status = 'completed'::appointment_status AND a2.scheduled_for > ns.last_no_show_at))
UNION ALL
 SELECT g.gap_type,
    g.patient_id,
    g.organisation_id,
    g.condition_or_type,
    g.opened_at,
    g.detail
   FROM private.overdue_referral_gap_rows() g
  -- The rule applies to an end user's own session (current_user = authenticated, the invoker's role in a security_invoker view).
  -- Anything else reads the unfiltered rows exactly as it did before: the service role (employer / HMO aggregate), cron and the
  -- SECURITY DEFINER functions that summarise gaps (analytics, population, outreach queueing), which run as the table owner.
  WHERE g.visible OR current_user <> 'authenticated'
UNION ALL
 SELECT 'overdue_medication_review'::text AS gap_type,
    mr.patient_id,
    mr.organisation_id,
    'medication review'::text AS condition_or_type,
    mr.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('medication_review_id', mr.id, 'care_plan_id', mr.care_plan_id, 'due_date', mr.due_date) AS detail
   FROM medication_reviews mr
  WHERE mr.status = 'pending'::medication_review_status AND mr.due_date < CURRENT_DATE
UNION ALL
 SELECT 'overdue_lab_monitoring'::text AS gap_type,
    mlm.patient_id,
    mlm.organisation_id,
    mlm.monitoring_label AS condition_or_type,
    mlm.due_date::timestamp with time zone AS opened_at,
    jsonb_build_object('medication_lab_monitoring_id', mlm.id, 'medication_id', mlm.medication_id, 'drug_class', mlm.drug_class, 'monitoring_label', mlm.monitoring_label, 'due_date', mlm.due_date) AS detail
   FROM medication_lab_monitoring mlm
  WHERE mlm.status = 'pending'::lab_monitoring_status AND mlm.due_date IS NOT NULL AND mlm.due_date < CURRENT_DATE;

-- ---------------------------------------------------------------------------
-- EXECUTE
-- ---------------------------------------------------------------------------
revoke all on function public.list_referrals_audited(public.referral_status) from public;
revoke all on function public.get_referral_audited(uuid, text) from public;
revoke all on function public.list_patient_referrals_audited(uuid, text, boolean) from public;
revoke all on function public.referral_worklist_count(text) from public;
revoke all on function public.create_specialist_referral(uuid, public.specialist_type, public.referral_source, public.referral_urgency, text, text, jsonb, boolean) from public;
revoke all on function public.submit_draft_referral(uuid) from public;
revoke all on function public.set_referral_urgency(uuid, public.referral_urgency) from public;
revoke all on function public.record_referral_treatment_plan(uuid, text) from public;
revoke all on function public.record_referral_shared_care_handback(uuid) from public;
revoke all on function public.waitlist_referral(uuid, text) from public;
revoke all on function public.decline_referral(uuid, text) from public;
revoke all on function public.close_referral(uuid, text) from public;
revoke all on function public.set_referral_clinical_summary(uuid, jsonb) from public;
revoke all on function public.set_referral_outcome_document(uuid, text) from public;
revoke all on function public.set_referral_specialist_provider(uuid, uuid) from public;
grant execute on function public.list_referrals_audited(public.referral_status) to authenticated;
grant execute on function public.get_referral_audited(uuid, text) to authenticated;
grant execute on function public.list_patient_referrals_audited(uuid, text, boolean) to authenticated;
grant execute on function public.referral_worklist_count(text) to authenticated;
grant execute on function public.create_specialist_referral(uuid, public.specialist_type, public.referral_source, public.referral_urgency, text, text, jsonb, boolean) to authenticated;
grant execute on function public.submit_draft_referral(uuid) to authenticated;
grant execute on function public.set_referral_urgency(uuid, public.referral_urgency) to authenticated;
grant execute on function public.record_referral_treatment_plan(uuid, text) to authenticated;
grant execute on function public.record_referral_shared_care_handback(uuid) to authenticated;
grant execute on function public.waitlist_referral(uuid, text) to authenticated;
grant execute on function public.decline_referral(uuid, text) to authenticated;
grant execute on function public.close_referral(uuid, text) to authenticated;
grant execute on function public.set_referral_clinical_summary(uuid, jsonb) to authenticated;
grant execute on function public.set_referral_outcome_document(uuid, text) to authenticated;
grant execute on function public.set_referral_specialist_provider(uuid, uuid) to authenticated;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.list_referrals_audited(public.referral_status)', 'public.get_referral_audited(uuid,text)',
    'public.list_patient_referrals_audited(uuid,text,boolean)', 'public.referral_worklist_count(text)',
    'public.create_specialist_referral(uuid,public.specialist_type,public.referral_source,public.referral_urgency,text,text,jsonb,boolean)',
    'public.submit_draft_referral(uuid)', 'public.set_referral_urgency(uuid,public.referral_urgency)',
    'public.record_referral_treatment_plan(uuid,text)', 'public.record_referral_shared_care_handback(uuid)',
    'public.waitlist_referral(uuid,text)', 'public.decline_referral(uuid,text)', 'public.close_referral(uuid,text)',
    'public.set_referral_clinical_summary(uuid,jsonb)', 'public.set_referral_outcome_document(uuid,text)',
    'public.set_referral_specialist_provider(uuid,uuid)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') then
      raise exception 'S05e assertion: anon can execute %', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.may_work_on_referral(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.referral_json(uuid)', 'EXECUTE') then
    raise exception 'S05e assertion: an internal referral helper is executable by authenticated';
  end if;
  if not exists (select 1 from pg_views where schemaname = 'public' and viewname = 'patient_care_gaps' and definition ilike '%overdue_referral_gap_rows%') then
    raise exception 'S05e assertion: patient_care_gaps does not read overdue referrals through the rule-applying function';
  end if;
end $$;

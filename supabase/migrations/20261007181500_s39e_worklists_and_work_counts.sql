-- S39e: shared work queues keep working under the care tie (founder decision 2026-10-07). S39b ties the clinical tables, so a clinician who is not on a
-- patient's care team no longer sees that patient's items in the seven pooled queues (lab result documents, abnormal screening results, lifestyle red
-- flags, lifestyle reviews, annual check reviews, therapy approvals, vaccination verification), and an admin sees zero for the async consult count.
--   * public.clinical_worklist(): any active clinician gets, for their own organisation, the open items of those queues with ONLY the patient's name and
--     number, the kind of item and its date, and the true size of each queue (the list is capped at 100 per queue). No result, note or answer is returned.
--     The labels are generic (for example 'Therapy session awaiting approval') and do reveal the kind of care; that is the founder's decision for a worklist (OQ-286). Opening the item means opening the chart, which writes the S39c
--     access log. The worklist never hides work, and the content stays behind the tie and the log.
--   * public.org_open_work_counts(): an admin or an active clinician gets organisation totals per queue (counts, no patient rows).
-- Both are read only, security definer, never callable by anon, and refuse a care coordinator (logistics only) for the worklist.
-- private.is_org_staff is NOT edited. No data is changed. Applied with the version pinned to this filename.

create function public.clinical_worklist()
returns table (kind text, item_id uuid, patient_id uuid, patient_name text, patient_number text, item_label text, item_date timestamptz, kind_total bigint)
language plpgsql stable security definer set search_path = '' as
$$
declare v_org uuid;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = (select auth.uid()) and p.role = 'clinician' and p.is_active;
  if v_org is null or not exists (select 1 from public.clinical_staff cs where cs.profile_id = (select auth.uid()) and cs.active) then
    raise exception 'only an active clinician can read the worklist' using errcode = '42501';
  end if;
  return query
  -- kind_total is the true size of the queue, so a caller can say when the 100 row cap cut the list.
  with items as (
    select 'lab_results'::text as k, d.id as i, d.patient_id as pid, 'Lab result document to action'::text as l, d.created_at as dt
      from public.lab_result_documents d where d.organisation_id = v_org and d.acknowledgement_status <> 'action_completed'
    union all
    select 'abnormal_screening', s.id, s.patient_id, 'Abnormal screening result without follow-up', s.created_at
      from public.screening_results s where s.organisation_id = v_org and s.result_status = 'abnormal' and s.follow_up_action is null
    union all
    select 'lifestyle_flags', f.id, f.patient_id, 'Lifestyle red flag', coalesce(f.opened_at, f.created_at)
      from public.lpe_red_flag_events f where f.organisation_id = v_org and f.status = 'open'
    union all
    select 'lifestyle_reviews', r.id, r.patient_id, 'Lifestyle review due', r.due_date::timestamptz
      from public.lpe_reviews r where r.organisation_id = v_org and r.status = 'pending'
    union all
    select 'annual_check_reviews', a.id, a.patient_id, 'Annual health check review requested', a.review_requested_at
      from public.annual_health_checks a where a.organisation_id = v_org and a.review_requested_at is not null and a.reviewed_at is null
    union all
    select 'therapy_approvals', t.id, t.patient_id, 'Therapy session awaiting approval', t.requested_at
      from public.therapy_sessions t where t.organisation_id = v_org and t.status = 'awaiting_clinician_approval'
    union all
    select 'vaccination_verification', v.id, v.profile_id, 'Vaccination record to verify', v.created_at
      from public.vaccination_records v where v.organisation_id = v_org and v.verification_status = 'pending_verification'
  ), ranked as (
    select i.*, row_number() over (partition by i.k order by i.dt asc nulls last) as rn, count(*) over (partition by i.k) as tot from items i
  )
  select r.k, r.i, r.pid, pr.full_name, pr.patient_number::text, r.l, r.dt, r.tot
    from ranked r join public.profiles pr on pr.id = r.pid and pr.organisation_id = v_org
   where r.rn <= 100
   order by r.k, r.dt asc nulls last;
end $$;
revoke all on function public.clinical_worklist() from public, anon;
grant execute on function public.clinical_worklist() to authenticated;

create function public.org_open_work_counts() returns table (kind text, n bigint)
language plpgsql stable security definer set search_path = '' as
$$
declare v_org uuid;
begin
  select p.organisation_id into v_org from public.profiles p
   where p.id = (select auth.uid()) and p.is_active
     and (p.role = 'admin' or (p.role = 'clinician' and exists (select 1 from public.clinical_staff cs where cs.profile_id = p.id and cs.active)));
  if v_org is null then raise exception 'not allowed' using errcode = '42501'; end if;
  return query
    select 'lab_results'::text, count(*) from public.lab_result_documents where organisation_id = v_org and acknowledgement_status <> 'action_completed'
    union all select 'abnormal_screening', count(*) from public.screening_results where organisation_id = v_org and result_status = 'abnormal' and follow_up_action is null
    union all select 'lifestyle_flags', count(*) from public.lpe_red_flag_events where organisation_id = v_org and status = 'open'
    union all select 'lifestyle_reviews', count(*) from public.lpe_reviews where organisation_id = v_org and status = 'pending'
    union all select 'annual_check_reviews', count(*) from public.annual_health_checks where organisation_id = v_org and review_requested_at is not null and reviewed_at is null
    union all select 'therapy_approvals', count(*) from public.therapy_sessions where organisation_id = v_org and status = 'awaiting_clinician_approval'
    union all select 'vaccination_verification', count(*) from public.vaccination_records where organisation_id = v_org and verification_status = 'pending_verification'
    union all select 'async_consults', count(*) from public.async_consults where organisation_id = v_org and status in ('submitted', 'in_review');
end $$;
revoke all on function public.org_open_work_counts() from public, anon;
grant execute on function public.org_open_work_counts() to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.clinical_worklist()', 'EXECUTE') or has_function_privilege('anon', 'public.org_open_work_counts()', 'EXECUTE') then raise exception 'S39e: anon can execute'; end if;
end $$;

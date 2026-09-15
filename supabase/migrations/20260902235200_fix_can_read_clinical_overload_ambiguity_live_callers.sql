-- Adding private.can_read_clinical(uuid, caregiver_permission) as a second 2-arg
-- overload (this branch's caregiver-granular-permissions work, see
-- 20260829010500_caregiver_permission_enforcement.sql) turned every existing
-- untyped call of the form private.can_read_clinical(<uuid>, 'some_literal') --
-- previously unambiguous because only one 2-arg overload (care_access_category)
-- existed -- into "function ... is not unique" (42725) at CALL time. plpgsql
-- function bodies are not re-validated when a sibling overload is added later, so
-- this broke four already-shipped, already-live functions silently:
-- mark_care_message_thread_read, private.can_read_record_correction, care_receipt,
-- and search_patient_record. Confirmed live via a direct
-- `select private.can_read_clinical(gen_random_uuid(), 'messaging')` call, which
-- raised the ambiguity error the moment both overloads coexisted.
--
-- Fixed by adding the explicit ::public.care_access_category cast each call always
-- needed but never had to write until now. No other change to any of the four
-- bodies below -- each is otherwise byte-identical to its live definition,
-- confirmed via pg_get_functiondef against the live project (koiplnmbgnqnbywhpjlf)
-- rather than assumed from an earlier migration file, per the standing CLAUDE.md
-- rule on checking live definitions before touching a security-relevant function.
-- search_patient_record in particular already carries the imaging_reports branch
-- from 20260902220400_fix_search_patient_record_for_new_imaging_reports_shape.sql
-- (merged same day) -- copied from the live body, not reconstructed, so that
-- branch is preserved here too.
--
-- Applied directly to the live project ahead of this file's commit (fix forward,
-- not retroactively edit an applied migration) because it closes a live
-- production regression this same reconciliation introduced a few minutes
-- earlier in the same session.

create or replace function public.mark_care_message_thread_read(p_thread_id uuid)
returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid;
  v_patient uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;

  select organisation_id, patient_id into v_org, v_patient
  from public.care_message_threads where id = p_thread_id;
  if v_org is null then raise exception 'thread not found'; end if;

  if private.is_org_staff(v_org) then
    update public.care_message_threads set care_team_last_read_at = now() where id = p_thread_id;
  elsif v_uid = v_patient or private.can_read_clinical(v_patient, 'messaging'::public.care_access_category) then
    update public.care_message_threads set patient_last_read_at = now() where id = p_thread_id;
  else
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$function$;

create or replace function private.can_read_record_correction(p_table_name text, p_organisation_id uuid, p_patient_id uuid, p_corrected_by uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select
    private.is_admin()
    or (p_corrected_by is not null and p_corrected_by = (select auth.uid()))
    or (p_patient_id is not null and (
      p_patient_id = (select auth.uid())
      or private.can_read_clinical(p_patient_id, 'medical_history'::public.care_access_category)
    ))
    or (p_table_name in ('profiles', 'lab_result_documents')
        and p_patient_id is not null
        and private.is_lab_liaison()
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_table_name = 'clinical_staff'
        and p_organisation_id is not null
        and p_organisation_id = private.current_org_id())
    or (p_organisation_id is not null and private.is_org_staff(p_organisation_id));
$function$;

create or replace function public.care_receipt(p_beneficiary uuid, p_from timestamp with time zone DEFAULT NULL::timestamp with time zone, p_to timestamp with time zone DEFAULT NULL::timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller   uuid := (select auth.uid());
  v_is_self  boolean;
  v_grant    public.profile_access;
  v_clinical boolean;
  v_from     timestamptz;
  v_to       timestamptz;
  v_name     text;
  v_events   jsonb;
  v_readings jsonb;
  v_counts   jsonb;
  v_money    jsonb;
  v_status   jsonb;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  v_is_self := v_caller = p_beneficiary;

  if not v_is_self then
    select * into v_grant
      from public.profile_access
     where profile_id = p_beneficiary and grantee_user_id = v_caller;

    if not found then
      raise exception 'you do not have access to this person''s care'
        using errcode = '42501';
    end if;
  end if;

  v_clinical := v_is_self or private.can_read_clinical(p_beneficiary, 'medical_history'::public.care_access_category);

  v_to   := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '30 days');

  if v_from >= v_to then
    raise exception 'the receipt period must start before it ends' using errcode = '22023';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'This person')
    into v_name from public.profiles where id = p_beneficiary;

  select coalesce(jsonb_agg(e order by e->>'occurred_at' desc), '[]'::jsonb) into v_events
  from (
    select jsonb_strip_nulls(jsonb_build_object(
      'occurred_at', pt.occurred_at,
      'category',    lbl.category,
      'what',        case when v_clinical then pt.title else lbl.activity_label end,
      'detail',      case when v_clinical then pt.summary else null end,
      'reviewed_by', cs.full_name,
      'reviewed_by_credential', case when cs.full_name is not null then cs.credential_type else null end
    )) as e
    from public.patient_timeline pt
    join public.care_receipt_event_labels lbl on lbl.event_type = pt.event_type
    left join public.clinical_staff cs on cs.id = pt.actor_clinical_staff_id
    where pt.patient_id = p_beneficiary
      and pt.occurred_at >= v_from
      and pt.occurred_at < v_to
      and (v_clinical or lbl.activity_label is not null)
  ) rows;

  select coalesce(jsonb_agg(jsonb_build_object('day', g.day, 'count', g.n)
                            order by g.day desc), '[]'::jsonb) into v_readings
  from (
    select (date_trunc('day', vr.taken_at at time zone 'Africa/Lagos'))::date as day,
           count(*) as n
      from public.vitals_readings vr
     where vr.patient_id = p_beneficiary
       and vr.taken_at >= v_from
       and vr.taken_at < v_to
     group by 1
  ) g;

  select jsonb_build_object(
    'readings_recorded', (
      select count(*) from public.vitals_readings vr
       where vr.patient_id = p_beneficiary and vr.taken_at >= v_from and vr.taken_at < v_to),
    'doctor_reviews', (
      select count(*) from public.patient_timeline pt
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and pt.actor_clinical_staff_id is not null),
    'tests_completed', (
      select count(*) from public.patient_timeline pt
       join public.care_receipt_event_labels l on l.event_type = pt.event_type
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and l.category = 'tests' and pt.event_type <> 'screening_due'),
    'medication_events', (
      select count(*) from public.patient_timeline pt
       join public.care_receipt_event_labels l on l.event_type = pt.event_type
       where pt.patient_id = p_beneficiary and pt.occurred_at >= v_from and pt.occurred_at < v_to
         and l.category = 'medication' and (v_clinical or l.activity_label is not null))
  ) into v_counts;

  select jsonb_build_object(
    'funded_kobo', coalesce(sum(cv.amount_paid_kobo), 0),
    'vouchers_bought', count(*),
    'vouchers_used', count(*) filter (where cv.redeemed_at is not null),
    'vouchers_waiting', count(*) filter (where cv.status = 'active' and cv.redeemed_at is null),
    'items', coalesce(jsonb_agg(jsonb_build_object(
        'voucher_number', cv.voucher_number,
        'what', cv.sku_name,
        'amount_kobo', cv.amount_paid_kobo,
        'bought_at', cv.created_at,
        'used_at', cv.redeemed_at
      ) order by cv.created_at desc) filter (where cv.id is not null), '[]'::jsonb)
  ) into v_money
  from public.care_vouchers cv
  where cv.beneficiary_profile_id = p_beneficiary
    and cv.created_at >= v_from and cv.created_at < v_to
    and (v_is_self or cv.purchaser_profile_id = v_caller);

  if v_clinical then
    select jsonb_build_object(
      'open_cases', count(*) filter (where ca.status = 'open'),
      'next_review_due', min(ca.sla_due_at) filter (where ca.status = 'open'),
      'last_reviewed_at', max(ca.acknowledged_at)
    ) into v_status
    from public.clinician_alerts ca
    where ca.patient_id = p_beneficiary;
  end if;

  perform private.log_care_access(
    p_beneficiary, 'receipt_generated', 'care_receipt',
    jsonb_build_object('from', v_from, 'to', v_to, 'tier', case when v_clinical then 'clinical' else 'activity' end)
  );

  return jsonb_build_object(
    'beneficiary_name', v_name,
    'beneficiary_id',   p_beneficiary,
    'period_from',      v_from,
    'period_to',        v_to,
    'tier',             case when v_clinical then 'clinical' else 'activity' end,
    'is_self',          v_is_self,
    'generated_at',     now(),
    'summary',          v_counts,
    'events',           v_events,
    'reading_days',     v_readings,
    'money',            v_money,
    'care_status',      v_status
  );
end;
$function$;

create or replace function public.search_patient_record(p_patient uuid, p_query text)
returns table(table_name text, record_id uuid, title text, snippet text, occurred_at timestamp with time zone, rank real)
language plpgsql
stable
security definer
set search_path to ''
as $function$
declare
  v_org uuid;
  v_ts  tsquery;
begin
  select p.organisation_id into v_org from public.profiles p where p.id = p_patient;
  if v_org is null then
    raise exception 'unknown patient';
  end if;

  if not (
    p_patient = (select auth.uid())
    or private.is_org_staff(v_org)
    or private.can_read_clinical(p_patient, 'medical_history'::public.care_access_category)
  ) then
    raise exception 'insufficient_privilege: not authorised to search this patient''s record';
  end if;

  if p_query is null or length(btrim(p_query)) = 0 then
    return;
  end if;

  v_ts := websearch_to_tsquery('english', p_query);

  return query
  select
    'patient_conditions'::text as table_name, c.id as record_id, c.condition_name as title,
    coalesce(nullif(c.current_treatment, ''), c.supporting_evidence) as snippet,
    coalesce(c.last_reviewed_at, c.date_identified::timestamptz, c.created_at) as occurred_at,
    ts_rank(c.search_vector, v_ts) as rank
    from public.patient_conditions c
    where c.patient_id = p_patient and c.search_vector @@ v_ts
  union all
  select
    'patient_allergies'::text as table_name, a.id as record_id, a.allergen as title, a.reaction as snippet,
    a.noted_at as occurred_at, ts_rank(a.search_vector, v_ts) as rank
    from public.patient_allergies a
    where a.patient_id = p_patient and a.search_vector @@ v_ts
  union all
  select
    'medications'::text as table_name, m.id as record_id, m.drug_name as title, m.dose as snippet,
    m.created_at as occurred_at, ts_rank(m.search_vector, v_ts) as rank
    from public.medications m
    where m.patient_id = p_patient and m.search_vector @@ v_ts
  union all
  select
    'screening_results'::text as table_name, s.id as record_id, 'Screening result'::text as title,
    s.result_summary as snippet, s.created_at as occurred_at, ts_rank(s.search_vector, v_ts) as rank
    from public.screening_results s
    where s.patient_id = p_patient and s.search_vector @@ v_ts
  union all
  select
    'patient_documents'::text as table_name, d.id as record_id, replace(d.document_type::text, '_', ' ') as title,
    coalesce(d.original_filename, d.note) as snippet, d.created_at as occurred_at,
    ts_rank(d.search_vector, v_ts) as rank
    from public.patient_documents d
    where d.patient_id = p_patient and d.search_vector @@ v_ts
  union all
  select
    'imaging_reports'::text as table_name, r.id as record_id, replace(r.modality::text, '_', ' ') as title,
    coalesce(r.impression, r.findings) as snippet, r.created_at as occurred_at,
    ts_rank(r.search_vector, v_ts) as rank
    from public.imaging_reports r
    where r.patient_id = p_patient and r.search_vector @@ v_ts
  order by rank desc
  limit 50;
end;
$function$;

do $$
begin
  perform private.can_read_clinical(gen_random_uuid(), 'messaging'::public.care_access_category);

  if pg_get_functiondef('public.mark_care_message_thread_read(uuid)'::regprocedure)
       !~ 'messaging''::public\.care_access_category'
  then
    raise exception 'mark_care_message_thread_read was not fixed with an explicit cast';
  end if;

  if pg_get_functiondef('private.can_read_record_correction(text,uuid,uuid,uuid)'::regprocedure)
       !~ 'medical_history''::public\.care_access_category'
  then
    raise exception 'can_read_record_correction was not fixed with an explicit cast';
  end if;

  if pg_get_functiondef('public.care_receipt(uuid,timestamptz,timestamptz)'::regprocedure)
       !~ 'medical_history''::public\.care_access_category'
  then
    raise exception 'care_receipt was not fixed with an explicit cast';
  end if;

  if pg_get_functiondef('public.search_patient_record(uuid,text)'::regprocedure)
       !~ 'medical_history''::public\.care_access_category'
  then
    raise exception 'search_patient_record was not fixed with an explicit cast';
  end if;
end $$;

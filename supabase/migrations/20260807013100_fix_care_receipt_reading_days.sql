-- Corrects the reading_days block of public.care_receipt.
--
-- The version created by 20260807012000 built its per-day jsonb object and then
-- said `group by 1` — grouping by an expression that itself contains count(*),
-- which Postgres rejects with 42803 ("aggregate functions are not allowed in
-- GROUP BY"). A plpgsql body is not parsed at creation time, so the original
-- migration applied cleanly and the function only failed the first time anyone
-- called it. Exactly the same failure, and the same fix-forward handling, as
-- 20260731023625_fix_sponsor_report_vitals_column.
--
-- Found by packages/db/tests/care_graph_and_receipt.sql rather than in
-- production, which is the argument for that test file existing at all.
--
-- The aggregation now happens in a subquery and the jsonb object is built over
-- its result. Nothing else about the function changes: same disclosure tiers,
-- same guards, same output shape. The assertion block from 20260807012000 is
-- repeated at the bottom so the disclosure boundary is re-proved against the
-- replacement body rather than assumed to have survived the edit.

create or replace function public.care_receipt(
  p_beneficiary uuid,
  p_from        timestamptz default null,
  p_to          timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_caller   uuid := (select auth.uid());
  v_is_self  boolean;
  v_grant    public.profile_access;
  v_clinical boolean;
  v_tier     text;
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

  -- The tier is read from the patient's live consent, never passed in. Reusing
  -- private.can_read_clinical rather than reading profile_access.clinical_access
  -- directly keeps the guardian-of-a-dependent-account case (a child who cannot
  -- consent for themselves) in step with every other consented surface.
  v_clinical := v_is_self or private.can_read_clinical(p_beneficiary);
  v_tier := case when v_clinical then 'clinical' else 'activity' end;

  -- Default window: the last calendar month of care, which is the rhythm a
  -- sponsor actually pays on.
  v_to   := coalesce(p_to, now());
  v_from := coalesce(p_from, v_to - interval '30 days');

  if v_from >= v_to then
    raise exception 'the receipt period must start before it ends' using errcode = '22023';
  end if;

  select coalesce(nullif(trim(full_name), ''), 'This person')
    into v_name from public.profiles where id = p_beneficiary;

  -- (a) The care itself.
  --
  -- The join to care_receipt_event_labels is an INNER join on purpose: an event
  -- type with no row there cannot appear on any receipt at any tier. The
  -- activity tier additionally requires a non-null activity_label, and takes
  -- its wording from that column — never from pt.title or pt.summary, which is
  -- what keeps clinical free text structurally out of the untrusted tier.
  --
  -- Doctor attribution is null-gated exactly as CLINICAL_TRUST_MODEL_SPEC §2
  -- requires: reviewed_by is present only where patient_timeline actually
  -- recorded an acting clinician, and is otherwise absent. No default, no
  -- "your care team" standing in for a name that was never recorded.
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

  -- (b) Readings. patient_timeline has no event for a logged vital, and "her
  -- blood pressure was taken on Tuesday" is the single most reassuring line on
  -- the whole receipt, so it is sourced directly. Dates and the fact of a
  -- reading only — never systolic, diastolic, glucose or weight, at either
  -- tier. A supporter who wants the numbers reads them on the health summary,
  -- which is separately consent-gated; the receipt is proof of care, not a
  -- chart.
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

  -- (c) The headline. Four numbers a person can hold in their head.
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

  -- (d) What the reader themselves paid, and what became of it. Scoped to the
  -- caller's own purchases: this is their receipt, not a statement of every
  -- relative's spending. The patient reading their own receipt sees the whole
  -- picture instead, since every voucher on their record is theirs to know about.
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

  -- (e) Is anyone actually looking after this? Counts and dates only — the same
  -- shape and the same restraint as sponsor_care_status, which this deliberately
  -- mirrors rather than replaces. Consented tier only: an open case count is a
  -- statement about this person's health.
  if v_clinical then
    select jsonb_build_object(
      'open_cases', count(*) filter (where ca.status = 'open'),
      'next_review_due', min(ca.sla_due_at) filter (where ca.status = 'open'),
      'last_reviewed_at', max(ca.acknowledged_at)
    ) into v_status
    from public.clinician_alerts ca
    where ca.patient_id = p_beneficiary;
  end if;

  -- The patient sees who asked for a receipt about them, and when. A supporter
  -- reading their relative's record is an act, and acts on this platform are
  -- logged. No-op when the caller is the patient.
  perform private.log_care_access(
    p_beneficiary, 'receipt_generated', 'care_receipt',
    jsonb_build_object('from', v_from, 'to', v_to, 'tier', v_tier)
  );

  return jsonb_build_object(
    'beneficiary_name', v_name,
    'beneficiary_id',   p_beneficiary,
    'period_from',      v_from,
    'period_to',        v_to,
    'tier',             v_tier,
    'is_self',          v_is_self,
    'generated_at',     now(),
    'summary',          v_counts,
    'events',           v_events,
    'reading_days',     v_readings,
    'money',            v_money,
    'care_status',      v_status
  );
end;
$$;

revoke all on function public.care_receipt(uuid, timestamptz, timestamptz) from public;
revoke execute on function public.care_receipt(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.care_receipt(uuid, timestamptz, timestamptz) to authenticated;

do $$
declare
  v_src text := regexp_replace(
    pg_get_functiondef('public.care_receipt(uuid,timestamptz,timestamptz)'::regprocedure),
    '--[^\n]*', '', 'g');
begin
  if has_function_privilege('anon', 'public.care_receipt(uuid,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'anon must not reach the care receipt';
  end if;
  if not has_function_privilege('authenticated', 'public.care_receipt(uuid,timestamptz,timestamptz)', 'EXECUTE') then
    raise exception 'authenticated must reach the care receipt';
  end if;
  if v_src like '%pt.title%'
     and v_src not like '%case when v_clinical then pt.title else lbl.activity_label end%' then
    raise exception 'care_receipt reads pt.title outside the consented branch';
  end if;
  if v_src like '%pt.summary%'
     and v_src not like '%case when v_clinical then pt.summary else null end%' then
    raise exception 'care_receipt reads pt.summary outside the consented branch';
  end if;
  if v_src ~* '\m(systolic|diastolic|glucose_mmol_l|weight_kg|spo2_pct|temperature_c)\M' then
    raise exception 'care_receipt must not select vital values';
  end if;
  if v_src ~* '\mca\.(title|detail)\M' then
    raise exception 'care_receipt must not select alert title or detail';
  end if;
  if v_src not like '%join public.care_receipt_event_labels%' then
    raise exception 'care_receipt must resolve labels through care_receipt_event_labels';
  end if;
  if v_src not like '%(v_clinical or lbl.activity_label is not null)%' then
    raise exception 'care_receipt has lost the activity-tier withholding guard';
  end if;
end $$;

-- Tarragon Health — the care graph, part 3: the receipt.
--
-- NOTE: the reading_days block in this version groups by an expression that
-- contains an aggregate and therefore raises 42803 the first time the function
-- is called. A plpgsql body is not parsed at creation time, so it was created
-- cleanly and only failed under packages/db/tests/care_graph_and_receipt.sql.
-- Corrected in 20260807013100_fix_care_receipt_reading_days.sql. Kept as
-- applied history, same convention as 20260731023625.
--
-- Sending money to Nigeria is a solved and fiercely competitive business.
-- Nothing a remittance service does can tell you the money reached CARE rather
-- than the general run of a household. That gap is the entire diaspora
-- product, and it is not a dashboard — a dashboard is something you have to
-- remember to go and check, and it puts the work of being reassured back on
-- the person who is already 5,000km away and already worried.
--
-- A receipt is the opposite. It is finished, it is dated, it is addressed to
-- you, and it says what happened:
--
--   Blood pressure recorded            Tuesday 4 August
--   Reviewed by Dr Adaeze Okonkwo      Wednesday 5 August
--   Amlodipine dispensed               Thursday 6 August
--
-- THE DISCLOSURE LINE, and why it is drawn exactly here.
--
-- This function serves two different readers off one query, and the difference
-- between them is the patient's own consent switch, nothing else:
--
--   'activity'  A supporter with a grant but no clinical consent. They get the
--               CATEGORY of each care action, its date, and the real name of
--               the doctor where a doctor acted. They never get a value, a
--               result, a drug name, a diagnosis, or any free text. This is
--               the same line sponsor_payable_orders and sponsor_spend_receipts
--               already hold ("A lab test", "Medication"), extended from money
--               to care.
--
--   'clinical'  A supporter the patient has explicitly consented to
--               (profile_access.clinical_access, or a guardian of a dependent
--               account). They additionally get the timeline's own title and
--               summary, and the heavier event classes — abnormal results,
--               escalations, admissions, missed doses.
--
-- patient_timeline.summary carries free clinical text written by clinicians
-- ("checked, no real BP concern, closing"). The activity tier therefore builds
-- its labels from a fixed server-side map keyed on event_type and NEVER selects
-- title or summary. That is asserted at the bottom of this file, because a
-- convention that only the UI honours is not a boundary.
--
-- WHY THE HEAVIER CLASSES ARE SPLIT OUT AT THE ACTIVITY TIER
--
-- 'A lab test was completed' says care happened. 'An abnormal result was found'
-- says something about this person's health, and an unconsented next of kin was
-- nominated so somebody could be phoned in an emergency, not so they could
-- learn that. Same reasoning that made 20260731181143 hold results and
-- escalations back from the first consented read set; the founder later brought
-- them in behind consent (20260731185243), which is exactly where they are here.
--
-- Row counts before this migration: profile_access 0, care_vouchers 0,
-- patient_timeline 18 (all verification fixtures). Nothing to convert.

-- --- the fixed, non-clinical vocabulary ----------------------------------------
-- A table, not a CASE inside the function, so that adding a timeline event type
-- without deciding what a supporter may be told about it is a visible omission
-- (the event simply does not appear) rather than an accidental disclosure.
create table public.care_receipt_event_labels (
  event_type        public.timeline_event_type primary key,
  -- What a supporter with no clinical consent is told. NULL means: this event
  -- class is not disclosable at the activity tier at all.
  activity_label    text,
  -- Grouping for the summary counts at the top of the receipt.
  category          text not null,
  check (activity_label is null or length(trim(activity_label)) > 0)
);

comment on table public.care_receipt_event_labels is
  'Fixed, non-clinical phrasing for each timeline event on the care receipt. A NULL activity_label means the event is withheld from a supporter who has no clinical consent. Reference data, readable by anyone signed in; only an admin may change it.';

insert into public.care_receipt_event_labels (event_type, activity_label, category) values
  -- Proof that care happened. No condition, no value, no result.
  ('lab_completed',           'A lab test was completed',                'tests'),
  ('screening_completed',     'A screening was completed',               'tests'),
  ('vaccination_recorded',    'A vaccination was given',                 'tests'),
  ('medication_started',      'A doctor started a new medication',       'medication'),
  ('medication_stopped',      'A doctor stopped a medication',           'medication'),
  ('medication_dispensed',    'Medication was dispensed',                'medication'),
  ('care_plan_updated',       'The care plan was reviewed and updated',  'review'),
  ('referral_created',        'A specialist referral was arranged',      'referral'),
  ('referral_status_changed', 'A specialist referral moved forward',     'referral'),
  ('message_posted',          'A message was exchanged with the care team', 'contact'),
  ('screening_due',           'A screening was scheduled',               'tests'),
  -- Withheld from the activity tier: each says something about this person's
  -- health, not merely that they were cared for.
  ('lab_abnormal',            null, 'review'),
  ('escalation_raised',       null, 'review'),
  ('escalation_resolved',     null, 'review'),
  ('medication_missed',       null, 'medication'),
  ('admission_recorded',      null, 'hospital'),
  ('discharge_recorded',      null, 'hospital');

alter table public.care_receipt_event_labels enable row level security;

create policy care_receipt_event_labels_select on public.care_receipt_event_labels
  for select to authenticated using (true);

create policy care_receipt_event_labels_write on public.care_receipt_event_labels
  for all to authenticated using (private.is_admin()) with check (private.is_admin());

-- RLS governs rows, not reachability. A table created by a later migration does
-- not inherit the project-creation grant.
grant select on public.care_receipt_event_labels to authenticated;
grant insert, update, delete on public.care_receipt_event_labels to authenticated;

-- Every event type must have a decision recorded against it. If someone adds a
-- value to timeline_event_type and does not decide what a supporter may be told,
-- this fails here rather than silently defaulting either way.
do $$
declare
  v_missing text;
begin
  select string_agg(t::text, ', ') into v_missing
    from unnest(enum_range(null::public.timeline_event_type)) t
   where t not in (select event_type from public.care_receipt_event_labels);
  if v_missing is not null then
    raise exception 'no receipt disclosure decision recorded for: %', v_missing;
  end if;
end $$;

-- --- the receipt ----------------------------------------------------------------
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
  select coalesce(jsonb_agg(r order by r->>'day' desc), '[]'::jsonb) into v_readings
  from (
    select jsonb_build_object(
             'day', (date_trunc('day', vr.taken_at at time zone 'Africa/Lagos'))::date,
             'count', count(*)
           ) as r
      from public.vitals_readings vr
     where vr.patient_id = p_beneficiary
       and vr.taken_at >= v_from
       and vr.taken_at < v_to
     group by 1
  ) rows;

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

revoke all on function public.care_receipt(uuid, timestamptz, timestamptz) from public, anon;
revoke execute on function public.care_receipt(uuid, timestamptz, timestamptz) from anon;
grant execute on function public.care_receipt(uuid, timestamptz, timestamptz) to authenticated;

-- --- the migration is the test ----------------------------------------------------
do $$
declare
  -- Comments are stripped before any of the checks below run. pg_get_functiondef
  -- returns the body verbatim, comments included, and this function's comments
  -- necessarily name the very columns the checks forbid ("never systolic,
  -- diastolic ..."). Matching against the prose instead of the code made the
  -- first version of this block fail on a correct function — worth keeping the
  -- normalisation visible so the next person does not reintroduce it.
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
  if not has_table_privilege('authenticated', 'public.care_receipt_event_labels', 'SELECT') then
    raise exception 'authenticated cannot read the receipt label table';
  end if;

  -- The activity tier must be structurally incapable of emitting clinical free
  -- text. Both pt.title and pt.summary may appear in the body only inside a
  -- v_clinical branch; these two checks pin the exact guarded forms, so a later
  -- edit that reads either unguarded fails here.
  if v_src like '%pt.title%'
     and v_src not like '%case when v_clinical then pt.title else lbl.activity_label end%' then
    raise exception 'care_receipt reads pt.title outside the consented branch';
  end if;
  if v_src like '%pt.summary%'
     and v_src not like '%case when v_clinical then pt.summary else null end%' then
    raise exception 'care_receipt reads pt.summary outside the consented branch';
  end if;

  -- Vital VALUES must never appear on a receipt at any tier. The receipt says a
  -- reading was taken; the numbers live behind the separately consented health
  -- summary.
  if v_src ~* '\m(systolic|diastolic|glucose_mmol_l|weight_kg|spo2_pct|temperature_c)\M' then
    raise exception 'care_receipt must not select vital values';
  end if;

  -- Alert reasoning must never appear either, matching sponsor_care_status.
  if v_src ~* '\mca\.(title|detail)\M' then
    raise exception 'care_receipt must not select alert title or detail';
  end if;

  -- The label table gates the activity tier. If the inner join or the
  -- activity_label guard is removed, every withheld event class leaks.
  if v_src not like '%join public.care_receipt_event_labels%' then
    raise exception 'care_receipt must resolve labels through care_receipt_event_labels';
  end if;
  if v_src not like '%(v_clinical or lbl.activity_label is not null)%' then
    raise exception 'care_receipt has lost the activity-tier withholding guard';
  end if;

  -- Withheld classes must actually be withheld, in the data not just the code.
  if exists (
    select 1 from public.care_receipt_event_labels
     where event_type in ('lab_abnormal', 'escalation_raised', 'escalation_resolved',
                          'admission_recorded', 'discharge_recorded', 'medication_missed')
       and activity_label is not null
  ) then
    raise exception 'a heavier event class has been given an activity-tier label';
  end if;
end $$;

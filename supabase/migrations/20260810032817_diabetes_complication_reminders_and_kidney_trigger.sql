-- ===========================================================================
-- Diabetes Clinical Pathway — G11/G12: retinal + nephropathy reminder cron,
-- and a kidney-protection trigger on rising ACR / falling eGFR
-- ---------------------------------------------------------------------------
-- diabetes_complication_checks (20260720150000) already tracks WHEN a retinal
-- or renal check is next due; nothing ever turned that due date into an
-- actual patient nudge, the same gap screening_due_reminders
-- (20260807015101) closed for screening_schedules. This closes it here, same
-- shape, same "reminder only, never the record of truth" rule.
--
-- G12 also asks to "reuse the abnormal-result lab red-flag rails" for a
-- kidney-protection trigger on rising ACR / falling eGFR. lab_analyte_readings
-- has no per-row abnormal trigger of its own (unlike screening_results) and
-- eGFR is never stored directly — it's always derived from creatinine + age +
-- sex (apps/web/src/lib/rules/egfr.ts). A DB trigger can't call that TS
-- function, so this ports the same CKD-EPI 2021 constants into SQL as a
-- narrow backstop — the same "duplicate just the critical threshold at the DB
-- layer" pattern already used for glucose
-- (private.handle_glucose_emergency_backstop, 20260807090308): keep the two
-- in sync if the equation ever changes.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- G11/G12 part 1: patient reminder when a retinal or renal check is overdue
-- (or has never been done — baseline owed since diagnosis).
-- ---------------------------------------------------------------------------
create or replace function private.queue_diabetes_complication_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  with dm as (
    select distinct patient_id, organisation_id
    from public.care_plans
    where condition = 'diabetes' and status = 'active'
  ),
  latest as (
    select dm.patient_id, dm.organisation_id, ct.check_type,
           max(c.next_due_at) as due
    from dm
    cross join (
      values ('retinal'::public.complication_check_type), ('renal'::public.complication_check_type)
    ) as ct (check_type)
    left join public.diabetes_complication_checks c
      on c.patient_id = dm.patient_id and c.check_type = ct.check_type
    group by dm.patient_id, dm.organisation_id, ct.check_type
  ),
  due as (
    select * from latest where due is null or due <= current_date
  ),
  not_recently_reminded as (
    select due.*
    from due
    where not exists (
      select 1 from public.notifications n
      where n.recipient_id = due.patient_id
        and n.template = 'diabetes_complication_check_due'
        and (n.payload ->> 'check_type') = due.check_type::text
        and n.created_at >= now() - interval '30 days'
    )
  )
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    organisation_id, patient_id, 'whatsapp', 'pending', 'diabetes_complication_check_due',
    jsonb_build_object('check_type', check_type, 'due_date', coalesce(due, current_date))
  from not_recently_reminded;
$$;

do $$ begin
  perform cron.unschedule('diabetes-complication-reminders-daily');
exception when others then null;
end $$;

select cron.schedule(
  'diabetes-complication-reminders-daily',
  '40 6 * * *',
  $$select private.queue_diabetes_complication_reminders();$$
);

-- ---------------------------------------------------------------------------
-- G12 part 2: kidney-protection trigger. CKD-EPI 2021 (race-free), constants
-- must match apps/web/src/lib/rules/egfr.ts::estimateEgfr exactly.
-- ---------------------------------------------------------------------------
create or replace function private.estimate_egfr_ckdepi(
  p_creatinine_mgdl numeric,
  p_age_years numeric,
  p_sex public.sex
)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case
    when p_creatinine_mgdl is null or p_creatinine_mgdl <= 0 then null
    when p_age_years is null or p_age_years < 18 or p_age_years > 120 then null
    when p_creatinine_mgdl < 0.1 or p_creatinine_mgdl > 25 then null
    else round(
      142
      * power(
          least(p_creatinine_mgdl / (case when p_sex = 'female' then 0.7 else 0.9 end), 1),
          (case when p_sex = 'female' then -0.241 else -0.302 end)
        )
      * power(
          greatest(p_creatinine_mgdl / (case when p_sex = 'female' then 0.7 else 0.9 end), 1),
          -1.2
        )
      * power(0.9938::numeric, p_age_years)
      * (case when p_sex = 'female' then 1.012 else 1 end)
    )
  end;
$$;

create or replace function private.handle_diabetes_kidney_labs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_is_diabetic boolean;
  v_dob date;
  v_sex public.sex;
  v_age numeric;
  v_egfr numeric;
  v_prev record;
  v_prev_egfr numeric;
  v_title text;
  v_detail text;
  v_level public.alert_level;
begin
  if new.code not in ('creatinine', 'urine_acr') then
    return new;
  end if;

  select exists (
    select 1 from public.care_plans
    where patient_id = new.patient_id and condition = 'diabetes' and status = 'active'
  ) into v_is_diabetic;
  if not v_is_diabetic then
    return new;
  end if;

  if new.code = 'creatinine' then
    select date_of_birth, sex into v_dob, v_sex from public.profiles where id = new.patient_id;
    if v_dob is null or v_sex is null then
      return new;
    end if;

    v_age := extract(year from age(new.taken_at::timestamp, v_dob::timestamp));
    v_egfr := private.estimate_egfr_ckdepi(new.value, v_age, v_sex);
    if v_egfr is null then
      return new;
    end if;

    if v_egfr < 30 then
      v_title := 'Diabetes kidney-protection: eGFR < 30';
      v_detail := format(
        'Latest creatinine %s mg/dL -> estimated eGFR %s (CKD-EPI 2021). Below 30: review nephrotoxic '
        || 'drugs including metformin dosing, optimise BP control, and consider a nephrology referral.',
        round(new.value, 2), v_egfr
      );
      v_level := 'urgent_escalation';
    else
      -- Rapidly falling eGFR: compare against the most recent PRIOR
      -- creatinine reading (within 15 months) for the same patient, using
      -- the same age (a small approximation for readings taken close
      -- together, and the equation is not sensitive to a year either way).
      select l.value, l.taken_at into v_prev
      from public.lab_analyte_readings l
      where l.patient_id = new.patient_id
        and l.code = 'creatinine'
        and l.id <> new.id
        and l.taken_at < new.taken_at
        and l.taken_at >= new.taken_at - interval '15 months'
      order by l.taken_at desc
      limit 1;

      if v_prev.value is not null then
        v_prev_egfr := private.estimate_egfr_ckdepi(v_prev.value, v_age, v_sex);
        if v_prev_egfr is not null and v_prev_egfr > 0
           and (v_prev_egfr - v_egfr) / v_prev_egfr >= 0.25 then
          v_title := 'Diabetes kidney-protection: rapidly falling eGFR';
          v_detail := format(
            'eGFR fallen from an estimated %s to %s (CKD-EPI 2021) since %s -- a %s%% relative drop. '
            || 'Review BP control and nephrotoxic drugs (including NSAIDs and metformin dosing), and '
            || 'consider a nephrology referral even though eGFR is still >= 30.',
            v_prev_egfr, v_egfr, v_prev.taken_at::date,
            round(((v_prev_egfr - v_egfr) / v_prev_egfr) * 100)
          );
          v_level := 'clinician_review';
        end if;
      end if;
    end if;

  elsif new.code = 'urine_acr' then
    if new.value >= 300 then
      v_title := 'Diabetes kidney-protection: severely increased albuminuria';
      v_detail := format(
        'Urine ACR %s mg/g (severely increased, KDIGO A3). Optimise BP control, start or review an ACE '
        || 'inhibitor or ARB unless contraindicated, review nephrotoxics, and consider a nephrology referral.',
        round(new.value, 1)
      );
      v_level := 'urgent_escalation';
    elsif new.value >= 30 then
      v_title := 'Diabetes kidney-protection: rising albuminuria';
      v_detail := format(
        'Urine ACR %s mg/g (moderately increased, KDIGO A2). Optimise BP control and start or review an '
        || 'ACE inhibitor or ARB unless contraindicated.',
        round(new.value, 1)
      );
      v_level := 'clinician_review';
    end if;
  end if;

  if v_title is null then
    return new;
  end if;

  if exists (
    select 1 from public.clinician_alerts
    where patient_id = new.patient_id and title = v_title and status = 'open'
  ) then
    return new;
  end if;

  insert into public.clinician_alerts
    (organisation_id, patient_id, level, status, title, detail, sla_due_at, escalation_level)
  values (
    new.organisation_id, new.patient_id, v_level, 'open', v_title, v_detail,
    now() + (case when v_level = 'urgent_escalation' then interval '24 hours' else interval '7 days' end),
    case when v_level = 'urgent_escalation' then 3 else 2 end
  );

  return new;
end;
$$;

drop trigger if exists diabetes_kidney_labs_trigger on public.lab_analyte_readings;
create trigger diabetes_kidney_labs_trigger
  after insert on public.lab_analyte_readings
  for each row execute function private.handle_diabetes_kidney_labs();

do $$
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'queue_diabetes_complication_reminders'
  ) then
    raise exception 'queue_diabetes_complication_reminders was not created';
  end if;
  if not exists (select 1 from cron.job where jobname = 'diabetes-complication-reminders-daily') then
    raise exception 'diabetes-complication-reminders-daily cron job was not registered';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'private' and p.proname = 'estimate_egfr_ckdepi'
  ) then
    raise exception 'estimate_egfr_ckdepi was not created';
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'diabetes_kidney_labs_trigger'
  ) then
    raise exception 'diabetes_kidney_labs_trigger was not created';
  end if;
  -- Sanity-check the ported formula against a known reference point: a
  -- 50-year-old male with creatinine 1.0 mg/dL should read close to normal
  -- (CKD-EPI 2021 gives ~91). A wide tolerance since this is a smoke test,
  -- not a numerical-accuracy test (that lives in egfr.test.ts for the TS
  -- original).
  if not (private.estimate_egfr_ckdepi(1.0, 50, 'male') between 80 and 100) then
    raise exception 'estimate_egfr_ckdepi sanity check failed: got %',
      private.estimate_egfr_ckdepi(1.0, 50, 'male');
  end if;
end $$;

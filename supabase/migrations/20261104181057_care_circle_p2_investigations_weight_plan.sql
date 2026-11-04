-- Care Circle Phase 2 (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, items 2.3, 2.3b, 2.4, 2.5).
--
-- Four new things a patient can choose to share, each one a separate tick per supporter (nothing changes for any existing supporter: a new
-- permission starts unticked for everyone, and live has 0 Care Circle members):
--   investigation_status  where each test in their plan has got to (due, requested, waiting for the result, waiting for a doctor, reviewed,
--                         follow-up needed, done). Names and stages only, never a value.
--   investigation_values  (founder decision D2, 2026-11-04) the values of results a doctor has reviewed and released to the patient, with
--                         the lab's reference range. Never a held, unreviewed, computer-read-only or sensitive result.
--   weekly_weight_trend   weekly average weight, like the blood pressure trend.
--   care_plan_progress    how many of the checks in their yearly plan are done, due and overdue, and the next one due.
--
-- What family may ever see about a test is an ALLOW-LIST, not a deny-list (private.circle_screen_shareable): everyday tests only. A sensitive
-- test (screen_types.sensitive: HIV, hepatitis, syphilis, cervical, breast, prostate, bowel), a reproductive one that is not flagged
-- sensitive (antenatal booking, PCOS), tuberculosis, and ANY test added later are hidden until someone adds them to the list on purpose.
-- Values are filtered per analyte on top: private.lab_analyte_is_sensitive, private.is_sensitive_analyte_code, and a pregnancy-hormone rule
-- (OQ D5 recommendation: pregnancy tests are treated as sensitive here whether or not D5 is settled that way elsewhere).
--
-- Every function redefined here was copied from its LIVE body (2026-11-04) after Phase 1 (20261104172930, 20261104180415); changed lines
-- are marked "P2".

-- ---------------------------------------------------------------------------
-- 1. The permission list
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.circle_permissions_valid(p text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(cardinality(p) between 1 and 11                                                                       -- P2
         and p <@ array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care', 'attend_consultation', 'doctor_note',
                        'investigation_status', 'investigation_values', 'weekly_weight_trend', 'care_plan_progress']::text[]   -- P2
         and cardinality(p) = (select count(distinct x) from unnest(p) x), false)
$function$;

-- members who may see anything at all may see the circle's shared jobs (unchanged rule, new view permissions added)
CREATE OR REPLACE FUNCTION private.circle_perms_see_tasks(p_permissions text[])
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select coalesce(p_permissions && array['adherence_summary', 'weekly_bp_trend', 'appointments', 'pay_for_care',
                                                      'investigation_status', 'investigation_values', 'weekly_weight_trend', 'care_plan_progress']::text[], false) $function$;

-- weight is a reading, so it follows the same S42 consent as blood pressure
CREATE OR REPLACE FUNCTION private.circle_consented_permissions(p_patient uuid, p_permissions text[])
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select case when private.consent_in_force(p_patient, 'vitals', 'care_circle_sharing') then p_permissions
              else array_remove(array_remove(array_remove(p_permissions, 'adherence_summary'), 'weekly_bp_trend'), 'weekly_weight_trend') end   -- P2
$function$;

-- ---------------------------------------------------------------------------
-- 2. What family may ever see about a test
-- ---------------------------------------------------------------------------
create function private.circle_screen_shareable(p_code text, p_sensitive boolean)
returns boolean
language sql immutable set search_path = ''
as $$
  select not coalesce(p_sensitive, true)
     and lower(coalesce(p_code, '')) = any (array[
       'blood_pressure', 'ecg_resting', 'lipid_panel', 'hba1c', 'ogtt_fpg', 'kft', 'urine_acr', 'urinalysis', 'fbc', 'lft', 'tft',
       'blood_group', 'sickle_cell_genotype', 'ferritin', 'vitamin_b12', 'bone_density', 'vision_check', 'hearing_check', 'dental_check'])
$$;
comment on function private.circle_screen_shareable(text, boolean) is
  'Care Circle P2: the everyday tests a supporter may ever be told about. An allow-list on purpose: a sensitive test, a reproductive one '
  '(antenatal booking, PCOS), tuberculosis, and any test added later stay hidden until someone adds it here. An operational privacy '
  'setting (G-01), not a clinical sign-off item.';

create function private.circle_analyte_shareable(p_code text)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_code is not null
     and not private.lab_analyte_is_sensitive(p_code)
     and not private.is_sensitive_analyte_code(p_code)
     -- pregnancy hormone, and anything named for pregnancy, never reaches family (D5 recommendation)
     and lower(p_code) !~ '(hcg|pregnan|upt)'
$$;
comment on function private.circle_analyte_shareable(text) is
  'Care Circle P2: false for any analyte whose value must never reach a family supporter (the panel''s own sensitive flag, the S27 '
  'sensitive-code rule, and pregnancy hormone).';

-- ---------------------------------------------------------------------------
-- 3. The new blocks
-- ---------------------------------------------------------------------------
create function private.circle_care_blocks(p_patient uuid, p_permissions text[])
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  out jsonb := '{}'::jsonb;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_rows jsonb; v_first numeric; v_last numeric; v_done integer; v_due integer; v_overdue integer; v_next date;
begin
  p_permissions := private.circle_consented_permissions(p_patient, p_permissions);

  if 'investigation_status' = any (p_permissions) then
    -- one row per test in the patient's plan that family may know about; the stage is worked out from the order, the uploaded report and
    -- the result's review state. A report read by the computer but not yet checked is "result_received", never "reviewed".
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', x.code, 'stage', x.stage, 'due_date', x.due_date, 'follow_up', x.follow_up) order by x.sort_key, x.code), '[]'::jsonb)
      into v_rows
      from (
        select st.code, ss.due_date,
               coalesce(d.action_required, false) as follow_up,
               case
                 when ss.status = 'completed' and (r.id is null or r.release_state = 'released') then 'done'
                 when r.release_state = 'released' and r.reviewed_at is not null then 'reviewed'
                 when r.id is not null then 'awaiting_review'
                 when d.id is not null and d.reviewed_at is not null then 'reviewed'
                 when d.id is not null then 'result_received'
                 when o.status in ('sample_collected', 'processing', 'resulted') then 'awaiting_result'
                 when o.id is not null then 'requested'
                 when ss.status = 'overdue' then 'overdue'
                 else 'due' end as stage,
               case when ss.status = 'completed' then 2 when ss.status = 'overdue' then 0 else 1 end as sort_key
          from public.screening_schedules ss
          join public.screen_types st on st.id = ss.screen_type_id
          left join lateral (select lo.id, lo.status from public.lab_orders lo
                              where lo.screening_schedule_id = ss.id and lo.status not in ('cancelled', 'sample_rejected')
                              order by lo.created_at desc limit 1) o on true
          left join lateral (select lr.id, lr.release_state, lr.reviewed_at from public.lab_results lr
                              where o.id is not null and lr.lab_order_id = o.id and lr.withdrawn_at is null and lr.superseded_by is null
                                and lr.release_state <> 'withheld'
                              order by lr.received_at desc limit 1) r on true
          left join lateral (select dd.id, dd.reviewed_at, dd.acknowledgement_status = 'action_required' as action_required
                               from public.lab_result_documents dd
                              where o.id is not null and dd.lab_order_id = o.id and dd.superseded_by_document_id is null
                              order by dd.created_at desc limit 1) d on true
         where ss.patient_id = p_patient
           and private.circle_screen_shareable(st.code, st.sensitive)
           and (ss.status in ('pending', 'booked', 'overdue')
                or (ss.status = 'completed' and ss.updated_at > now() - interval '12 months'))
        ) x;
    out := out || jsonb_build_object('investigations', v_rows);
  end if;

  if 'investigation_values' = any (p_permissions) then
    -- D2: only results a doctor reviewed AND released to the patient, latest value per analyte in the last 12 months, never a sensitive
    -- analyte, never a withdrawn or replaced result. The lab's own range is passed so the screen can say "within / outside the lab's usual
    -- range" in plain words; no Tarragon flag or interpretation is sent.
    select coalesce(jsonb_agg(jsonb_build_object(
             'code', v.analyte_code, 'at', v.released_at, 'value', v.value_numeric, 'value_text', v.value_text, 'unit', v.unit,
             'ref_low', v.ref_low, 'ref_high', v.ref_high,
             'in_range', case when v.value_numeric is null or v.ref_low is null or v.ref_high is null then null
                              else v.value_numeric between v.ref_low and v.ref_high end) order by v.analyte_code), '[]'::jsonb)
      into v_rows
      from (
        select distinct on (i.analyte_code) i.analyte_code, r.released_at, i.value_numeric, i.value_text, i.unit, i.ref_low, i.ref_high
          from public.lab_results r
          join public.lab_result_items i on i.lab_result_id = r.id
         where r.patient_id = p_patient and r.release_state = 'released' and r.reviewed_at is not null and r.released_at is not null
           and r.withdrawn_at is null and r.superseded_by is null
           and r.released_at > now() - interval '12 months'
           and private.circle_analyte_shareable(i.analyte_code)
           and not coalesce(i.sensitive_positive, false)
         order by i.analyte_code, r.released_at desc
      ) v;
    out := out || jsonb_build_object('results', v_rows);
  end if;

  if 'weekly_weight_trend' = any (p_permissions) then
    -- weekly averages only, like blood pressure; weight is measured less often, so one reading makes a week
    select coalesce(jsonb_agg(jsonb_build_object('week_start', k.wk, 'kg', w.kg, 'readings', coalesce(w.n, 0)) order by k.wk), '[]'::jsonb)
      into v_rows
      from (select (date_trunc('week', v_today::timestamp)::date - 7 * i) as wk from generate_series(0, v_weeks - 1) i) k
      left join (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(weight_kg), 1) kg, count(*)::integer n
                   from private.vitals_readings_current
                  where patient_id = p_patient and vital_type = 'weight' and weight_kg is not null
                    and coalesce(validation_status::text, '') <> 'rejected'
                    and taken_at >= (date_trunc('week', v_today::timestamp)::date - 7 * (v_weeks - 1))::timestamp at time zone 'Africa/Lagos'
                  group by 1) w on w.wk = k.wk;
    select (e ->> 'kg')::numeric into v_first from jsonb_array_elements(v_rows) e where e ->> 'kg' is not null order by e ->> 'week_start' limit 1;
    select (e ->> 'kg')::numeric into v_last from jsonb_array_elements(v_rows) e where e ->> 'kg' is not null order by e ->> 'week_start' desc limit 1;
    out := out || jsonb_build_object('weight_trend', jsonb_build_object('weeks', v_rows,
             'direction', case when v_first is null or v_last is null or (select count(*) from jsonb_array_elements(v_rows) e where e ->> 'kg' is not null) < 2 then null
                               when v_last - v_first >= 1 then 'higher' when v_last - v_first <= -1 then 'lower' else 'steady' end));
  end if;

  if 'care_plan_progress' = any (p_permissions) then
    select count(*) filter (where ss.status = 'completed' and ss.updated_at > now() - interval '12 months'),
           count(*) filter (where ss.status in ('pending', 'booked')),
           count(*) filter (where ss.status = 'overdue'),
           -- the next one coming up (an overdue one is already counted as overdue; a past date is not "next")
           min(ss.due_date) filter (where ss.status in ('pending', 'booked') and ss.due_date >= v_today)
      into v_done, v_due, v_overdue, v_next
      from public.screening_schedules ss join public.screen_types st on st.id = ss.screen_type_id
     where ss.patient_id = p_patient and private.circle_screen_shareable(st.code, st.sensitive);
    out := out || jsonb_build_object('plan_progress', jsonb_build_object('done', v_done, 'due', v_due, 'overdue', v_overdue, 'next_due', v_next));
  end if;
  return out;
end $$;
comment on function private.circle_care_blocks(uuid, text[]) is
  'Care Circle P2: the investigation, test value, weight and yearly-plan blocks of the supporter view. Called only through '
  'private.circle_view_blocks, so every caller (supporter view, patient preview) passes the gate first.';

CREATE OR REPLACE FUNCTION private.circle_view_blocks(p_patient uuid, p_permissions text[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- P1: consent is applied once, here, for every block (the core block also checks it; the monthly block did not)
  select private.circle_view_blocks_core(p_patient, private.circle_consented_permissions(p_patient, p_permissions))
      || private.circle_monthly_block(p_patient, private.circle_consented_permissions(p_patient, p_permissions))
      || private.circle_doctor_note_block(p_patient, p_permissions)
      || private.circle_care_blocks(p_patient, p_permissions)                                                   -- P2
$function$;

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not private.circle_permissions_valid(array['investigation_status', 'investigation_values', 'weekly_weight_trend', 'care_plan_progress']) then
    raise exception 'P2 self-check: the new permissions are not accepted';
  end if;
  if private.circle_screen_shareable('hiv', false) or private.circle_screen_shareable('antenatal_booking', false)
     or private.circle_screen_shareable('hba1c', true) or not private.circle_screen_shareable('hba1c', false) then
    raise exception 'P2 self-check: the test allow-list is wrong';
  end if;
  if private.circle_analyte_shareable('hiv_screen') or private.circle_analyte_shareable('beta_hcg') or not private.circle_analyte_shareable('hba1c') then
    raise exception 'P2 self-check: the analyte filter is wrong';
  end if;
end $$;

-- Care Circle leftovers (2026-11-04): close the known limit recorded on private.circle_appointment_shareable in Phase 1,
-- "a specialist appointment with a blank reason is still shown".
--
-- Family in a Care Circle only ever see the TIME of an appointment (next appointment, missed in 30 days, attended/missed on the
-- timeline), never its type or reason. The filter decided from the reason and service text alone, so a specialist or procedure
-- appointment with nothing written down passed unchecked, and so did one whose words were harmless but whose referral was to a
-- sensitive specialty. The fix fails closed:
--   * a specialist or procedure appointment needs something checkable: a reason or service, or a linked referral;
--   * a linked referral hides the appointment when its specialty is ob_gyn, genitourinary_medicine, urologist, psychiatry or
--     psychology, when it belongs to an STI episode, or when its reason or requested service names a confidential domain;
--   * therapy, laboratory and imaging stay hidden, and the confidential-domain text check is unchanged.
-- The new 4-argument function replaces the 3-argument one; the three live callers are redefined here from their LIVE bodies
-- (pg_get_functiondef, 2026-11-04) with only the call changed, then the old signature is dropped so nothing can call it again.
-- Live count at writing: 0 specialist or procedure appointments (structural change only).

create function private.circle_appointment_shareable(p_type public.appointment_type, p_reason text, p_service text, p_referral uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select p_type is distinct from 'therapy'::public.appointment_type
     and p_type is distinct from 'laboratory'::public.appointment_type
     and p_type is distinct from 'imaging'::public.appointment_type
     and private.confidential_domain_of_text(coalesce(p_reason, '') || ' ' || coalesce(p_service, '')) is null
     -- a specialist or procedure appointment with nothing to check is not shown
     and (p_type not in ('specialist'::public.appointment_type, 'procedure'::public.appointment_type)
          or p_referral is not null
          or btrim(coalesce(p_reason, '') || coalesce(p_service, '')) <> '')
     -- a linked referral to a sensitive specialty, an STI episode, or with sensitive words, is not shown
     and not exists (
       select 1 from public.specialist_referrals r
        where r.id = p_referral
          and (r.specialist_type in ('ob_gyn', 'genitourinary_medicine', 'urologist', 'psychiatry', 'psychology')
               or r.sti_case_episode_id is not null
               or private.confidential_domain_of_text(coalesce(r.referral_reason, '') || ' ' || coalesce(r.requested_service, '')) is not null))
$$;
revoke all on function private.circle_appointment_shareable(public.appointment_type, text, text, uuid) from public, anon, authenticated;
comment on function private.circle_appointment_shareable(public.appointment_type, text, text, uuid) is
  'Care Circle: false for an appointment a family supporter must not learn about, not even its time: therapy, laboratory, imaging; '
  'a reason/service in a confidential domain; a specialist or procedure appointment with no reason, service or referral to check; '
  'a referral to ob_gyn, genitourinary_medicine, urologist, psychiatry or psychology, an STI episode, or with sensitive words.';

CREATE OR REPLACE FUNCTION private.circle_view_blocks_core(p_patient uuid, p_permissions text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_min integer := coalesce((private.report_rule('min_readings') #>> '{}')::integer, 3);   -- W-11
  out jsonb := '{}'::jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric; v_na integer; v_nb integer;
  v_next timestamptz; v_missed integer;
begin
  -- S42: without the vitals x Care Circle consent, the vitals-derived blocks are not built.
  p_permissions := private.circle_consented_permissions(p_patient, p_permissions);   -- P1: the one helper
  if 'adherence_summary' = any (p_permissions) then
    select count(*) filter (where status in ('taken', 'delayed')), count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped'))
      into v_taken, v_due
      from public.medication_logs
     where patient_id = p_patient and scheduled_for_date between v_today - 6 and v_today;
    out := out || jsonb_build_object('adherence', jsonb_build_object('days', 7, 'taken', v_taken, 'due', v_due,
              'percent', case when v_due > 0 then round(100.0 * v_taken / v_due)::integer end));
  end if;

  if 'weekly_bp_trend' = any (p_permissions) then
    -- weekly averages only: no single reading, no time of day, no symptom, no note.
    -- W-11: every calendar week in the window is listed (a gap has readings 0); below min_readings the averages are null (the count stays).
    select coalesce(jsonb_agg(jsonb_build_object('week_start', k.wk,
                                                 'systolic', case when coalesce(w.n, 0) >= v_min then w.sys end,
                                                 'diastolic', case when coalesce(w.n, 0) >= v_min then w.dia end,
                                                 'readings', coalesce(w.n, 0)) order by k.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', v_today::timestamp)::date - 7 * i) as wk from generate_series(0, v_weeks - 1) i) k
      left join (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                        round(avg(diastolic))::integer dia, count(*)::integer n
                   from private.vitals_readings_current
                  where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
                    and coalesce(validation_status::text, '') <> 'rejected'
                    and taken_at >= (date_trunc('week', v_today::timestamp)::date - 7 * (v_weeks - 1))::timestamp at time zone 'Africa/Lagos'
                  group by 1) w on w.wk = k.wk;
    -- W-11: direction only when BOTH the current and the previous calendar week have enough readings
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric,
           (v_bp -> -1 ->> 'readings')::integer, (v_bp -> -2 ->> 'readings')::integer into v_a, v_b, v_na, v_nb;
    v_dir := case when v_a is null or v_b is null or coalesce(v_na, 0) < v_min or coalesce(v_nb, 0) < v_min then null
                  when v_a - v_b >= 5 then 'higher' when v_a - v_b <= -5 then 'lower' else 'steady' end;
    out := out || jsonb_build_object('bp_trend', jsonb_build_object('weeks', v_bp, 'direction', v_dir));
  end if;

  if 'appointments' = any (p_permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()),
           count(*) filter (where status = 'no_show' and scheduled_for > now() - interval '30 days')
      into v_next, v_missed
      from public.appointments
     where patient_id = p_patient
       and private.circle_appointment_shareable(appointment_type, reason, service, specialist_referral_id);   -- P1 + leftovers: no sensitive appointment, not even its time
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next, 'missed_30d', v_missed));
  end if;

  if 'pay_for_care' = any (p_permissions) then
    out := out || jsonb_build_object('can_pay', true);
  end if;
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.circle_weekly_digest(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  m public.care_circle_members%rowtype;
  v_perms text[];
  v_days integer := (private.circle_tools_rules() ->> 'digest_days')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_from date;
  v_name text;
  out jsonb;
  v_all integer; v_with integer; v_read integer; v_next timestamptz;
  v_open integer; v_claimed integer; v_done integer;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_digest') then raise exception 'circle_tools_unavailable' using errcode = 'P0001'; end if;
  -- the one gate: an active, unexpired member, and a paused circle shows nothing (same "not found" as everything else)
  m := private.circle_member_for(p_patient);
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  v_perms := private.circle_consented_permissions(p_patient, m.permissions);   -- P1: the patient's sharing consent applies here too
  v_from := v_today - (v_days - 1);
  select coalesce(nullif(split_part(btrim(full_name), ' ', 1), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'from', v_from, 'to', v_today, 'days', v_days);

  if 'adherence_summary' = any (v_perms) then
    select count(*) filter (where due > 0 and taken = due), count(*) filter (where due > 0) into v_all, v_with
      from (select scheduled_for_date,
                   count(*) filter (where status in ('taken', 'delayed')) taken,
                   count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped')) due
              from public.medication_logs
             where patient_id = p_patient and scheduled_for_date between v_from and v_today
             group by scheduled_for_date) d;
    out := out || jsonb_build_object('doses', jsonb_build_object('days_all_taken', v_all, 'days_with_doses', v_with));
  end if;

  if 'weekly_bp_trend' = any (v_perms) then
    -- days on which a reading was logged: a count, never a value, a time or a note
    select count(distinct (taken_at at time zone 'Africa/Lagos')::date) into v_read
      from private.vitals_readings_current
     where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
       and coalesce(validation_status::text, '') <> 'rejected'
       and taken_at >= v_from::timestamp at time zone 'Africa/Lagos';
    out := out || jsonb_build_object('readings', jsonb_build_object('days_logged', v_read));
  end if;

  if 'appointments' = any (v_perms) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()) into v_next
      from public.appointments
     where patient_id = p_patient
       and private.circle_appointment_shareable(appointment_type, reason, service, specialist_referral_id);   -- P1 + leftovers
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next));
  end if;

  -- job counts are visible to members who may see jobs at all (a view permission or pay_for_care), not to a red_alerts-only member
  if private.circle_perms_see_tasks(m.permissions) then
    select count(*) filter (where state = 'open'), count(*) filter (where state = 'claimed'),
           count(*) filter (where state = 'done' and done_at > now() - make_interval(days => v_days))
      into v_open, v_claimed, v_done from public.care_circle_tasks
     where patient_id = p_patient and (recipients is null or v_uid = any (recipients));   -- P3: never count a request addressed to others
    out := out || jsonb_build_object('tasks', jsonb_build_object('open', v_open, 'claimed', v_claimed, 'done', v_done));
  end if;

  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('digest')), v_uid);
  return out;
end $function$;

CREATE OR REPLACE FUNCTION public.circle_supporter_timeline(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.care_circle_members%rowtype;
  v_perms text[];
  v_since timestamptz := now() - interval '90 days';
  out jsonb := '[]'::jsonb;
begin
  m := private.circle_member_for(p_patient);   -- the gate: active, unexpired, adult, supporter active, not paused
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  v_perms := private.circle_consented_permissions(p_patient, m.permissions);

  select coalesce(jsonb_agg(x.e order by (x.e ->> 'at') desc), '[]'::jsonb) into out from (
    -- a doctor's note the patient released
    select jsonb_build_object('at', n.released_at, 'kind', 'doctor_note_shared', 'source', 'clinician') e
      from public.family_doctor_notes n
     where 'doctor_note' = any (v_perms) and n.patient_id = p_patient and n.released_at > v_since
    union all
    -- an appointment attended or missed (never a sensitive one)
    select jsonb_build_object('at', a.scheduled_for, 'kind', case when a.status = 'no_show' then 'appointment_missed' else 'appointment_attended' end, 'source', 'system')
      from public.appointments a
     where 'appointments' = any (v_perms) and a.patient_id = p_patient and a.scheduled_for > v_since and a.scheduled_for <= now()
       and a.status in ('completed', 'no_show') and private.circle_appointment_shareable(a.appointment_type, a.reason, a.service, a.specialist_referral_id)
    union all
    -- an everyday test requested
    select jsonb_build_object('at', o.created_at, 'kind', 'test_requested', 'code', st.code, 'source', 'system')
      from public.lab_orders o join public.screening_schedules ss on ss.id = o.screening_schedule_id join public.screen_types st on st.id = ss.screen_type_id
     where 'investigation_status' = any (v_perms) and o.patient_id = p_patient and o.created_at > v_since and o.status <> 'cancelled'
       and private.circle_screen_shareable(st.code, st.sensitive)
    union all
    -- an everyday test a doctor reviewed and released
    select jsonb_build_object('at', r.released_at, 'kind', 'test_reviewed', 'code', st.code, 'source', 'clinician')
      from public.lab_results r join public.lab_orders o on o.id = r.lab_order_id
      join public.screening_schedules ss on ss.id = o.screening_schedule_id join public.screen_types st on st.id = ss.screen_type_id
     where 'investigation_status' = any (v_perms) and r.patient_id = p_patient and r.release_state = 'released' and r.reviewed_at is not null
       and r.released_at > v_since and r.withdrawn_at is null and private.circle_screen_shareable(st.code, st.sensitive)
    union all
    -- a help request this reader may see: asked for, and done
    select jsonb_build_object('at', t.created_at, 'kind', 'help_requested', 'code', t.kind, 'source', 'patient')
      from public.care_circle_tasks t
     where t.patient_id = p_patient and t.created_at > v_since and private.module_enabled('care_circle_tasks') and private.circle_task_access(t) is not null
    union all
    select jsonb_build_object('at', t.done_at, 'kind', 'help_done', 'code', t.kind, 'source', 'patient')
      from public.care_circle_tasks t
     where t.patient_id = p_patient and t.state = 'done' and t.done_at > v_since and private.module_enabled('care_circle_tasks')
       and private.circle_task_access(t) is not null
  ) x;
  if jsonb_array_length(out) > 50 then
    out := (select jsonb_agg(v order by o) from jsonb_array_elements(out) with ordinality s(v, o) where o <= 50);
  end if;
  if jsonb_array_length(out) > 0 then
    perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('timeline')), m.supporter_id);
  end if;
  return out;
end $function$;

drop function private.circle_appointment_shareable(public.appointment_type, text, text);

do $$
declare n int;
begin
  select count(*) into n from pg_proc p where p.proname = 'circle_appointment_shareable';
  if n <> 1 then raise exception 'expected exactly one circle_appointment_shareable, found %', n; end if;
  select count(*) into n from pg_proc p
   where p.prosrc ilike '%circle_appointment_shareable(%' and p.proname <> 'circle_appointment_shareable'
     and p.prosrc not ilike '%specialist_referral_id)%';
  if n <> 0 then raise exception '% caller(s) still use the 3-argument filter', n; end if;
  if has_function_privilege('authenticated', 'private.circle_appointment_shareable(public.appointment_type, text, text, uuid)', 'EXECUTE')
    then raise exception 'authenticated can execute the filter directly'; end if;
  if private.circle_appointment_shareable('specialist', null, null, null) then raise exception 'blank specialist still shared'; end if;
  if private.circle_appointment_shareable('procedure', '  ', '', null) then raise exception 'blank procedure still shared'; end if;
  if not private.circle_appointment_shareable('specialist', 'Eye check', null, null) then raise exception 'plain specialist hidden'; end if;
  if not private.circle_appointment_shareable('gp', null, null, null) then raise exception 'blank GP visit hidden'; end if;
end $$;

-- Care Circle Phase 1, part 1: close the privacy gaps found by the 2026-11-04 audit
-- (docs/plans/care-circle-expansion-audit-and-plan-2026-11-04.md, section 5).
--
-- Live rows when this was written: 0 care_circle_members, 0 invites, 0 family notes, 0 pauses. Every change below is structural; no
-- existing supporter gains or loses anything, and no data conversion step is needed.
--
-- Every function redefined here was copied from its LIVE body (pg_get_functiondef on koiplnmbgnqnbywhpjlf, 2026-11-04 17:20 UTC), and the
-- local replay was confirmed byte-identical before editing. Only the lines marked "P1" change.
--
--   1. Consent everywhere (5.1). The S42 consent "vitals x care_circle_sharing" was applied only in circle_view_blocks_core. The monthly
--      block, the weekly digest (read and send) and the missed-dose nudge (sweep and list) ignored it, so a patient who withdrew it still
--      had their averages, dose counts and nudges reach supporters. One helper, private.circle_consented_permissions, now strips the
--      vitals-derived permissions for every reader.
--   2. Sensitive appointments (5.8). The appointments block showed the next appointment of ANY kind. A therapy appointment, or one whose
--      reason or service names a reproductive or mental-health matter, is now left out of the time, the missed count and the digest.
--   3. Help alert while paused (5.2, founder decision D-help 2026-11-04): the alert keeps sending while the circle's alerts are paused (a
--      tap on "help" is deliberate; the patient is warned on screen first), and now the supporter can actually OPEN the alert it was told
--      about. Before, the view refused them while paused, so they got a push they could not read.
--   4. Supporter list readers go through the same checks as the gate (5.5): supporter account active, patient an adult.
--   5. A removed supporter can no longer read their own revoked row (5.3). The supporter sees their row only while it is active; the
--      patient sees all of theirs.
--   6. care_circle_permission_history (5.4): every change to who can see what, with the true actor, written by triggers so that no path
--      (invite, edit, renew, remove, leave, expiry sweep, bereavement, account closure, handover, minor sweep, pause, note release) can
--      skip it. care_access_events stays the "who looked" log; its one-hour de-duplication is fine for views and no longer has to carry
--      the history of permission changes.

-- ---------------------------------------------------------------------------
-- 1. Consent helper and the readers that lacked it
-- ---------------------------------------------------------------------------
create function private.circle_consented_permissions(p_patient uuid, p_permissions text[])
returns text[]
language sql stable security definer set search_path = ''
as $$
  select case when private.consent_in_force(p_patient, 'vitals', 'care_circle_sharing') then p_permissions
              else array_remove(array_remove(p_permissions, 'adherence_summary'), 'weekly_bp_trend') end
$$;
comment on function private.circle_consented_permissions(uuid, text[]) is
  'Care Circle P1: the permissions a supporter may be shown right now, after the patient''s S42 consent (vitals x care_circle_sharing). '
  'Every block that derives anything from readings or doses must take its permissions through this.';

-- 2. which appointments a supporter may know about
create function private.circle_appointment_shareable(p_type public.appointment_type, p_reason text, p_service text)
returns boolean
language sql immutable set search_path = ''
as $$
  -- therapy is mental health; laboratory and imaging appointments can be for a sensitive test (HIV, cervical, mammography, prostate), and
  -- test progress reaches family only through the per-test sensitivity filter of investigation tracking (Phase 2), never as a bare time
  select p_type is distinct from 'therapy'::public.appointment_type
     and p_type is distinct from 'laboratory'::public.appointment_type
     and p_type is distinct from 'imaging'::public.appointment_type
     and private.confidential_domain_of_text(coalesce(p_reason, '') || ' ' || coalesce(p_service, '')) is null
$$;
comment on function private.circle_appointment_shareable(public.appointment_type, text, text) is
  'Care Circle P1: false for an appointment a family supporter must not learn about (therapy, laboratory, imaging, or a reason/service in a '
  'confidential domain). Known limit: a specialist appointment with a blank reason is still shown.';

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
$function$;

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
       and private.circle_appointment_shareable(appointment_type, reason, service);   -- P1: no sensitive appointment, not even its time
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
       and private.circle_appointment_shareable(appointment_type, reason, service);   -- P1
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next));
  end if;

  -- job counts are visible to members who may see jobs at all (a view permission or pay_for_care), not to a red_alerts-only member
  if private.circle_perms_see_tasks(m.permissions) then
    select count(*) filter (where state = 'open'), count(*) filter (where state = 'claimed'),
           count(*) filter (where state = 'done' and done_at > now() - make_interval(days => v_days))
      into v_open, v_claimed, v_done from public.care_circle_tasks where patient_id = p_patient;
    out := out || jsonb_build_object('tasks', jsonb_build_object('open', v_open, 'claimed', v_claimed, 'done', v_done));
  end if;

  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('digest')), v_uid);
  return out;
end $function$;

CREATE OR REPLACE FUNCTION private.send_circle_digests()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r record; n integer := 0; v_week text := to_char((now() at time zone 'Africa/Lagos')::date, 'IYYY-IW');
begin
  if not private.module_enabled('care_circle_digest') then return 0; end if;
  for r in select m.id, m.supporter_id, m.organisation_id, m.is_test, m.alert_mode
             from public.care_circle_members m join public.profiles sp on sp.id = m.supporter_id and sp.is_active and sp.is_test = m.is_test
            where m.state = 'active' and m.expires_at > now() and not private.circle_paused(m.patient_id)
              and not private.circle_patient_is_minor(m.patient_id)                                                      -- P1
              and private.circle_consented_permissions(m.patient_id, m.permissions)                                   -- P1: no notice
                  && array['adherence_summary', 'weekly_bp_trend', 'appointments']::text[] loop                       -- for an empty digest
    begin
      perform private.circle_notify(r.supporter_id, r.organisation_id, 'circle_digest', 'care_circle_members',          -- P1: a real table
                                    md5(r.id::text || ':' || v_week)::uuid,
                                    case when r.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'routine', r.is_test);
      n := n + 1;
    exception when others then
      begin
        perform private.page_incident(r.organisation_id, 'circle_digest_failed:' || r.id, 'A Care Circle weekly update could not be sent',
          'The weekly update for one Care Circle member (' || r.id || ') failed: ' || sqlerrm);
      exception when others then
        raise warning 'circle digest notice and its incident both failed for %: %', r.id, sqlerrm;
      end;
    end;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION private.sweep_circle_missed_doses(p_now timestamp without time zone DEFAULT NULL::timestamp without time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cfg jsonb := private.circle_tools_rules();
  v_now timestamp := coalesce(p_now, now() at time zone 'Africa/Lagos');
  v_today date := v_now::date;
  v_grace integer := (cfg ->> 'missed_dose_grace_minutes')::integer;
  v_win integer := (cfg ->> 'missed_dose_window_minutes')::integer;
  v_cap integer := (cfg ->> 'missed_dose_max_per_day')::integer;
  v_hold integer := 0;
  r record; n integer := 0; v_sent integer; v_notify boolean;
begin
  if not private.module_enabled('care_circle_missed_dose_alert') then return 0; end if;
  -- the patient-first window, when the CMO has switched it on, also holds this nudge back: the circle is not told before the window ends
  if private.module_enabled('care_circle_checkin_window') then v_hold := (private.circle_rules() ->> 'checkin_window_minutes')::integer; end if;
  -- nothing here reads a triage event, a page or an emergency event: a red event reaches supporters at once through
  -- private.notify_circle_red_alert, which this migration does not touch.
  -- The slots come from private.medication_slots_on (the 4-argument form S08z moved the reminders to, so a dose anchored to a meal time
  -- resolves for this patient), so start and end dates, every-n-days, weekdays, tapers and anchored doses are respected, and a malformed schedule has no slots instead of aborting the sweep. A slot that
  -- falls before the schedule took effect (a medicine just added or just edited) is never nudged. The time text is checked before it is
  -- cast, inside a CASE, so a bad string can never abort the sweep outside the per-row handler below.
  for r in
    select s.member_id, s.patient_id, s.supporter_id, s.organisation_id, s.is_test, s.alert_mode, s.medication_id, s.slot_time as schedule_time
      from (
        select m.id as member_id, m.patient_id, m.supporter_id, m.organisation_id, m.is_test, m.alert_mode, med.id as medication_id, sl.slot_time,
               case when sl.slot_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then v_today + sl.slot_time::time end as slot_at,
               (greatest(med.created_at, coalesce(med.schedule_effective_from, med.created_at)) at time zone 'Africa/Lagos') as active_from
          from public.care_circle_members m
          join public.profiles sp on sp.id = m.supporter_id and sp.is_active and sp.is_test = m.is_test
          join public.profiles pp on pp.id = m.patient_id and pp.is_active
          join public.medications med on med.patient_id = m.patient_id and med.is_active
          cross join lateral private.medication_slots_on(med.schedule_spec, med.schedule_times, v_today, med.patient_id) sl
         where m.state = 'active' and m.expires_at > now() and m.missed_dose_alert and 'adherence_summary' = any (m.permissions)
           and not private.circle_paused(m.patient_id)
           and not private.circle_patient_is_minor(m.patient_id)                                    -- P1
           and private.consent_in_force(m.patient_id, 'vitals', 'care_circle_sharing')              -- P1: withdrawn consent stops the nudge
      ) s
     where s.slot_at is not null
       and s.slot_at >= s.active_from
       and s.slot_at + make_interval(mins => v_grace + v_hold) <= v_now
       and s.slot_at + make_interval(mins => v_grace + v_hold + v_win) > v_now
       -- any answer at all (taken, late, skipped, missed, not available) means the patient has dealt with the slot
       and not exists (select 1 from public.medication_logs l where l.medication_id = s.medication_id and l.scheduled_for_date = v_today and l.scheduled_time = s.slot_time)
       and not exists (select 1 from public.care_circle_missed_dose_alerts a
                        where a.member_id = s.member_id and a.medication_id = s.medication_id and a.scheduled_for_date = v_today and a.scheduled_time = s.slot_time)
  loop
    begin
      select count(distinct a.scheduled_time) into v_sent from public.care_circle_missed_dose_alerts a
       where a.member_id = r.member_id and a.scheduled_for_date = v_today and a.notified;
      -- one notice per supporter per time slot (two medicines at 08:00 are one nudge), and a daily cap so it never becomes noise
      v_notify := v_sent < v_cap and not exists (select 1 from public.care_circle_missed_dose_alerts a
                   where a.member_id = r.member_id and a.scheduled_for_date = v_today and a.scheduled_time = r.schedule_time and a.notified);
      if v_notify then
        perform private.circle_notify(r.supporter_id, r.organisation_id, 'circle_gentle_nudge', 'care_circle_missed_dose_alerts',
                                      md5(r.member_id::text || ':' || v_today::text || ':' || r.schedule_time)::uuid,
                                      case when r.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'routine', r.is_test);
      end if;
      insert into public.care_circle_missed_dose_alerts (organisation_id, patient_id, member_id, medication_id, scheduled_for_date, scheduled_time, notified)
      values (r.organisation_id, r.patient_id, r.member_id, r.medication_id, v_today, r.schedule_time, v_notify)
      on conflict do nothing;
      if v_notify then n := n + 1; end if;
    exception when others then
      -- one failing row must not stop the others; nothing was recorded, so the next run inside the window tries again
      begin
        perform private.page_incident(r.organisation_id, 'circle_nudge_failed:' || r.member_id, 'A Care Circle nudge could not be sent',
          'A gentle nudge for one Care Circle member (' || r.member_id || ') failed: ' || sqlerrm);
      exception when others then
        raise warning 'circle nudge and its incident both failed for %: %', r.member_id, sqlerrm;
      end;
    end;
  end loop;
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.circle_recent_nudges()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_hours integer := (private.circle_rules() ->> 'alert_visible_hours')::integer;
  r record; out jsonb := '[]'::jsonb;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_missed_dose_alert') then return '[]'::jsonb; end if;
  for r in
    select m.patient_id, coalesce(nullif(split_part(btrim(pp.full_name), ' ', 1), ''), 'Someone') as name, max(a.sent_at) as since
      from public.care_circle_missed_dose_alerts a
      join public.care_circle_members m on m.id = a.member_id
      join public.profiles pp on pp.id = m.patient_id
      join public.profiles sp on sp.id = m.supporter_id and sp.is_active                                   -- P1: the gate's checks
     where m.supporter_id = v_uid and m.state = 'active' and m.expires_at > now() and m.missed_dose_alert
       and 'adherence_summary' = any (m.permissions) and not private.circle_paused(m.patient_id)
       and not private.circle_patient_is_minor(m.patient_id)                                                -- P1
       and private.consent_in_force(m.patient_id, 'vitals', 'care_circle_sharing')                          -- P1
       and a.notified and a.sent_at > now() - make_interval(hours => v_hours)
       -- once the patient has answered the slot (taken, late, skipped, missed or not available) there is nothing left to nudge about
       and not exists (select 1 from public.medication_logs l
                        where l.medication_id = a.medication_id and l.scheduled_for_date = a.scheduled_for_date and l.scheduled_time = a.scheduled_time)
     group by m.patient_id, pp.full_name
     order by max(a.sent_at) desc
  loop
    out := out || jsonb_build_array(jsonb_build_object('patient_id', r.patient_id, 'name', r.name, 'since', r.since));
    perform private.log_care_access(r.patient_id, 'record_viewed', 'care_circle', jsonb_build_object('blocks', jsonb_build_array('nudge')), v_uid);
  end loop;
  return out;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. Help alert: still sent while paused (D-help), and now readable by the supporter it was sent to
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.circle_help_alert_view(p_patient uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  m public.care_circle_members%rowtype;
  a public.care_circle_help_alerts%rowtype;
begin
  select * into a from public.care_circle_help_alerts where patient_id = p_patient
     and created_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer) order by created_at desc limit 1;
  m := private.circle_member_for(p_patient, 'red_alerts');
  if m.id is null and a.id is not null
     and exists (select 1 from public.care_circle_pauses p where p.patient_id = p_patient and p.paused_until > now() and p.pause_alerts
                    and a.created_at >= p.paused_from) then
    -- P1 (D-help): the patient pressed help while their alerts were paused, so the alert was sent to them anyway; the member it reached may
    -- read that alert. Only an alert sent DURING the current pause: one sent before the patient paused stays hidden by the pause. Every other check of the gate still applies (active, unexpired, adult patient, active supporter, red_alerts held).
    select mm.* into m from public.care_circle_members mm join public.profiles s on s.id = mm.supporter_id and s.is_active
     where mm.patient_id = p_patient and mm.supporter_id = (select auth.uid()) and mm.state = 'active' and mm.expires_at > now()
       and 'red_alerts' = any (mm.permissions) and not private.circle_patient_is_minor(mm.patient_id)
     limit 1;
  end if;
  if m.id is null then raise exception 'you do not support this person' using errcode = '42501'; end if;
  if a.id is null then return null; end if;
  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('help_alert', true, 'location', a.latitude is not null), m.supporter_id);
  return jsonb_build_object('alert_id', a.id, 'sent_at', a.created_at, 'latitude', a.latitude, 'longitude', a.longitude, 'accuracy_m', a.accuracy_m);
end $function$;

CREATE OR REPLACE FUNCTION public.send_circle_help_alert(p_lat double precision DEFAULT NULL::double precision, p_lng double precision DEFAULT NULL::double precision, p_accuracy_m integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_org     uuid;
  v_test    boolean;
  v_rules   jsonb := private.help_alert_rules();
  v_consent boolean;
  v_share   boolean := false;
  v_prior   public.care_circle_help_alerts%rowtype;
  v_id      uuid;
  v_told    integer := 0;
  v_members integer := 0;
  r         record;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.go_live_open_patient('care_circle_help_alert_enabled', v_uid) then raise exception 'the one-tap alert is not open yet' using errcode = '55000'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;

  -- A second tap inside the cooldown is the same alert, not a new one.
  select * into v_prior from public.care_circle_help_alerts
   where patient_id = v_uid and created_at > now() - make_interval(mins => (v_rules ->> 'cooldown_minutes')::integer) order by created_at desc limit 1;
  if found then
    return jsonb_build_object('alert_id', v_prior.id, 'already_sent', true, 'recipients_told', v_prior.recipients_told, 'location_shared', v_prior.location_shared,
                              'circle_paused', private.circle_alerts_paused(v_uid));
  end if;
  if (select count(*) from public.care_circle_help_alerts where patient_id = v_uid and created_at > now() - interval '1 day') >= (v_rules ->> 'max_per_day')::integer then
    raise exception 'you have sent several alerts today; please call someone you trust' using errcode = '54000';
  end if;

  select coalesce(granted, false) into v_consent from public.care_circle_location_consents where patient_id = v_uid;
  v_share := coalesce(v_consent, false) and p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;

  insert into public.care_circle_help_alerts (organisation_id, patient_id, location_shared, latitude, longitude, accuracy_m, is_test)
  values (v_org, v_uid, v_share, case when v_share then p_lat end, case when v_share then p_lng end, case when v_share and p_accuracy_m between 0 and 100000 then p_accuracy_m end, v_test)
  returning id into v_id;

  -- D-help (founder 2026-11-04): a help tap reaches the circle even while its alerts are paused. The patient is warned on screen first.
  for r in
    select m.supporter_id from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
     where m.patient_id = v_uid and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions) and s.is_test = v_test
       and not private.circle_patient_is_minor(m.patient_id)                                                   -- P1
  loop
    v_members := v_members + 1;
    begin
      perform private.circle_notify(r.supporter_id, v_org, 'circle_help_tap', 'care_circle_help_alerts', v_id, array['in_app', 'push', 'email'], 'critical', v_test);
      v_told := v_told + 1;
    exception when others then
      begin
        perform private.page_incident(v_org, 'circle_help_alert_failed:' || v_id || ':' || r.supporter_id, 'A Care Circle alert could not be sent',
          'A patient''s one-tap alert ' || v_id || ' was saved, but telling one supporter failed: ' || sqlerrm);
      exception when others then
        raise warning 'help alert % and its incident both failed: %', v_id, sqlerrm;
      end;
    end;
  end loop;
  update public.care_circle_help_alerts set recipients_told = v_told where id = v_id;
  perform private.log_audit('care_circle.help_alert_sent', 'care_circle_help_alerts', v_id, jsonb_build_object('location_shared', v_share, 'supporters', v_members, 'told', v_told));
  return jsonb_build_object('alert_id', v_id, 'already_sent', false, 'recipients_told', v_told, 'supporters', v_members, 'location_shared', v_share,
                            'location_discarded', (p_lat is not null and not v_share), 'circle_paused', private.circle_alerts_paused(v_uid));
end $function$;

-- ---------------------------------------------------------------------------
-- 4. List readers: the same supporter-active and adult-patient checks as the gate
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.circle_open_alerts()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', x.patient_id, 'name', x.name, 'since', x.since, 'called', x.called) order by x.since desc), '[]'::jsonb)
    from (select m.patient_id, coalesce(nullif(btrim(p.full_name), ''), 'Someone') as name, max(pg.sent_at) as since,
                 bool_and(exists (select 1 from public.care_circle_alert_acks a where a.page_id = pg.id and a.supporter_id = m.supporter_id)) as called
            from public.care_circle_members m
            join public.profiles p on p.id = m.patient_id
            join public.profiles s on s.id = m.supporter_id and s.is_active                                        -- P1
            join public.pages pg on pg.patient_id = m.patient_id and pg.parent_page_id is null and pg.closed_at is null
                                and pg.sent_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
           where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
             and not private.circle_patient_is_minor(m.patient_id)                                                  -- P1
             and not private.circle_alerts_paused(m.patient_id) and private.circle_page_visible(m.patient_id, pg.sent_at) and private.page_circle_may_know(pg.id)
           group by m.patient_id, p.full_name) x
$function$;

CREATE OR REPLACE FUNCTION public.circle_unanswered_check_ins()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', x.patient_id, 'name', x.name, 'since', x.since) order by x.since desc), '[]'::jsonb)
    from (select m.patient_id, coalesce(nullif(btrim(p.full_name), ''), 'Someone') as name, max(c.resolved_at) as since
            from public.care_circle_members m
            join public.profiles p on p.id = m.patient_id
            join public.profiles s on s.id = m.supporter_id and s.is_active                                        -- P1
            join public.care_circle_check_ins c on c.patient_id = m.patient_id and c.state = 'escalated'
                                               and c.resolved_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
           where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
             and not private.circle_patient_is_minor(m.patient_id)                                                  -- P1
             and not private.circle_alerts_paused(m.patient_id)
             and private.circle_page_visible(m.patient_id, c.resolved_at)
             and not ((select auth.uid()) = any (c.called_by))
           group by m.patient_id, p.full_name) x
$function$;

-- ---------------------------------------------------------------------------
-- 5. A supporter sees their own membership row only while it is active
-- ---------------------------------------------------------------------------
drop policy care_circle_members_own on public.care_circle_members;
create policy care_circle_members_own on public.care_circle_members
  for select to authenticated
  using (patient_id = (select auth.uid()) or (supporter_id = (select auth.uid()) and state = 'active'));
comment on policy care_circle_members_own on public.care_circle_members is
  'Care Circle P1: the patient sees all their rows; a supporter sees their own row only while it is active, so a removed supporter cannot '
  'read who removed them or when (S29 rule: a removed supporter is told nothing).';

-- ---------------------------------------------------------------------------
-- 6. Permission history
-- ---------------------------------------------------------------------------
create table public.care_circle_permission_history (
  id                    uuid primary key default gen_random_uuid(),
  organisation_id       uuid not null references public.organisations (id) on delete restrict,
  patient_id            uuid not null references public.profiles (id) on delete cascade,
  member_id             uuid references public.care_circle_members (id) on delete cascade,
  supporter_id          uuid references public.profiles (id) on delete cascade,
  note_id               uuid references public.family_doctor_notes (id) on delete cascade,
  actor_id              uuid references public.profiles (id) on delete set null,
  actor_role            text not null check (actor_role in ('patient', 'supporter', 'system')),
  changes               text[] not null check (cardinality(changes) >= 1 and changes <@ array[
                          'added', 'offered', 'accepted', 'declined', 'withdrawn', 'offer_lapsed', 'permissions_changed', 'renewed', 'revoked', 'expired',
                          'monthly_report_on', 'monthly_report_off', 'missed_dose_alert_on', 'missed_dose_alert_off',
                          'paused', 'resumed', 'doctor_note_shared', 'doctor_note_withdrawn']::text[]),
  permissions           text[],
  previous_permissions  text[],
  state                 text,
  expires_at            timestamptz,
  is_test               boolean not null default false,
  created_at            timestamptz not null default clock_timestamp()
);
create index care_circle_permission_history_patient_idx on public.care_circle_permission_history (patient_id, created_at desc);
create index care_circle_permission_history_member_idx on public.care_circle_permission_history (member_id);
comment on table public.care_circle_permission_history is
  'Care Circle P1 (spec 6.3, 16.4): every change to who may see what in a patient''s Care Circle, with the real actor. Written only by '
  'triggers on care_circle_members and care_circle_pauses and by set_family_note_shared, so no path can skip it. Append only. The patient '
  'reads theirs (my_circle_sharing_history); supporters read none of it.';

alter table public.care_circle_permission_history enable row level security;
create policy care_circle_permission_history_patient on public.care_circle_permission_history
  for select to authenticated using (patient_id = (select auth.uid()));
grant select on public.care_circle_permission_history to authenticated;
-- written only by SECURITY DEFINER triggers and functions; a signed-in user may read their own rows and nothing else
revoke insert, update, delete, truncate on public.care_circle_permission_history from authenticated;
revoke all on public.care_circle_permission_history from anon;

-- append only: no row is ever changed (deletes come only from the erasure cascades of the patient, member or note)
create function private.care_circle_permission_history_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'care_circle_permission_history is append only' using errcode = '42501';
end $$;
create trigger care_circle_permission_history_no_update before update on public.care_circle_permission_history
  for each row execute function private.care_circle_permission_history_immutable();

-- the signed-in profile, or null (a sweep, a service call, or a token whose subject has no profile): a history row must never make the
-- change it records fail, so the actor is looked up rather than trusted
create function private.circle_history_actor() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where id = (select auth.uid())
$$;

create function private.circle_history_actor_role(p_patient uuid, p_supporter uuid)
returns text language sql stable set search_path = '' as $$
  select case (select auth.uid()) when p_patient then 'patient' when p_supporter then 'supporter' else 'system' end
$$;

create function private.care_circle_members_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_changes text[] := '{}';
begin
  if tg_op = 'INSERT' then
    v_changes := array[case when new.state = 'active' then 'added' else new.state end];
  else
    if new.state is distinct from old.state then
      v_changes := v_changes || case
        when new.state = 'active' and old.state = 'offered' then 'accepted'
        when new.state = 'expired' and old.state = 'offered' then 'offer_lapsed'
        when new.state in ('revoked', 'expired', 'declined', 'withdrawn', 'offered') then new.state
        else 'permissions_changed' end;
    end if;
    if new.permissions is distinct from old.permissions and not (new.permissions @> old.permissions and old.permissions @> new.permissions) then
      v_changes := v_changes || 'permissions_changed'::text;
    end if;
    if new.expires_at is distinct from old.expires_at and new.state = old.state and new.expires_at > old.expires_at then
      v_changes := v_changes || 'renewed'::text;
    end if;
    if new.monthly_report_shared is distinct from old.monthly_report_shared then
      v_changes := v_changes || case when new.monthly_report_shared then 'monthly_report_on' else 'monthly_report_off' end;
    end if;
    if new.missed_dose_alert is distinct from old.missed_dose_alert then
      v_changes := v_changes || case when new.missed_dose_alert then 'missed_dose_alert_on' else 'missed_dose_alert_off' end;
    end if;
  end if;
  if cardinality(v_changes) = 0 then return new; end if;
  insert into public.care_circle_permission_history
    (organisation_id, patient_id, member_id, supporter_id, actor_id, actor_role, changes, permissions, previous_permissions, state, expires_at, is_test)
  values
    (new.organisation_id, new.patient_id, new.id, new.supporter_id, private.circle_history_actor(),
     private.circle_history_actor_role(new.patient_id, new.supporter_id),
     array(select distinct c from unnest(v_changes) c), new.permissions,
     case when tg_op = 'UPDATE' then old.permissions end, new.state, new.expires_at, coalesce(new.is_test, false));
  return new;
end $$;
-- AFTER, so the row it records is the row that was actually stored (every BEFORE trigger, e.g. the nudge clear, has run)
create trigger care_circle_members_history after insert or update on public.care_circle_members
  for each row execute function private.care_circle_members_history();

create function private.care_circle_pauses_history() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_org uuid; v_test boolean; v_change text;
begin
  v_change := case
    when tg_op = 'INSERT' or (old.paused_until <= now() and new.paused_until > now()) then 'paused'
    when old.paused_until > now() and new.paused_until <= now() then 'resumed'
    else null end;
  if v_change is null then return new; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = new.patient_id;
  if v_org is null then return new; end if;
  insert into public.care_circle_permission_history (organisation_id, patient_id, actor_id, actor_role, changes, is_test)
  values (v_org, new.patient_id, private.circle_history_actor(), private.circle_history_actor_role(new.patient_id, null), array[v_change], v_test);
  return new;
end $$;
create trigger care_circle_pauses_history after insert or update on public.care_circle_pauses
  for each row execute function private.care_circle_pauses_history();


-- the patient releasing (or withdrawing) a doctor's note to their circle is a disclosure: record it
CREATE OR REPLACE FUNCTION public.set_family_note_shared(p_note uuid, p_share boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_uid uuid := (select auth.uid()); n public.family_doctor_notes%rowtype; v_was boolean;
begin
  if v_uid is null or p_share is null then raise exception 'family_note_not_allowed' using errcode = '42501'; end if;
  select released_at is not null into v_was from public.family_doctor_notes where id = p_note and patient_id = v_uid;   -- P1
  perform set_config('tarragon.family_note_release', 'on', true);
  update public.family_doctor_notes
     set released_at = case when p_share then coalesce(released_at, now()) end,
         released_by = case when p_share then v_uid end,
         share_decided_at = now()
   where id = p_note and patient_id = v_uid
   returning * into n;
  perform set_config('tarragon.family_note_release', 'off', true);
  -- one answer for "not yours" and "no such note"
  if n.id is null then raise exception 'family_note_not_found' using errcode = 'P0002'; end if;
  -- P1: a change of release state goes into the patient's sharing history (who could see it is "members holding doctor_note")
  if coalesce(v_was, false) is distinct from (n.released_at is not null) then
    insert into public.care_circle_permission_history (organisation_id, patient_id, note_id, actor_id, actor_role, changes, is_test)
    values (n.organisation_id, n.patient_id, n.id, v_uid, 'patient',
            array[case when n.released_at is not null then 'doctor_note_shared' else 'doctor_note_withdrawn' end], n.is_test);
  end if;
  return n.released_at is not null;
end $function$;

-- the patient's own reading of their sharing history
create function public.my_circle_sharing_history(p_limit integer default 50)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'at', h.created_at, 'changes', to_jsonb(h.changes), 'by', h.actor_role,
           'supporter', case when h.supporter_id is not null
                             then coalesce(nullif(split_part(btrim(coalesce(s.full_name, '')), ' ', 1), ''), 'A supporter') end,
           'permissions', to_jsonb(h.permissions), 'previous_permissions', to_jsonb(h.previous_permissions)) order by h.created_at desc), '[]'::jsonb)
    from (select * from public.care_circle_permission_history
           where patient_id = (select auth.uid()) order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) h
    left join public.profiles s on s.id = h.supporter_id
$$;
revoke all on function public.my_circle_sharing_history(integer) from public;
grant execute on function public.my_circle_sharing_history(integer) to authenticated;

-- an audit record must be writable whatever the patient's age (e.g. a removal that happens because a profile became a dependant)
select private.classify_minor_dependant_table('care_circle_permission_history', 'exempt',
  'Care Circle P1 audit record of sharing changes: must be writable for any patient, including when access ends for a dependant');

insert into public.data_registry (table_name, patient_expr, retention_class, end_of_retention, in_export, reviewed, notes)
values ('care_circle_permission_history', 'patient_id', 'audit', 'review', true, false,
        'Every change to who may see what in a patient''s Care Circle (added, permissions, renewals, removals, pauses, doctor-note releases), '
        'with the real actor. Class assigned by the migration author, not yet reviewed by the CMO and DPO.');

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.my_circle_sharing_history(integer)', 'EXECUTE') then
    raise exception 'P1 self-check: anon can execute my_circle_sharing_history';
  end if;
  if has_table_privilege('anon', 'public.care_circle_permission_history', 'SELECT') then
    raise exception 'P1 self-check: anon can read care_circle_permission_history';
  end if;
  if position('circle_consented_permissions' in pg_get_functiondef('private.circle_view_blocks(uuid, text[])'::regprocedure)) = 0
     or position('circle_consented_permissions' in pg_get_functiondef('public.circle_weekly_digest(uuid)'::regprocedure)) = 0
     or position('consent_in_force' in pg_get_functiondef('private.sweep_circle_missed_doses(timestamp without time zone)'::regprocedure)) = 0 then
    raise exception 'P1 self-check: a Care Circle reader is missing the consent check';
  end if;
end $$;

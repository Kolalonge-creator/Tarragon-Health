-- Tarragon Health: P22 / PD-08 (founder, 2026-11-06, Q7). Care Circle typed help requests.
--
-- The existing "Ask my Care Circle for help" alert (S65c, care_circle_help_alerts + send_circle_help_alert) gains a TYPE and an optional
-- short NOTE. Extends the existing table and RPC; no parallel table, no new notification path (supporters are still told through
-- private.circle_notify on in_app/push/email, with the same neutral notice that names nothing).
--
--   * care_circle_help_alerts.request_type: one of booking, test_payment, medicine_collection, transport, call_me. NULL stays legal on
--     purpose: every row written before this migration has no type, and a caller that does not send one (an older app build during the
--     deploy window) must still be able to ask for help. The patient app now always sends one.
--   * care_circle_help_alerts.request_note: optional, at most 200 characters, trimmed; blank becomes NULL. Written by the patient for the
--     people they chose; the screen asks them to leave medical details out. It is never put in a notification or the audit log.
--   * send_circle_help_alert gains p_request_type and p_note (both default NULL). The old 3-argument function is DROPPED first, not
--     overloaded: two functions that both accept a zero-argument call would make every existing call ambiguous (42725). The body is the
--     LIVE body (pg_get_functiondef, 2026-11-07, identical to 20261104172930), with only the type/note validation, the insert columns,
--     the audit detail and the returned fields added.
--   * Priority (founder as CMO, 2026-11-07): a typed request reaches supporters as a 'routine' notification (notification_priority is
--     {routine, critical}, checked live read-only); an untyped tap keeps 'critical'.
--   * circle_help_alert_view returns request_type and request_note. Same LIVE body otherwise; same membership gate, same audit.
--
-- No row is converted: both columns are added nullable.

alter table public.care_circle_help_alerts
  add column if not exists request_type text,
  add column if not exists request_note text;
alter table public.care_circle_help_alerts drop constraint if exists care_circle_help_alerts_request_type_check;
alter table public.care_circle_help_alerts add constraint care_circle_help_alerts_request_type_check
  check (request_type is null or request_type in ('booking', 'test_payment', 'medicine_collection', 'transport', 'call_me'));
alter table public.care_circle_help_alerts drop constraint if exists care_circle_help_alerts_request_note_check;
alter table public.care_circle_help_alerts add constraint care_circle_help_alerts_request_note_check
  check (request_note is null or (length(request_note) between 1 and 200 and request_note = btrim(request_note)));

comment on column public.care_circle_help_alerts.request_type is
  'P22/PD-08: what the patient is asking their Care Circle for. NULL for alerts sent before typed requests existed. Not clinical; not an emergency service.';
comment on column public.care_circle_help_alerts.request_note is
  'P22/PD-08: the patient''s optional short note to their supporters (1-200 chars). Never sent in a notification; read only through circle_help_alert_view.';

drop function if exists public.send_circle_help_alert(double precision, double precision, integer);

create function public.send_circle_help_alert(
  p_lat double precision default null,
  p_lng double precision default null,
  p_accuracy_m integer default null,
  p_request_type text default null,
  p_note text default null
) returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
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
  v_type    text := nullif(btrim(coalesce(p_request_type, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  r         record;
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  if not private.go_live_open_patient('care_circle_help_alert_enabled', v_uid) then raise exception 'the one-tap alert is not open yet' using errcode = '55000'; end if;
  -- P22: the type must be one of the five; the note is short. Checked before anything is written.
  if v_type is not null and v_type not in ('booking', 'test_payment', 'medicine_collection', 'transport', 'call_me') then
    raise exception 'unknown kind of help' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 200 then raise exception 'the note is too long' using errcode = '22023'; end if;
  select organisation_id, coalesce(is_test, false) into v_org, v_test from public.profiles where id = v_uid;

  -- A second tap inside the cooldown is the same alert, not a new one.
  select * into v_prior from public.care_circle_help_alerts
   where patient_id = v_uid and created_at > now() - make_interval(mins => (v_rules ->> 'cooldown_minutes')::integer) order by created_at desc limit 1;
  if found then
    return jsonb_build_object('alert_id', v_prior.id, 'already_sent', true, 'recipients_told', v_prior.recipients_told, 'location_shared', v_prior.location_shared,
                              'request_type', v_prior.request_type, 'circle_paused', private.circle_alerts_paused(v_uid));
  end if;
  if (select count(*) from public.care_circle_help_alerts where patient_id = v_uid and created_at > now() - interval '1 day') >= (v_rules ->> 'max_per_day')::integer then
    raise exception 'you have sent several alerts today; please call someone you trust' using errcode = '54000';
  end if;

  select coalesce(granted, false) into v_consent from public.care_circle_location_consents where patient_id = v_uid;
  v_share := coalesce(v_consent, false) and p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;

  insert into public.care_circle_help_alerts (organisation_id, patient_id, location_shared, latitude, longitude, accuracy_m, is_test, request_type, request_note)
  values (v_org, v_uid, v_share, case when v_share then p_lat end, case when v_share then p_lng end, case when v_share and p_accuracy_m between 0 and 100000 then p_accuracy_m end, v_test,
          v_type, v_note)
  returning id into v_id;

  -- D-help (founder 2026-11-04): a help tap reaches the circle even while its alerts are paused. The patient is warned on screen first.
  for r in
    select m.supporter_id from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
     where m.patient_id = v_uid and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions) and s.is_test = v_test
       and not private.circle_patient_is_minor(m.patient_id)                                                   -- P1
  loop
    v_members := v_members + 1;
    begin
      -- Founder (CMO), 2026-11-07: a TYPED request (help booking, paying, collecting medicines, transport, call me) is not an alarm and goes
      -- out as a routine notification. An untyped tap (the old one-tap alarm, e.g. from the phone app) stays critical.
      perform private.circle_notify(r.supporter_id, v_org, 'circle_help_tap', 'care_circle_help_alerts', v_id, array['in_app', 'push', 'email'],
                                    case when v_type is null then 'critical' else 'routine' end, v_test);
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
  -- The audit names the kind of help and whether a note was written, never the note itself.
  perform private.log_audit('care_circle.help_alert_sent', 'care_circle_help_alerts', v_id, jsonb_build_object('location_shared', v_share, 'supporters', v_members, 'told', v_told,
                            'request_type', v_type, 'has_note', v_note is not null));
  return jsonb_build_object('alert_id', v_id, 'already_sent', false, 'recipients_told', v_told, 'supporters', v_members, 'location_shared', v_share,
                            'location_discarded', (p_lat is not null and not v_share), 'circle_paused', private.circle_alerts_paused(v_uid),
                            'request_type', v_type);
end $function$;
revoke all on function public.send_circle_help_alert(double precision, double precision, integer, text, text) from public, anon;
grant execute on function public.send_circle_help_alert(double precision, double precision, integer, text, text) to authenticated;

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
  -- P22: the kind of help and the patient's own note. Nothing clinical is read here.
  return jsonb_build_object('alert_id', a.id, 'sent_at', a.created_at, 'latitude', a.latitude, 'longitude', a.longitude, 'accuracy_m', a.accuracy_m,
                            'request_type', a.request_type, 'request_note', a.request_note);
end $function$;

do $$
begin
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'send_circle_help_alert') <> 1 then
    raise exception 'exactly one send_circle_help_alert must exist (no overload)';
  end if;
  if has_function_privilege('anon', 'public.send_circle_help_alert(double precision, double precision, integer, text, text)', 'EXECUTE') then
    raise exception 'anon must not execute send_circle_help_alert';
  end if;
  if not has_function_privilege('authenticated', 'public.send_circle_help_alert(double precision, double precision, integer, text, text)', 'EXECUTE') then
    raise exception 'authenticated must execute send_circle_help_alert';
  end if;
  if has_table_privilege('anon', 'public.care_circle_help_alerts', 'SELECT') then
    raise exception 'anon must not read care_circle_help_alerts';
  end if;
end $$;

-- S65c: the Care Circle one-tap alert (spec 15.15, CMO Q20), the emergency pack config (15.13, 15.14, Q17, Q18) and the clinician licence
-- display (Q19).
--
-- Reconciled first. Live: S29 Care Circle (`care_circle_members`, permission `red_alerts`, a neutral automatic alert when a red page is
-- created) and its audit through `log_care_access`. That automatic alert stays exactly as it is and carries NO location. This adds a
-- different thing: an alert the PATIENT sends on their own tap, with an optional location they have consented to.
--
-- Safety and privacy rules built in:
--   * Patient-initiated only. There is no trigger path to it and no caller but the patient themself (a caregiver cannot tap for someone).
--   * Location is stored only if the patient has an active, explicit consent AND sends coordinates on that tap. Coordinates sent without
--     consent are discarded and the alert still goes (never refuse help), and the answer says the location was not shared.
--   * Consent is revocable at any time (set_circle_location_consent(false)); revoking does not stop alerts, only location.
--   * A shared location is deleted after `location_keep_hours` (PROPOSED config) by an hourly sweep.
--   * No notification carries the location, a name, a reading or a condition (INV-07). The push and email only say that someone may need
--     you; a supporter sees the location by signing in, and that read is written to care_access_events (INV-10). The spec asks for "push
--     and email, with location"; location in the sign-in view only is the safer reading of INV-07 and is recorded in docs/OPEN-QUESTIONS.md.
--   * It never replaces the in-app route: the alert is a row first (care_circle_help_alerts), notifications are best effort, and a
--     recipient who fails raises an ops incident instead of being skipped quietly. The result says how many supporters were told.
--   * Behind a NEW go-live guard, care_circle_help_alert_enabled, seeded OFF.

-- ---------------------------------------------------------------------------
-- 1. Config (PROPOSED)
-- ---------------------------------------------------------------------------
create table public.care_circle_help_alert_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index care_circle_help_alert_config_one_active on public.care_circle_help_alert_config (is_active) where is_active;
alter table public.care_circle_help_alert_config enable row level security;
create policy care_circle_help_alert_config_read on public.care_circle_help_alert_config for select to authenticated using (true);
revoke all on public.care_circle_help_alert_config from public, anon, authenticated;
grant select on public.care_circle_help_alert_config to authenticated;

-- help-alert-begin
insert into public.care_circle_help_alert_config (version, is_active, effective_from, rules) values (1, true, '2026-10-07', $json$
{ "cooldown_minutes": 10, "max_per_day": 5, "location_keep_hours": 24, "consent_text_version": 1 }
$json$::jsonb);
-- help-alert-end

create function private.help_alert_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.care_circle_help_alert_config where is_active $$;
revoke all on function private.help_alert_rules() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table public.care_circle_location_consents (
  patient_id    uuid primary key references public.profiles (id) on delete cascade,
  granted       boolean not null,
  text_version  integer not null check (text_version >= 1),
  changed_at    timestamptz not null default now()
);
create table public.care_circle_help_alerts (
  id                uuid primary key default gen_random_uuid(),
  organisation_id   uuid not null references public.organisations (id) on delete restrict,
  patient_id        uuid not null references public.profiles (id) on delete cascade,
  location_shared   boolean not null default false,
  latitude          double precision check (latitude is null or latitude between -90 and 90),
  longitude         double precision check (longitude is null or longitude between -180 and 180),
  accuracy_m        integer check (accuracy_m is null or accuracy_m between 0 and 100000),
  location_purged_at timestamptz,
  recipients_told   integer not null default 0 check (recipients_told >= 0),
  is_test           boolean not null default false,
  created_at        timestamptz not null default now(),
  check ((latitude is null) = (longitude is null)),
  check (latitude is null or location_shared)
);
create index care_circle_help_alerts_patient_idx on public.care_circle_help_alerts (patient_id, created_at desc);

alter table public.care_circle_location_consents enable row level security;
alter table public.care_circle_help_alerts enable row level security;
-- Only the patient reads their own rows. A supporter reads through circle_help_alert_view(), which checks the membership and audits.
create policy care_circle_location_consents_own on public.care_circle_location_consents for select to authenticated using (patient_id = (select auth.uid()));
create policy care_circle_help_alerts_own on public.care_circle_help_alerts for select to authenticated using (patient_id = (select auth.uid()));
revoke all on public.care_circle_location_consents, public.care_circle_help_alerts from public, anon, authenticated;
grant select on public.care_circle_location_consents, public.care_circle_help_alerts to authenticated;

insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('care_circle_help_alert_enabled', 'Care Circle one-tap alert', 'The patient''s one-tap alert to their Care Circle, and the optional shared location',
   'Consent text signed off by the founder or counsel; revocation tried on a phone; at least one real supporter invited', 'admin',
   array['send_circle_help_alert', 'set_circle_location_consent'],
   'The automatic neutral red alert to supporters (S29) is not behind this guard and carries no location.')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Consent
-- ---------------------------------------------------------------------------
create function public.set_circle_location_consent(p_granted boolean) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ver integer := coalesce((private.help_alert_rules() ->> 'consent_text_version')::integer, 1);
begin
  if v_uid is null then raise exception 'sign in first' using errcode = '42501'; end if;
  -- Revoking is always allowed, even with the guard off: a person must be able to withdraw consent at any time.
  if p_granted and not private.go_live_open_patient('care_circle_help_alert_enabled', v_uid) then
    raise exception 'the one-tap alert is not open yet' using errcode = '55000';
  end if;
  insert into public.care_circle_location_consents (patient_id, granted, text_version, changed_at)
  values (v_uid, p_granted, v_ver, now())
  on conflict (patient_id) do update set granted = excluded.granted, text_version = excluded.text_version, changed_at = now();
  -- Withdrawing consent takes effect now: any location already attached to this person's recent alerts is deleted at once, not at the 24 hour sweep.
  if not p_granted then
    update public.care_circle_help_alerts set latitude = null, longitude = null, accuracy_m = null, location_purged_at = now()
     where patient_id = v_uid and latitude is not null;
  end if;
  perform private.log_care_access(v_uid, (case when p_granted then 'granted' else 'revoked' end)::public.care_access_event_kind, 'care_circle',
                                  jsonb_build_object('help_alert_location', true, 'text_version', v_ver), v_uid);
  return jsonb_build_object('granted', p_granted, 'text_version', v_ver);
end $$;
revoke all on function public.set_circle_location_consent(boolean) from public, anon;
grant execute on function public.set_circle_location_consent(boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The tap
-- ---------------------------------------------------------------------------
create function public.send_circle_help_alert(p_lat double precision default null, p_lng double precision default null, p_accuracy_m integer default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
    return jsonb_build_object('alert_id', v_prior.id, 'already_sent', true, 'recipients_told', v_prior.recipients_told, 'location_shared', v_prior.location_shared);
  end if;
  if (select count(*) from public.care_circle_help_alerts where patient_id = v_uid and created_at > now() - interval '1 day') >= (v_rules ->> 'max_per_day')::integer then
    raise exception 'you have sent several alerts today; please call someone you trust' using errcode = '54000';
  end if;

  select coalesce(granted, false) into v_consent from public.care_circle_location_consents where patient_id = v_uid;
  v_share := coalesce(v_consent, false) and p_lat is not null and p_lng is not null and p_lat between -90 and 90 and p_lng between -180 and 180;

  insert into public.care_circle_help_alerts (organisation_id, patient_id, location_shared, latitude, longitude, accuracy_m, is_test)
  values (v_org, v_uid, v_share, case when v_share then p_lat end, case when v_share then p_lng end, case when v_share and p_accuracy_m between 0 and 100000 then p_accuracy_m end, v_test)
  returning id into v_id;

  for r in
    select m.supporter_id from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
     where m.patient_id = v_uid and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions) and s.is_test = v_test
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
                            'location_discarded', (p_lat is not null and not v_share));
end $$;
revoke all on function public.send_circle_help_alert(double precision, double precision, integer) from public, anon;
grant execute on function public.send_circle_help_alert(double precision, double precision, integer) to authenticated;

-- The supporter's view of the latest alert. Membership with red_alerts is required; the read is written to the care access log.
create function public.circle_help_alert_view(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  a public.care_circle_help_alerts%rowtype;
begin
  m := private.circle_member_for(p_patient, 'red_alerts');
  if m.id is null then raise exception 'you do not support this person' using errcode = '42501'; end if;
  select * into a from public.care_circle_help_alerts where patient_id = p_patient
     and created_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer) order by created_at desc limit 1;
  if not found then return null; end if;
  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('help_alert', true, 'location', a.latitude is not null), m.supporter_id);
  return jsonb_build_object('alert_id', a.id, 'sent_at', a.created_at, 'latitude', a.latitude, 'longitude', a.longitude, 'accuracy_m', a.accuracy_m);
end $$;
revoke all on function public.circle_help_alert_view(uuid) from public, anon;
grant execute on function public.circle_help_alert_view(uuid) to authenticated;

create function private.purge_help_alert_locations() returns integer
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.care_circle_help_alerts
     set latitude = null, longitude = null, accuracy_m = null, location_purged_at = now()
   where latitude is not null and created_at < now() - make_interval(hours => (private.help_alert_rules() ->> 'location_keep_hours')::integer);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function private.purge_help_alert_locations() from public, anon, authenticated;
select cron.schedule('purge-help-alert-locations', '17 * * * *', $c$select private.purge_help_alert_locations()$c$);

-- ---------------------------------------------------------------------------
-- 5. The emergency pack config (DRAFT, versioned, mirrors packages/shared/src/proposed-config/emergency-pack.ts)
-- ---------------------------------------------------------------------------
-- NO telephone number appears in the pack (CMO Q18). The check below fails the migration if a digit run that looks like a number, or 112, 767, 199 or 911, is present.
create table public.emergency_pack_config (
  id          uuid primary key default gen_random_uuid(),
  version     integer not null unique,
  status      text not null default 'draft' check (status in ('draft', 'signed')),
  is_active   boolean not null default false,
  content     jsonb not null,
  signed_by   text,
  signed_on   date,
  created_at  timestamptz not null default now(),
  check ((status = 'signed') = (signed_by is not null and signed_on is not null)),
  check (content ->> 'first_line' = 'Go to the nearest hospital now.'),
  check (content::text !~ '(^|[^0-9.])[0-9]{7,}' and content::text !~ '(^|[^0-9.])(112|767|199|911)([^0-9]|$)')
);
create unique index emergency_pack_config_one_active on public.emergency_pack_config (is_active) where is_active;
alter table public.emergency_pack_config enable row level security;
create policy emergency_pack_config_read on public.emergency_pack_config for select to authenticated using (true);
revoke all on public.emergency_pack_config from public, anon, authenticated;
grant select on public.emergency_pack_config to authenticated;
-- No write path through the API: a new version is a reviewed migration or a CMO-signed publish, never a client write.

-- emergency-pack-begin
insert into public.emergency_pack_config (version, status, is_active, content) values (1, 'draft', true, $json$
{
 "version": 1,
 "status": "draft",
 "signed": null,
 "first_line": "Go to the nearest hospital now.",
 "topics": [
  {
   "key": "chest_pain",
   "title": "Chest pain or pressure",
   "signs": [
    "Pain, pressure or tightness in the chest",
    "Pain spreading to the arm, jaw or back",
    "Cold sweat, feeling faint or being sick"
   ],
   "steps": [
    "Sit down and stay as still as you can. Ask someone to take you or to bring help. Do not drive yourself.",
    "If you are awake and alert and you are not allergic to aspirin, chew one aspirin (162 to 324 mg) after you have asked for help, or while you are on the way.",
    "Tell the hospital staff about your chest pain as soon as you arrive."
   ],
   "never": [
    "Do not take aspirin if you are allergic to it.",
    "Do not take aspirin if you think this may be a stroke."
   ],
   "cmo_check": "Q17 decided the aspirin line (162 to 324 mg, alert, not allergic). Wording and any other medicine exclusion await signature."
  },
  {
   "key": "stroke",
   "title": "Possible stroke",
   "signs": [
    "Face drooping on one side",
    "Weakness or numbness in one arm or leg",
    "Speech slurred or hard to understand",
    "Sudden confusion, loss of balance or sight"
   ],
   "steps": [
    "Any one of these changes means the hospital is where you need to be now. Ask someone to take you straight away.",
    "Note the time the change started and tell the hospital staff.",
    "Keep the person sitting or lying with the head slightly raised. Give nothing to eat or drink."
   ],
   "never": [
    "Never give aspirin or any other medicine for a possible stroke."
   ],
   "cmo_check": "Q17: never aspirin for stroke. Confirm the rest of the wording."
  },
  {
   "key": "severe_blood_pressure",
   "title": "Very high blood pressure with symptoms",
   "signs": [
    "A very high reading together with a bad headache, chest pain, trouble breathing, confusion, weakness or changes in sight"
   ],
   "steps": [
    "Sit or lie down. Ask someone to take you to the hospital. Do not drive yourself.",
    "Take your usual medicines as normal. Do not take extra tablets to bring the number down quickly."
   ],
   "never": [
    "Do not take extra blood pressure tablets to lower the reading fast."
   ],
   "cmo_check": "Tiered rule (Q3) is signed separately in the hub; this card wording follows the existing signed EMG codes and is not new thresholds."
  },
  {
   "key": "low_blood_sugar",
   "title": "Very low blood sugar",
   "signs": [
    "Shaking, sweating, hunger, confusion or acting strangely",
    "A reading below your care team's low line"
   ],
   "steps": [
    "If the person is awake and can swallow: give 15 g of fast sugar (for example 3 teaspoons of sugar in water, or half a glass of a sugary drink). Check again in 15 minutes and repeat if still low.",
    "If the person is not awake, or cannot swallow safely: give nothing by mouth. Lay them on their side (the recovery position) and take them to the hospital now.",
    "If they do not get better, go to the hospital."
   ],
   "never": [
    "Never put food or drink in the mouth of someone who is not awake."
   ],
   "cmo_check": "15 g and 15 minutes are the Q17/Q5 decided values; sugar equivalents in household measures need a read."
  },
  {
   "key": "seizure",
   "title": "Seizure or fit",
   "signs": [
    "Shaking of the whole body, stiffening, or loss of awareness"
   ],
   "steps": [
    "Move hard objects away. Cushion the head. Note the time it started.",
    "A seizure that lasts more than 5 minutes, or fits that come one after another, is an emergency: go to the hospital now.",
    "When the shaking stops, lay the person on their side (the recovery position) and stay with them."
   ],
   "never": [
    "Never put anything in the mouth.",
    "Never hold the person down."
   ],
   "cmo_check": "Over 5 minutes or repeated is the Q17 decision. A first-ever seizure also needs the hospital; confirm wording."
  },
  {
   "key": "pregnancy_danger",
   "title": "Pregnancy danger signs",
   "signs": [
    "Blood pressure 160/110 or higher",
    "A severe headache that does not go away",
    "Changes in sight, such as blurring or flashing lights",
    "Bleeding from the vagina",
    "A fit"
   ],
   "steps": [
    "Any one of these means the hospital now. Ask someone to take you. Do not wait to see if it settles.",
    "Lie on your left side while you wait for transport."
   ],
   "never": [
    "Do not wait for a booked visit."
   ],
   "cmo_check": "The 160/110 line and the five signs are the Q17 list; any further sign (reduced baby movement, waters breaking) needs the CMO."
  },
  {
   "key": "severe_breathlessness",
   "title": "Severe trouble breathing",
   "signs": [
    "Cannot speak a full sentence",
    "Lips or face turning blue or grey",
    "Breathing very fast, noisy or with effort"
   ],
   "steps": [
    "Sit upright. Loosen tight clothing. Ask someone to take you to the hospital now.",
    "If you have a reliever inhaler that has been prescribed to you, use it as you were taught while you wait for transport."
   ],
   "never": [
    "Do not lie flat."
   ],
   "cmo_check": "Reliever line follows the asthma rule set (Q11, signed separately). Confirm."
  },
  {
   "key": "malaria_danger",
   "title": "Fever with malaria danger signs",
   "signs": [
    "Fits",
    "Cannot drink or keep anything down",
    "Very drowsy or hard to wake",
    "Fever with any of these in a child"
   ],
   "steps": [
    "Any of these with a fever means the hospital now. Ask someone to take you.",
    "Keep the person cool with a light cloth and give small sips if they are awake and can swallow."
   ],
   "never": [
    "Do not wait to see if tablets work when one of these signs is present."
   ],
   "cmo_check": "[U] The three signs are from the Q17 list. WHO severe malaria list is longer; the CMO decides what the card carries."
  },
  {
   "key": "lassa_warning",
   "title": "Fever with Lassa warning signs",
   "signs": [
    "Fever with bleeding from the gums, nose or elsewhere",
    "Fever with severe weakness, repeated vomiting or swelling of the face",
    "Fever after contact with someone known to have Lassa fever"
   ],
   "steps": [
    "Go to the hospital now. Tell the staff about your fever and any contact before you go in, so they can protect themselves.",
    "Avoid touching the blood, urine or other body fluids of anyone who is ill."
   ],
   "never": [
    "Do not share a bed, towels or cups with the person who is ill."
   ],
   "cmo_check": "[U] The spec names Lassa warning signs without listing them. These are a draft and need the CMO against the NCDC guidance."
  }
 ],
 "states": [
  {
   "code": "AB",
   "name": "Abia",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "AD",
   "name": "Adamawa",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "AK",
   "name": "Akwa Ibom",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "AN",
   "name": "Anambra",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "BA",
   "name": "Bauchi",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "BY",
   "name": "Bayelsa",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "BE",
   "name": "Benue",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "BO",
   "name": "Borno",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "CR",
   "name": "Cross River",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "DE",
   "name": "Delta",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "EB",
   "name": "Ebonyi",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "ED",
   "name": "Edo",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "EK",
   "name": "Ekiti",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "EN",
   "name": "Enugu",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "FC",
   "name": "Federal Capital Territory",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "GO",
   "name": "Gombe",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "IM",
   "name": "Imo",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "JI",
   "name": "Jigawa",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KD",
   "name": "Kaduna",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KN",
   "name": "Kano",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KT",
   "name": "Katsina",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KE",
   "name": "Kebbi",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KO",
   "name": "Kogi",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "KW",
   "name": "Kwara",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "LA",
   "name": "Lagos",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "NA",
   "name": "Nasarawa",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "NI",
   "name": "Niger",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "OG",
   "name": "Ogun",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "ON",
   "name": "Ondo",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "OS",
   "name": "Osun",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "OY",
   "name": "Oyo",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "PL",
   "name": "Plateau",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "RI",
   "name": "Rivers",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "SO",
   "name": "Sokoto",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "TA",
   "name": "Taraba",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "YO",
   "name": "Yobe",
   "facilities": [],
   "none_listed": true
  },
  {
   "code": "ZA",
   "name": "Zamfara",
   "facilities": [],
   "none_listed": true
  }
 ]
}
$json$::jsonb);
-- emergency-pack-end

create function public.emergency_pack_current() returns jsonb
language sql stable security definer set search_path = ''
as $$ select jsonb_build_object('version', version, 'status', status, 'signed_by', signed_by, 'signed_on', signed_on, 'content', content)
        from public.emergency_pack_config where is_active $$;
revoke all on function public.emergency_pack_current() from public, anon;
grant execute on function public.emergency_pack_current() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Clinician licence for the directory and booking screens (Q19). Null-gated: nothing is returned for a clinician whose licence has
-- not been checked, so the screen never claims a check that did not happen.
-- ---------------------------------------------------------------------------
create function public.clinician_licence_public(p_profile uuid) returns table (credential_type text, credential_number text, checked_on date)
language sql stable security definer set search_path = ''
as $$
  select cs.credential_type, cs.credential_number, (coalesce(cs.credential_verified_at, cs.license_verified_at) at time zone 'Africa/Lagos')::date
    from public.clinical_staff cs
   where (select auth.uid()) is not null and cs.profile_id = p_profile and cs.active
     and cs.credential_type is not null and nullif(btrim(cs.credential_number), '') is not null
     and coalesce(cs.credential_verified_at, cs.license_verified_at) is not null
$$;
revoke all on function public.clinician_licence_public(uuid) from public, anon;
grant execute on function public.clinician_licence_public(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Assertions
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('anon', 'public.send_circle_help_alert(double precision, double precision, integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.set_circle_location_consent(boolean)', 'EXECUTE')
     or has_function_privilege('anon', 'public.circle_help_alert_view(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.emergency_pack_current()', 'EXECUTE')
     or has_function_privilege('anon', 'public.clinician_licence_public(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.purge_help_alert_locations()', 'EXECUTE') then
    raise exception 'S65c: a function is executable by a role that must not run it';
  end if;
  if has_table_privilege('authenticated', 'public.care_circle_help_alerts', 'INSERT') or has_table_privilege('authenticated', 'public.care_circle_help_alerts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.care_circle_location_consents', 'INSERT')
     or has_table_privilege('authenticated', 'public.emergency_pack_config', 'UPDATE') or has_table_privilege('anon', 'public.emergency_pack_config', 'SELECT') then
    raise exception 'S65c: a table has a grant it must not have';
  end if;
  if (select is_on from public.go_live_guards where key = 'care_circle_help_alert_enabled') then raise exception 'S65c: the guard must start off'; end if;
  if (select status from public.emergency_pack_config where is_active) <> 'draft' then raise exception 'S65c: the emergency pack must start as a draft'; end if;
  if not exists (select 1 from cron.job where jobname = 'purge-help-alert-locations') then raise exception 'S65c: purge not scheduled'; end if;
end $$;

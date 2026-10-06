-- S29c: Care Circle follow-up pack (docs/research/S29-ranked-design-plan.md, items 2, 3, 4, 8, 15, 17, 18).
--
--   2.  The patient is told 14 days and again 3 days before a supporter's access ends, and renews with one tap (server side).
--       Renewing resets both notices, because the notice is remembered against the expiry date it was sent for.
--   3.  "Pause all sharing" for pause_days (7): the supporter's view, check-in requests and lists go quiet, nothing is said to
--       the supporter, and nothing is asked of the patient (no reason). Paying for care is not sharing and keeps working.
--       The patient chooses whether check-in requests (red alerts) pause too. Their own care team's escalation is untouched.
--   4.  "See what my supporter sees": the same builder the supporter's page uses, run for the patient, never logged as a look.
--   15. Gifts: only the full yearly Membership can be paid for someone else (OQ-191 refinement, founder 2026-10-06). The
--       payer's name is already never shown to the patient on a pending gift (my_pending_gifts returns the item and a date).
--   17. A supporter can turn the push for a person off and keep the in-app request (alert_mode). No quiet hours: a time window
--       that hides a red alert is the wrong default for a safety message.
--   18. "I called them": one status per supporter per alert, no free text, private to that supporter.
--
-- Config: care_circle_config version 2 (PROPOSED values, Founder owner).
-- Live note: create_order is re-stated below with ONE added check. Diff it against the live definition before applying.

-- ---------------------------------------------------------------------------
-- 1. Config v2
-- ---------------------------------------------------------------------------
create or replace function private.care_circle_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['invite_ttl_hours', 'default_grant_days', 'max_invites_per_day', 'max_members', 'max_attempts', 'view_weeks',
                           'alert_visible_hours', 'expiry_notice_days', 'expiry_final_notice_days', 'pause_days', 'gift_decide_days'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'default_grant_days')::integer <= 1095 and (r ->> 'invite_ttl_hours')::integer <= 720
     and (r ->> 'expiry_final_notice_days')::integer < (r ->> 'expiry_notice_days')::integer
     and (r ->> 'pause_days')::integer <= 30;
exception when others then
  return false;
end;
$$;

-- Version 1 has no keys for the new rules, so it cannot satisfy the new validator. It is history, not something to rewrite: the
-- constraint now applies to version 2 and later, and version 1 keeps exactly the values it was active with.
alter table public.care_circle_config drop constraint care_circle_config_rules_valid;
alter table public.care_circle_config add constraint care_circle_config_rules_valid check (version < 2 or private.care_circle_rules_valid(rules));
update public.care_circle_config set is_active = false where is_active;
-- care-circle-rules-v2-begin
insert into public.care_circle_config (version, is_active, effective_from, rules) values (2, true, '2026-10-06', $json$
{
  "invite_ttl_hours": 72,
  "default_grant_days": 365,
  "max_invites_per_day": 5,
  "max_members": 8,
  "max_attempts": 5,
  "view_weeks": 8,
  "alert_visible_hours": 3,
  "expiry_notice_days": 14,
  "expiry_final_notice_days": 3,
  "pause_days": 7,
  "gift_decide_days": 30
}
$json$::jsonb);
-- care-circle-rules-v2-end

-- ---------------------------------------------------------------------------
-- 2. Columns and tables
-- ---------------------------------------------------------------------------
alter table public.care_circle_members
  add column alert_mode       text not null default 'push_and_app' check (alert_mode in ('push_and_app', 'app_only')),
  add column notice_first_for timestamptz,
  add column notice_final_for timestamptz;

-- One row per patient. Only the patient can read it: a supporter must not be able to tell a pause from a revoke.
create table public.care_circle_pauses (
  patient_id       uuid primary key references public.profiles (id) on delete cascade,
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  paused_until     timestamptz not null,
  paused_from      timestamptz not null default now(),
  pause_alerts     boolean not null default false,
  ended_notice_sent boolean not null default false,
  is_test          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create trigger care_circle_pauses_set_updated_at before update on public.care_circle_pauses
  for each row execute function private.set_updated_at();
alter table public.care_circle_pauses enable row level security;
revoke all on public.care_circle_pauses from public, anon, authenticated;
grant select on public.care_circle_pauses to authenticated;
create policy care_circle_pauses_own on public.care_circle_pauses for select to authenticated
  using (patient_id = (select auth.uid()));

-- A supporter's "I called them": one row per alert per supporter, nothing else. Private to that supporter.
create table public.care_circle_alert_acks (
  page_id         uuid not null references public.pages (id) on delete cascade,
  supporter_id    uuid not null references public.profiles (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  acked_at        timestamptz not null default now(),
  primary key (page_id, supporter_id)
);
alter table public.care_circle_alert_acks enable row level security;
revoke all on public.care_circle_alert_acks from public, anon, authenticated;
grant select on public.care_circle_alert_acks to authenticated;
create policy care_circle_alert_acks_own on public.care_circle_alert_acks for select to authenticated
  using (supporter_id = (select auth.uid()));

-- The v1 sweep already told the patient about members near their end; remember that so the first v2 sweep does not repeat it.
update public.care_circle_members m set notice_first_for = m.expires_at
 where m.state = 'active' and exists (select 1 from public.notifications n where n.template = 'circle_expiring' and n.source_table = 'care_circle_members' and n.source_id = m.id);

-- ---------------------------------------------------------------------------
-- 3. Pause: the gates
-- ---------------------------------------------------------------------------
create function private.circle_paused(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.care_circle_pauses where patient_id = p_patient and paused_until > now()) $$;
revoke all on function private.circle_paused(uuid) from public, anon, authenticated;

create function private.circle_alerts_paused(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.care_circle_pauses where patient_id = p_patient and paused_until > now() and pause_alerts) $$;
revoke all on function private.circle_alerts_paused(uuid) from public, anon, authenticated;

-- A request sent while check-in requests were paused is never shown afterwards, even if the pause ends inside the visible window.
create function private.circle_page_visible(p_patient uuid, p_sent timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$ select not exists (select 1 from public.care_circle_pauses where patient_id = p_patient and pause_alerts and p_sent >= paused_from and p_sent < paused_until) $$;
revoke all on function private.circle_page_visible(uuid, timestamptz) from public, anon, authenticated;

-- The one gate (S29), now pause-aware: paying is not sharing so it ignores a pause; a check-in request pauses only if the patient
-- chose that; everything else (the view, the lists) pauses.
create or replace function private.circle_member_for(p_patient uuid, p_permission text default null) returns public.care_circle_members
language sql stable security definer set search_path = ''
as $$
  select m.* from public.care_circle_members m
    join public.profiles s on s.id = m.supporter_id and s.is_active
   where m.patient_id = p_patient and m.supporter_id = (select auth.uid())
     and m.state = 'active' and m.expires_at > now()
     and (p_permission is null or p_permission = any (m.permissions))
     and case coalesce(p_permission, '')
           when 'pay_for_care' then true
           when 'red_alerts' then not private.circle_alerts_paused(m.patient_id)
           else not private.circle_paused(m.patient_id)
         end
   limit 1
$$;

create function public.pause_care_circle(p_pause_alerts boolean default false) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  pr public.profiles%rowtype;
  v_until timestamptz;
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active
     and receives_care and not coalesce(is_dependent_account, false);
  if not found then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  v_until := now() + make_interval(days => (private.circle_rules() ->> 'pause_days')::integer);
  insert into public.care_circle_pauses (patient_id, organisation_id, paused_from, paused_until, pause_alerts, ended_notice_sent, is_test)
  values (v_uid, pr.organisation_id, now(), v_until, coalesce(p_pause_alerts, false), false, coalesce(pr.is_test, false))
  on conflict (patient_id) do update
    set paused_from = now(), paused_until = excluded.paused_until, pause_alerts = excluded.pause_alerts, ended_notice_sent = false;
  return jsonb_build_object('paused_until', v_until, 'pause_alerts', coalesce(p_pause_alerts, false));
end $$;

-- Ends a pause early. No notice: the patient did it themselves.
create function public.resume_care_circle() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  update public.care_circle_pauses set paused_until = now(), ended_notice_sent = true
   where patient_id = (select auth.uid()) and paused_until > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Notice helper that is not de-duplicated by source row (the expiry notices repeat for a renewed expiry date)
-- ---------------------------------------------------------------------------
create function private.circle_notify_always(p_recipient uuid, p_org uuid, p_template text, p_source_table text, p_source uuid,
                                             p_channels text[], p_priority text) returns void
language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  foreach c in array p_channels loop
    insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class, priority, source_table, source_id)
    values (p_recipient, p_org, c::public.notification_channel, p_template, '{}'::jsonb, 'pending', 'non_clinical', p_priority::public.notification_priority, p_source_table, p_source);
  end loop;
end;
$$;
revoke all on function private.circle_notify_always(uuid, uuid, text, text, uuid, text[], text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Renew with one tap, and the lists the screens read
-- ---------------------------------------------------------------------------
-- Another default_grant_days from today, never shorter than the access already has (so pressing it twice changes nothing).
create function public.renew_care_circle_member(p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  v_days integer := (private.circle_rules() ->> 'default_grant_days')::integer;
begin
  update public.care_circle_members
     set expires_at = greatest(expires_at, least(now() + make_interval(days => v_days), now() + interval '1095 days'))
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now()
   returning * into m;
  if m.id is null then return jsonb_build_object('ok', false); end if;
  perform private.log_care_access(m.patient_id, 'permission_changed', 'care_circle', jsonb_build_object('renewed', true, 'by_patient', true), m.supporter_id);
  return jsonb_build_object('ok', true, 'expires_at', m.expires_at);
end $$;

create or replace function public.my_care_circle() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'members', coalesce((select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                'relationship', m.relationship, 'permissions', to_jsonb(m.permissions), 'expires_at', m.expires_at, 'since', m.created_at)
                order by m.created_at)
              from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
             where m.patient_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()), '[]'::jsonb),
    'invites', coalesce((select jsonb_agg(jsonb_build_object('invite_id', i.id, 'hint', i.invitee_hint, 'kind', i.invitee_kind,
                'relationship', i.relationship, 'permissions', to_jsonb(i.permissions), 'expires_at', i.expires_at) order by i.created_at)
              from public.care_circle_invites i
             where i.patient_id = (select auth.uid()) and i.state = 'pending' and i.expires_at > now()), '[]'::jsonb),
    'pause', (select jsonb_build_object('paused_until', p.paused_until, 'pause_alerts', p.pause_alerts)
                from public.care_circle_pauses p where p.patient_id = (select auth.uid()) and p.paused_until > now()),
    'pause_days', (private.circle_rules() ->> 'pause_days')::integer)
$$;

-- What a supporter sees in their list. A paused patient drops out, except for a supporter who can pay (paying is not sharing),
-- who sees the person with only that permission: nothing tells them why.
create or replace function public.my_supported_people() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', m.patient_id, 'member_id', m.id,
              'name', coalesce(nullif(btrim(p.full_name), ''), 'Someone'), 'relationship', m.relationship,
              'permissions', case when private.circle_paused(m.patient_id)
                                  then to_jsonb(array(select x from unnest(m.permissions) x
                                                       where x = 'pay_for_care' or (x = 'red_alerts' and not private.circle_alerts_paused(m.patient_id))))
                                  else to_jsonb(m.permissions) end,
              'expires_at', m.expires_at, 'alert_mode', m.alert_mode) order by p.full_name), '[]'::jsonb)
    from public.care_circle_members m join public.profiles p on p.id = m.patient_id and p.is_active
   where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now()
     and (not private.circle_paused(m.patient_id) or 'pay_for_care' = any (m.permissions)
          or ('red_alerts' = any (m.permissions) and not private.circle_alerts_paused(m.patient_id)))
$$;

create function public.set_circle_alert_mode(p_patient uuid, p_mode text) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if p_mode not in ('push_and_app', 'app_only') then raise exception 'circle_alert_mode_invalid' using errcode = '22023'; end if;
  update public.care_circle_members set alert_mode = p_mode
   where patient_id = p_patient and supporter_id = (select auth.uid()) and state = 'active' and expires_at > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---------------------------------------------------------------------------
-- 6. The view builder, shared by the supporter's page and the patient's preview
-- ---------------------------------------------------------------------------
-- One builder so the preview cannot drift from what a supporter really gets. It reads the patient's own record and logs nothing;
-- the caller decides who may call it and whether a look is recorded.
create function private.circle_view_blocks(p_patient uuid, p_permissions text[]) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_weeks integer := (private.circle_rules() ->> 'view_weeks')::integer;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  out jsonb := '{}'::jsonb;
  v_taken integer; v_due integer;
  v_bp jsonb; v_dir text; v_a numeric; v_b numeric;
  v_next timestamptz; v_missed integer;
begin
  if 'adherence_summary' = any (p_permissions) then
    select count(*) filter (where status in ('taken', 'delayed')), count(*) filter (where status in ('taken', 'delayed', 'missed', 'skipped'))
      into v_taken, v_due
      from public.medication_logs
     where patient_id = p_patient and scheduled_for_date between v_today - 6 and v_today;
    out := out || jsonb_build_object('adherence', jsonb_build_object('days', 7, 'taken', v_taken, 'due', v_due,
              'percent', case when v_due > 0 then round(100.0 * v_taken / v_due)::integer end));
  end if;

  if 'weekly_bp_trend' = any (p_permissions) then
    -- weekly averages only: no single reading, no time of day, no symptom, no note
    select coalesce(jsonb_agg(jsonb_build_object('week_start', w.wk, 'systolic', w.sys, 'diastolic', w.dia, 'readings', w.n) order by w.wk), '[]'::jsonb)
      into v_bp
      from (select (date_trunc('week', taken_at at time zone 'Africa/Lagos'))::date wk, round(avg(systolic))::integer sys,
                   round(avg(diastolic))::integer dia, count(*)::integer n
              from public.vitals_readings
             where patient_id = p_patient and vital_type = 'blood_pressure' and systolic is not null and diastolic is not null
               and coalesce(validation_status::text, '') <> 'rejected'
               and taken_at >= (v_today - (v_weeks * 7))::timestamp at time zone 'Africa/Lagos'
             group by 1) w;
    select (v_bp -> -1 ->> 'systolic')::numeric, (v_bp -> -2 ->> 'systolic')::numeric into v_a, v_b;
    v_dir := case when jsonb_array_length(v_bp) < 2 then null
                  when v_a - v_b >= 5 then 'higher' when v_a - v_b <= -5 then 'lower' else 'steady' end;
    out := out || jsonb_build_object('bp_trend', jsonb_build_object('weeks', v_bp, 'direction', v_dir));
  end if;

  if 'appointments' = any (p_permissions) then
    select min(scheduled_for) filter (where status in ('scheduled', 'booked', 'confirmed') and scheduled_for > now()),
           count(*) filter (where status = 'no_show' and scheduled_for > now() - interval '30 days')
      into v_next, v_missed
      from public.appointments where patient_id = p_patient;
    out := out || jsonb_build_object('appointments', jsonb_build_object('next_at', v_next, 'missed_30d', v_missed));
  end if;

  if 'pay_for_care' = any (p_permissions) then
    out := out || jsonb_build_object('can_pay', true);
  end if;
  return out;
end $$;
revoke all on function private.circle_view_blocks(uuid, text[]) from public, anon, authenticated;

create or replace function public.circle_supporter_view(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  m public.care_circle_members%rowtype;
  v_name text;
  out jsonb;
begin
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = p_patient;
  m := private.circle_member_for(p_patient);
  if m.id is null then
    -- a paused circle: only the right to pay is left, and nothing says why. Anyone else gets the same "not found" as before.
    m := private.circle_member_for(p_patient, 'pay_for_care');
    if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                              'permissions', to_jsonb(array['pay_for_care']), 'shared_until', m.expires_at, 'can_pay', true);
  end if;
  out := jsonb_build_object('patient_id', p_patient, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at)
         || private.circle_view_blocks(p_patient, m.permissions);
  perform private.log_care_access(p_patient, 'record_viewed', 'care_circle', jsonb_build_object('blocks', to_jsonb(m.permissions)), m.supporter_id);
  return out;
end $$;

-- "See what my supporter sees", for someone already in the circle. Patient only; not a look, so nothing is logged.
create function public.circle_preview_member(p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare m public.care_circle_members%rowtype; v_name text;
begin
  select * into m from public.care_circle_members
   where id = p_member and patient_id = (select auth.uid()) and state = 'active' and expires_at > now();
  if not found then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = m.patient_id;
  return jsonb_build_object('patient_id', m.patient_id, 'name', v_name, 'relationship', m.relationship,
                            'permissions', to_jsonb(m.permissions), 'shared_until', m.expires_at, 'preview', true,
                            'alert_sample', 'red_alerts' = any (m.permissions))
         || private.circle_view_blocks(m.patient_id, m.permissions);
end $$;

-- The same, before anyone is invited: what these choices would show.
create function public.circle_preview_permissions(p_permissions text[], p_relationship text default '') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); v_name text;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid and role = 'patient' and is_active
                                  and receives_care and not coalesce(is_dependent_account, false)) then
    raise exception 'circle_not_authorised' using errcode = '42501';
  end if;
  if not private.circle_permissions_valid(p_permissions) then raise exception 'invite_permissions_invalid' using errcode = '22023'; end if;
  select coalesce(nullif(btrim(full_name), ''), 'Someone') into v_name from public.profiles where id = v_uid;
  return jsonb_build_object('patient_id', v_uid, 'name', v_name, 'relationship', left(btrim(coalesce(p_relationship, '')), 40),
                            'permissions', to_jsonb(p_permissions), 'shared_until', null, 'preview', true,
                            'alert_sample', 'red_alerts' = any (p_permissions))
         || private.circle_view_blocks(v_uid, p_permissions);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Alerts: pause, alert mode, and "I called them"
-- ---------------------------------------------------------------------------
create or replace function private.notify_circle_red_alert() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare r record;
begin
  if new.parent_page_id is not null then return new; end if;
  begin
    -- the patient paused check-in requests: nobody in the circle is asked. Their own care team's escalation is a different
    -- path and is not touched here.
    if private.circle_alerts_paused(new.patient_id) then return new; end if;
    for r in
      select m.supporter_id, m.alert_mode from public.care_circle_members m join public.profiles s on s.id = m.supporter_id and s.is_active
       where m.patient_id = new.patient_id and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
         and s.is_test = new.is_test
    loop
      begin
        perform private.circle_notify(r.supporter_id, new.organisation_id, 'circle_check_in', 'pages', new.id,
                                      case when r.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'critical', new.is_test);
      exception when others then
        begin
          perform private.page_incident(new.organisation_id, 'circle_alert_failed:' || new.id || ':' || r.supporter_id, 'A Care Circle alert could not be sent',
            'The red event page ' || new.id || ' was created, but telling one member of the patient''s Care Circle failed: ' || sqlerrm);
        exception when others then
          raise warning 'circle alert and its incident both failed for page %: %', new.id, sqlerrm;
        end;
      end;
    end loop;
  exception when others then
    begin
      perform private.page_incident(new.organisation_id, 'circle_alert_failed:' || new.id, 'A Care Circle alert could not be sent',
        'The red event page ' || new.id || ' was created, but telling the patient''s Care Circle failed: ' || sqlerrm);
    exception when others then
      raise warning 'circle alert and its incident both failed for page %: %', new.id, sqlerrm;
    end;
  end;
  return new;
end $$;

-- A supporter's open requests: one row per person (however many requests are open), called only when every open request is called.
create or replace function public.circle_open_alerts() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', x.patient_id, 'name', x.name, 'since', x.since, 'called', x.called) order by x.since desc), '[]'::jsonb)
    from (select m.patient_id, coalesce(nullif(btrim(p.full_name), ''), 'Someone') as name, max(pg.sent_at) as since,
                 bool_and(exists (select 1 from public.care_circle_alert_acks a where a.page_id = pg.id and a.supporter_id = m.supporter_id)) as called
            from public.care_circle_members m
            join public.profiles p on p.id = m.patient_id
            join public.pages pg on pg.patient_id = m.patient_id and pg.parent_page_id is null and pg.closed_at is null
                                and pg.sent_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
           where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
             and not private.circle_alerts_paused(m.patient_id) and private.circle_page_visible(m.patient_id, pg.sent_at)
           group by m.patient_id, p.full_name) x
$$;

-- "I called them": one status, no text. Marks the newest open request for that person. Replaying changes nothing.
create function public.circle_ack_alert(p_patient uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare m public.care_circle_members%rowtype; n integer;
begin
  m := private.circle_member_for(p_patient, 'red_alerts');
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  -- every open request for that person the supporter can see: the card they tapped stands for all of them
  insert into public.care_circle_alert_acks (page_id, supporter_id, patient_id, organisation_id)
  select pg.id, m.supporter_id, p_patient, m.organisation_id from public.pages pg
   where pg.patient_id = p_patient and pg.parent_page_id is null and pg.closed_at is null
     and pg.sent_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
     and private.circle_page_visible(p_patient, pg.sent_at)
  on conflict (page_id, supporter_id) do nothing;
  get diagnostics n = row_count;
  -- true when there was something open to mark, or it was already marked
  return n > 0 or exists (select 1 from public.care_circle_alert_acks a where a.supporter_id = m.supporter_id and a.patient_id = p_patient
                            and a.acked_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer));
end $$;

-- ---------------------------------------------------------------------------
-- 8. Gifts: only the full yearly Membership can be paid for someone else
-- ---------------------------------------------------------------------------
create function private.gift_item_allowed(p_kind text, p_duration_days integer) returns boolean
language sql immutable set search_path = ''
as $$ select p_kind = 'membership' and coalesce(p_duration_days, 0) >= 365 $$;
revoke all on function private.gift_item_allowed(text, integer) from public, anon, authenticated;

-- S29's create_order with one added check (marked). Everything else is as it was.
create or replace function public.create_order(p_code text, p_client_key uuid default null, p_beneficiary uuid default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_ben uuid;
  pr public.profiles%rowtype;
  bp public.profiles%rowtype;
  it public.catalog_items%rowtype;
  px public.prices%rowtype;
  o public.orders%rowtype;
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into pr from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  v_ben := coalesce(p_beneficiary, v_uid);
  if v_ben = v_uid and not pr.receives_care then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  if v_ben <> v_uid then
    select * into bp from public.profiles where id = v_ben and role = 'patient' and is_active;
    if not found or bp.organisation_id is distinct from pr.organisation_id or bp.is_test is distinct from pr.is_test
       or not (private.circle_can_pay_for(v_ben)
               or exists (select 1 from public.profile_access pa where pa.grantee_user_id = v_uid and pa.profile_id = v_ben)) then
      raise exception 'order_beneficiary_not_allowed' using errcode = '42501';
    end if;
  end if;

  if p_client_key is not null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    if found then
      return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
    end if;
  end if;

  if not coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false) then
    raise exception 'checkout_not_open' using errcode = 'P0001';
  end if;
  select * into it from public.catalog_items where organisation_id = pr.organisation_id and code = p_code;
  if not found or not it.active then raise exception 'item_not_available' using errcode = 'P0001'; end if;
  -- S29c: for someone else, only the full yearly Membership (founder 2026-10-06). Nothing smaller, nothing per item.
  if v_ben <> v_uid and not private.gift_item_allowed(it.kind::text, it.duration_days) then
    raise exception 'gift_item_not_allowed' using errcode = 'P0001';
  end if;
  px := private.current_price(it.id);
  if px.id is null then raise exception 'item_not_available' using errcode = 'P0001'; end if;

  if it.kind = 'membership' and exists (
       select 1 from public.patient_memberships m where m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())) then
    raise exception 'already_member' using errcode = 'P0001';
  end if;
  if it.grants_lead and not exists (select 1 from private.lead_candidates(v_ben, '{}', true)) then
    raise exception 'no_capacity' using errcode = 'P0001';
  end if;
  if (select count(*) from public.orders where buyer_profile_id = v_uid and state = 'created' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'too_many_open_orders' using errcode = 'P0001';
  end if;

  insert into public.orders (organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, components,
                             paystack_reference, client_key, is_test)
  values (pr.organisation_id, v_uid, v_ben, it.id, px.id, px.amount_kobo, px.components,
          'tho_' || replace(gen_random_uuid()::text, '-', ''), p_client_key, coalesce(pr.is_test, false))
  on conflict (buyer_profile_id, client_key) where client_key is not null do nothing
  returning * into o;
  if o.id is null then
    select * into o from public.orders where buyer_profile_id = v_uid and client_key = p_client_key;
    return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', o.checkout_url, 'replay', true);
  end if;
  return jsonb_build_object('order_id', o.id, 'reference', o.paystack_reference, 'amount_kobo', o.amount_kobo, 'state', o.state, 'checkout_url', null, 'replay', false);
end $$;

-- ---------------------------------------------------------------------------
-- 9. The hourly sweep: two expiry notices (each remembered against the expiry date it was for) and "your pause has ended"
-- ---------------------------------------------------------------------------
create or replace function private.expire_care_circle() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; n integer := 0;
  v_first integer := (private.circle_rules() ->> 'expiry_notice_days')::integer;
  v_final integer := (private.circle_rules() ->> 'expiry_final_notice_days')::integer;
begin
  update public.care_circle_invites set state = 'expired' where state = 'pending' and expires_at <= now();
  -- the patient is told, the supporter is not, so a safety alert does not stop in silence; a renewal changes expires_at, which
  -- makes both notices due again for the new date
  for r in select m.id, m.patient_id, m.organisation_id from public.care_circle_members m
            where m.state = 'active' and m.expires_at > now() + make_interval(days => v_final)
              and m.expires_at <= now() + make_interval(days => v_first) and m.notice_first_for is distinct from m.expires_at loop
    perform private.circle_notify_always(r.patient_id, r.organisation_id, 'circle_expiring', 'care_circle_members', r.id, array['in_app'], 'routine');
    update public.care_circle_members set notice_first_for = expires_at where id = r.id;
  end loop;
  for r in select m.id, m.patient_id, m.organisation_id from public.care_circle_members m
            where m.state = 'active' and m.expires_at > now() and m.expires_at <= now() + make_interval(days => v_final)
              and m.notice_final_for is distinct from m.expires_at loop
    perform private.circle_notify_always(r.patient_id, r.organisation_id, 'circle_expiring_soon', 'care_circle_members', r.id, array['in_app'], 'routine');
    update public.care_circle_members set notice_final_for = expires_at, notice_first_for = expires_at where id = r.id;
  end loop;
  for r in update public.care_circle_members set state = 'expired' where state = 'active' and expires_at <= now()
           returning patient_id, supporter_id loop
    perform private.log_care_access(r.patient_id, 'expired', 'care_circle', '{}'::jsonb, r.supporter_id);
    n := n + 1;
  end loop;
  -- a pause ends by itself, and sharing starts again: the patient is told so that it never resumes unnoticed
  for r in select patient_id, organisation_id from public.care_circle_pauses where paused_until <= now() and not ended_notice_sent loop
    perform private.circle_notify_always(r.patient_id, r.organisation_id, 'circle_pause_ended', 'care_circle_pauses', r.patient_id, array['in_app'], 'routine');
    update public.care_circle_pauses set ended_notice_sent = true where patient_id = r.patient_id;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 10. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.pause_care_circle(boolean) from public, anon;
revoke all on function public.resume_care_circle() from public, anon;
revoke all on function public.renew_care_circle_member(uuid) from public, anon;
revoke all on function public.set_circle_alert_mode(uuid, text) from public, anon;
revoke all on function public.circle_preview_member(uuid) from public, anon;
revoke all on function public.circle_preview_permissions(text[], text) from public, anon;
revoke all on function public.circle_ack_alert(uuid) from public, anon;
grant execute on function public.pause_care_circle(boolean) to authenticated;
grant execute on function public.resume_care_circle() to authenticated;
grant execute on function public.renew_care_circle_member(uuid) to authenticated;
grant execute on function public.set_circle_alert_mode(uuid, text) to authenticated;
grant execute on function public.circle_preview_member(uuid) to authenticated;
grant execute on function public.circle_preview_permissions(text[], text) to authenticated;
grant execute on function public.circle_ack_alert(uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.pause_care_circle(boolean)', 'public.resume_care_circle()', 'public.renew_care_circle_member(uuid)',
                           'public.set_circle_alert_mode(uuid, text)', 'public.circle_preview_member(uuid)',
                           'public.circle_preview_permissions(text[], text)', 'public.circle_ack_alert(uuid)',
                           'public.circle_supporter_view(uuid)', 'public.circle_open_alerts()', 'public.my_care_circle()',
                           'public.my_supported_people()', 'public.create_order(text, uuid, uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
  end loop;
  foreach f in array array['private.circle_paused(uuid)', 'private.circle_alerts_paused(uuid)', 'private.circle_view_blocks(uuid, text[])',
                           'private.circle_notify_always(uuid, uuid, text, text, uuid, text[], text)', 'private.gift_item_allowed(text, integer)', 'private.circle_page_visible(uuid, timestamptz)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'a private helper is callable: %', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.care_circle_pauses', 'SELECT') or has_table_privilege('anon', 'public.care_circle_alert_acks', 'SELECT') then
    raise exception 'anon can read a Care Circle table';
  end if;
  if (select count(*) from public.care_circle_config where is_active) <> 1 then raise exception 'exactly one care circle config must be active'; end if;
end $$;

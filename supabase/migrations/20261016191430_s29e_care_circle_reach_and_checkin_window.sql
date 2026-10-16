-- S29e: Care Circle reach and the patient-first check-in window (docs/research/S26-S30-competitor-review-and-build-plan.md, S29d).
--
--   1. Expiry warnings (14 and 3 days before a supporter's access ends) already exist from S29c, once per step, patient only, and
--      renewal is only the patient's tap. What changes here: the warnings travel by the patient's own reminder channel
--      (private.patient_reminder_channel(): email if preferred, else push if subscribed, else the in-app inbox) in addition to the
--      in-app inbox, which is always written. The once-per-step bookkeeping (notice_first_for, notice_final_for) is unchanged.
--   2. Supporters abroad (OQ-220), the explicit cross-organisation rule. A supporter whose organisation differs from the patient's may
--      join only if their account is a supporter-only account (receives_care = false), and a cross-organisation member can never
--      hold pay_for_care (money across organisations is a finance decision, and order_beneficiary_check already refuses it). The same
--      function builds the supporter's blocks, so INV-07 (no readings or conditions in an alert) is untouched.
--   3. The patient-first window for NON-EMERGENCY check-in requests (Life360 pattern), behind the go-live module
--      care_circle_checkin_window, which is OFF. A supporter who holds red_alerts asks for a check-in; the patient alone is told
--      first and has checkin_window_minutes (PROPOSED, 5) to answer; if they do not, the circle is told with a neutral notice.
--      Red events are a different path and are NOT touched: private.notify_circle_red_alert is not replaced here and nothing in this
--      migration reads or writes the window from it, so a red event reaches supporters at once, with the module on or off.
--
-- Live check (2026-10-16): private.notify_circle_red_alert, circle_open_alerts, expire_care_circle and patient_reminder_channel were
-- read with pg_get_functiondef before this was written. The cross-organisation functions are restated from the S29 migration (no later
-- migration redefines them).

-- ---------------------------------------------------------------------------
-- 1. Config version 4 (PROPOSED, Founder owner). Versions 1 to 3 stay as history.
-- ---------------------------------------------------------------------------
create or replace function private.care_circle_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['invite_ttl_hours', 'default_grant_days', 'max_invites_per_day', 'max_members', 'max_attempts', 'view_weeks',
                           'alert_visible_hours', 'expiry_notice_days', 'expiry_final_notice_days', 'pause_days', 'gift_decide_days',
                           'gift_remind_days', 'checkin_window_minutes', 'checkin_max_per_day'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'default_grant_days')::integer <= 1095 and (r ->> 'invite_ttl_hours')::integer <= 720
     and (r ->> 'expiry_final_notice_days')::integer < (r ->> 'expiry_notice_days')::integer
     and (r ->> 'pause_days')::integer <= 30
     and (r ->> 'gift_remind_days')::integer < (r ->> 'gift_decide_days')::integer
     and (r ->> 'checkin_window_minutes')::integer <= 60;
exception when others then
  return false;
end;
$$;

alter table public.care_circle_config drop constraint care_circle_config_rules_valid;
alter table public.care_circle_config add constraint care_circle_config_rules_valid check (version < 4 or private.care_circle_rules_valid(rules));
update public.care_circle_config set is_active = false where is_active;
-- care-circle-rules-v4-begin
insert into public.care_circle_config (version, is_active, effective_from, rules) values (4, true, '2026-10-16', $json$
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
  "gift_decide_days": 14,
  "gift_remind_days": 7,
  "checkin_window_minutes": 5,
  "checkin_max_per_day": 3
}
$json$::jsonb);
-- care-circle-rules-v4-end

-- ---------------------------------------------------------------------------
-- 2. Expiry warnings travel by the patient's own reminder channel (in-app is always written)
-- ---------------------------------------------------------------------------
create or replace function private.expire_care_circle() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record; n integer := 0;
  v_first integer := (private.circle_rules() ->> 'expiry_notice_days')::integer;
  v_final integer := (private.circle_rules() ->> 'expiry_final_notice_days')::integer;
  v_channels text[];
begin
  update public.care_circle_invites set state = 'expired' where state = 'pending' and expires_at <= now();
  -- the patient is told, the supporter is not, so a safety alert does not stop in silence; a renewal changes expires_at, which
  -- makes both notices due again for the new date
  for r in select m.id, m.patient_id, m.organisation_id from public.care_circle_members m
            where m.state = 'active' and m.expires_at > now() + make_interval(days => v_final)
              and m.expires_at <= now() + make_interval(days => v_first) and m.notice_first_for is distinct from m.expires_at loop
    begin
      v_channels := array(select distinct c from unnest(array['in_app', private.patient_reminder_channel(r.patient_id)::text]) c);
      perform private.circle_notify_always(r.patient_id, r.organisation_id, 'circle_expiring', 'care_circle_members', r.id, v_channels, 'routine');
      update public.care_circle_members set notice_first_for = expires_at where id = r.id;
    exception when others then
      -- one failing row must not stop the sweep (expiry, the final notice and the pause notices for everyone else); it stays due and
      -- is tried again next hour, and an open incident says so
      perform private.page_incident(r.organisation_id, 'circle_expiry_notice_failed:' || r.id, 'A Care Circle expiry warning could not be sent',
        'The warning that a supporter''s access is ending (' || r.id || ') failed: ' || sqlerrm);
    end;
  end loop;
  for r in select m.id, m.patient_id, m.organisation_id from public.care_circle_members m
            where m.state = 'active' and m.expires_at > now() and m.expires_at <= now() + make_interval(days => v_final)
              and m.notice_final_for is distinct from m.expires_at loop
    begin
      v_channels := array(select distinct c from unnest(array['in_app', private.patient_reminder_channel(r.patient_id)::text]) c);
      perform private.circle_notify_always(r.patient_id, r.organisation_id, 'circle_expiring_soon', 'care_circle_members', r.id, v_channels, 'routine');
      update public.care_circle_members set notice_final_for = expires_at, notice_first_for = expires_at where id = r.id;
    exception when others then
      perform private.page_incident(r.organisation_id, 'circle_expiry_notice_failed:' || r.id, 'A Care Circle expiry warning could not be sent',
        'The final warning that a supporter''s access is ending (' || r.id || ') failed: ' || sqlerrm);
    end;
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
revoke all on function private.expire_care_circle() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Supporters abroad: the explicit cross-organisation rule
-- ---------------------------------------------------------------------------
-- Same-organisation behaviour is unchanged. A supporter in ANOTHER organisation is admitted only as a supporter-only account
-- (receives_care = false: no patient record of their own on this platform to bridge into), with the invite's permissions minus
-- pay_for_care, and only if at least one view permission remains. Every other failure is the same silent {ok: false} as before.
create or replace function private.circle_invite_for_caller(p_token text, p_count_attempt boolean) returns public.care_circle_invites
language plpgsql security definer set search_path = ''
as $$
declare
  i public.care_circle_invites%rowtype;
  v_uid uuid := (select auth.uid());
  cfg jsonb := private.circle_rules();
  me public.profiles%rowtype;
begin
  if v_uid is null or p_token is null or char_length(p_token) not between 20 and 128 then return null; end if;
  select * into i from public.care_circle_invites where token_hash = private.circle_hash(p_token) for update;
  if not found or i.state <> 'pending' or i.expires_at <= now() or i.attempts >= (cfg ->> 'max_attempts')::integer then return null; end if;
  select * into me from public.profiles where id = v_uid and role = 'patient' and is_active;
  if not found or v_uid = i.patient_id or me.is_test is distinct from i.is_test then return null; end if;
  if me.organisation_id is distinct from i.organisation_id then
    if me.receives_care is not false then return null; end if;
    if cardinality(array_remove(i.permissions, 'pay_for_care')) = 0 then return null; end if;
  end if;
  if not private.circle_caller_owns_contact(i.invitee_kind, i.invitee_hash) then
    if p_count_attempt then update public.care_circle_invites set attempts = attempts + 1 where id = i.id; end if;
    return null;
  end if;
  return i;
end $$;
revoke all on function private.circle_invite_for_caller(text, boolean) from public, anon, authenticated;

-- The preview tells the supporter exactly what they will get: for a supporter in another organisation the payment permission is not
-- on offer, and the screen says so.
create or replace function public.preview_care_circle_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare i public.care_circle_invites%rowtype; v_name text; v_cross boolean;
begin
  i := private.circle_invite_for_caller(p_token, true);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  select split_part(btrim(full_name), ' ', 1) into v_name from public.profiles where id = i.patient_id;
  v_cross := (select organisation_id is distinct from i.organisation_id from public.profiles where id = (select auth.uid()));
  return jsonb_build_object('ok', true, 'inviter_first_name', coalesce(nullif(v_name, ''), 'Someone'), 'relationship', i.relationship,
                            'permissions', to_jsonb(case when v_cross then array_remove(i.permissions, 'pay_for_care') else i.permissions end),
                            'grant_days', i.grant_days, 'expires_at', i.expires_at, 'cross_organisation', v_cross);
end $$;
revoke all on function public.preview_care_circle_invite(text) from public, anon;
grant execute on function public.preview_care_circle_invite(text) to authenticated;

-- The access log must record what was STORED. The trigger below can withhold pay_for_care, so both writers are restated to log the
-- row they wrote (m.permissions), not the permissions they were given.
create or replace function public.accept_care_circle_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  i public.care_circle_invites%rowtype;
  v_uid uuid := (select auth.uid());
  cfg jsonb := private.circle_rules();
  m public.care_circle_members%rowtype;
  v_until timestamptz;
begin
  i := private.circle_invite_for_caller(p_token, true);
  if i.id is null then return jsonb_build_object('ok', false); end if;
  -- the cap limits NEW members; someone already in the circle may take a changed invite even when it is full
  if not exists (select 1 from public.care_circle_members where patient_id = i.patient_id and supporter_id = v_uid and state = 'active')
     and (select count(*) from public.care_circle_members where patient_id = i.patient_id and state = 'active' and expires_at > now())
       >= (cfg ->> 'max_members')::integer then
    return jsonb_build_object('ok', false);
  end if;
  v_until := now() + make_interval(days => i.grant_days);

  -- one atomic statement: someone already in the circle is updated, never doubled, and two invites accepted at once cannot collide
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, invite_id, is_test)
  values (i.organisation_id, i.patient_id, v_uid, i.relationship, i.permissions, v_until, i.id, i.is_test)
  on conflict (patient_id, supporter_id) where state = 'active'
  do update set relationship = excluded.relationship, permissions = excluded.permissions, expires_at = excluded.expires_at, invite_id = excluded.invite_id
  returning * into m;

  update public.care_circle_invites set state = 'accepted', accepted_by = v_uid, accepted_at = now() where id = i.id;
  perform private.log_care_access(i.patient_id, 'granted', 'care_circle', jsonb_build_object('permissions', to_jsonb(m.permissions)), v_uid);
  perform private.circle_notify(i.patient_id, i.organisation_id, 'circle_joined', 'care_circle_members', m.id, array['in_app'], 'routine', i.is_test);
  return jsonb_build_object('ok', true, 'patient_id', i.patient_id, 'member_id', m.id);
end $$;
revoke all on function public.accept_care_circle_invite(text) from public, anon;
grant execute on function public.accept_care_circle_invite(text) to authenticated;

create or replace function public.update_care_circle_member(p_member uuid, p_permissions text[], p_expires_at timestamptz default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.care_circle_members%rowtype;
begin
  if not private.circle_permissions_valid(p_permissions) then raise exception 'invite_permissions_invalid' using errcode = '22023'; end if;
  if p_expires_at is not null and (p_expires_at <= now() or p_expires_at > now() + interval '1095 days') then
    raise exception 'invite_days_invalid' using errcode = '22023';
  end if;
  update public.care_circle_members
     set permissions = p_permissions, expires_at = coalesce(p_expires_at, expires_at)
   where id = p_member and patient_id = v_uid and state = 'active' and expires_at > now()
   returning * into m;
  if m.id is null then return false; end if;
  perform private.log_care_access(m.patient_id, 'permission_changed', 'care_circle', jsonb_build_object('permissions', to_jsonb(m.permissions), 'by_patient', true), m.supporter_id);
  return true;
end $$;
revoke all on function public.update_care_circle_member(uuid, text[], timestamptz) from public, anon;
grant execute on function public.update_care_circle_member(uuid, text[], timestamptz) to authenticated;

-- The membership row is where the rule is enforced for every path (accept, edit, renew): a member in another organisation can never
-- hold pay_for_care, and a row left with no permission at all is refused.
create or replace function private.circle_members_cross_org_permissions() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if exists (select 1 from public.profiles s where s.id = new.supporter_id and s.organisation_id is distinct from new.organisation_id) then
    new.permissions := array_remove(new.permissions, 'pay_for_care');
    if cardinality(new.permissions) = 0 then
      raise exception 'circle_cross_org_needs_a_view_permission' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.circle_members_cross_org_permissions() from public, anon, authenticated;
create trigger care_circle_members_cross_org_permissions
  before insert or update of permissions, supporter_id on public.care_circle_members
  for each row execute function private.circle_members_cross_org_permissions();

-- ---------------------------------------------------------------------------
-- 4. The patient-first check-in window (NON-EMERGENCY only; module OFF)
-- ---------------------------------------------------------------------------
insert into public.platform_modules (key, label, description)
values ('care_circle_checkin_window', 'Care Circle patient-first check-in window',
        'A supporter''s check-in request goes to the patient first, who has a short window to answer before the circle is told. Never applies to a red event, which alerts supporters at once. OFF until the Chief Medical Officer has ruled (OQ-700).')
on conflict (key) do nothing;

create table public.care_circle_check_ins (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  patient_id uuid not null references public.profiles (id) on delete cascade,
  requested_by uuid not null references public.profiles (id) on delete cascade,
  state text not null default 'waiting' check (state in ('waiting', 'answered', 'escalated', 'failed')),
  attempts integer not null default 0,
  requested_at timestamptz not null default now(),
  window_ends_at timestamptz not null,
  resolved_at timestamptz,
  is_test boolean not null default false,
  constraint care_circle_check_ins_resolved_matches_state check ((state = 'waiting') = (resolved_at is null))
);
create unique index care_circle_check_ins_one_waiting on public.care_circle_check_ins (patient_id) where state = 'waiting';
create index care_circle_check_ins_due on public.care_circle_check_ins (window_ends_at) where state = 'waiting';
create index care_circle_check_ins_by_requester on public.care_circle_check_ins (requested_by, patient_id, requested_at desc);
alter table public.care_circle_check_ins enable row level security;
-- No direct access at all: the patient must not learn WHICH supporter asked (the notice is neutral), and a supporter reads only their
-- own request through circle_check_in_status. Every read and write goes through the functions below.
revoke all on public.care_circle_check_ins from anon, authenticated, public;

create function public.request_circle_check_in(p_patient uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  m public.care_circle_members%rowtype;
  cfg jsonb := private.circle_rules();
  v_id uuid;
  v_ends timestamptz;
  v_channels text[];
begin
  if v_uid is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  if not private.module_enabled('care_circle_checkin_window') then
    raise exception 'circle_checkin_unavailable' using errcode = 'P0001';
  end if;
  -- the one gate: an active, unexpired member holding red_alerts, with check-in requests not paused by the patient
  m := private.circle_member_for(p_patient, 'red_alerts');
  if m.id is null then raise exception 'circle_not_found' using errcode = 'P0002'; end if;
  if (select count(*) from public.care_circle_check_ins where requested_by = v_uid and patient_id = p_patient and requested_at > now() - interval '1 day')
       >= (cfg ->> 'checkin_max_per_day')::integer then
    return jsonb_build_object('ok', false, 'reason', 'limit');
  end if;
  v_ends := now() + make_interval(mins => (cfg ->> 'checkin_window_minutes')::integer);
  insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, window_ends_at, is_test)
  values (m.organisation_id, p_patient, v_uid, v_ends, m.is_test)
  on conflict (patient_id) where state = 'waiting' do nothing
  returning id into v_id;
  if v_id is null then return jsonb_build_object('ok', false, 'reason', 'already_waiting'); end if;
  -- only the patient is told, neutrally: no name, no reading, nothing about who asked
  v_channels := array(select distinct c from unnest(array['in_app', private.patient_reminder_channel(p_patient)::text]) c);
  perform private.circle_notify_always(p_patient, m.organisation_id, 'circle_check_in_asked', 'care_circle_check_ins', v_id, v_channels, 'critical');
  return jsonb_build_object('ok', true, 'window_ends_at', v_ends);
end $$;

-- The patient's "I am fine". Nobody else is told: the request simply ends.
create function public.respond_to_circle_check_in() returns boolean
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if (select auth.uid()) is null then raise exception 'circle_not_authorised' using errcode = '42501'; end if;
  update public.care_circle_check_ins set state = 'answered', resolved_at = now()
   where patient_id = (select auth.uid()) and state = 'waiting';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- A supporter reads only their own latest request about that person: its state and when the window ends, nothing else.
create function public.circle_check_in_status(p_patient uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select to_jsonb(x) from (
    select c.state, c.requested_at, c.window_ends_at
      from public.care_circle_check_ins c
     where c.requested_by = (select auth.uid()) and c.patient_id = p_patient
     order by c.requested_at desc limit 1) x
$$;

-- Whether the window is open at all, so a screen shows the button only while the Chief Medical Officer's go-live is on.
create function public.circle_checkin_window_enabled() returns boolean
language sql stable security definer set search_path = ''
as $$ select (select auth.uid()) is not null and private.module_enabled('care_circle_checkin_window') $$;

-- The patient's own view: is a question waiting for them, and until when. Never says who asked.
create function public.circle_check_in_pending() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce((select jsonb_build_object('waiting', true, 'window_ends_at', c.window_ends_at)
                     from public.care_circle_check_ins c where c.patient_id = (select auth.uid()) and c.state = 'waiting'),
                  jsonb_build_object('waiting', false))
$$;

-- A supporter's list of people who did not answer a check-in lately, so the notice is actionable: the same name-only disclosure as a red
-- alert (no reading, no cause), only for members who hold red_alerts, only while check-in requests are not paused, for the same visible
-- window as a red alert.
create function public.circle_unanswered_check_ins() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('patient_id', x.patient_id, 'name', x.name, 'since', x.since) order by x.since desc), '[]'::jsonb)
    from (select m.patient_id, coalesce(nullif(btrim(p.full_name), ''), 'Someone') as name, max(c.resolved_at) as since
            from public.care_circle_members m
            join public.profiles p on p.id = m.patient_id
            join public.care_circle_check_ins c on c.patient_id = m.patient_id and c.state = 'escalated'
                                               and c.resolved_at > now() - make_interval(hours => (private.circle_rules() ->> 'alert_visible_hours')::integer)
           where m.supporter_id = (select auth.uid()) and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
             and not private.circle_alerts_paused(m.patient_id)
           group by m.patient_id, p.full_name) x
$$;

-- Escalation: a request nobody answered inside the window tells the circle, neutrally, like any other check-in request. A failure to
-- tell one member opens an incident and leaves the row waiting, so the next minute retries (the notice is de-duplicated per row); after
-- three tries the row is marked failed so it stops blocking new requests.
create function private.sweep_circle_check_ins() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; s record; n integer := 0;
begin
  for r in select * from public.care_circle_check_ins where state = 'waiting' and window_ends_at <= now() order by window_ends_at for update skip locked loop
    begin
      -- the patient paused check-in requests since asking: nobody is told, and the request ends
      if not private.circle_alerts_paused(r.patient_id) then
        for s in
          select m.supporter_id, m.alert_mode from public.care_circle_members m join public.profiles sp on sp.id = m.supporter_id and sp.is_active
           where m.patient_id = r.patient_id and m.state = 'active' and m.expires_at > now() and 'red_alerts' = any (m.permissions)
             and sp.is_test = r.is_test
        loop
          perform private.circle_notify(s.supporter_id, r.organisation_id, 'circle_check_in_unanswered', 'care_circle_check_ins', r.id,
                                        case when s.alert_mode = 'app_only' then array['in_app'] else array['in_app', 'push'] end, 'critical', r.is_test);
        end loop;
      end if;
      update public.care_circle_check_ins set state = 'escalated', resolved_at = now() where id = r.id;
      n := n + 1;
    exception when others then
      begin
        perform private.page_incident(r.organisation_id, 'circle_checkin_failed:' || r.id, 'A Care Circle check-in could not be passed on',
          'A check-in request (' || r.id || ') went unanswered, but telling the patient''s Care Circle failed: ' || sqlerrm);
      exception when others then
        raise warning 'circle check-in escalation and its incident both failed for %: %', r.id, sqlerrm;
      end;
      -- three tries, one a minute, then it stops blocking the patient: the row is marked failed (the incident stays open) so a new
      -- request is possible again and nothing retries for ever
      update public.care_circle_check_ins
         set attempts = attempts + 1,
             state = case when attempts + 1 >= 3 then 'failed' else state end,
             resolved_at = case when attempts + 1 >= 3 then now() else resolved_at end
       where id = r.id;
    end;
  end loop;
  return n;
end $$;
revoke all on function private.sweep_circle_check_ins() from public, anon, authenticated;
select cron.schedule('care-circle-checkin-sweep', '* * * * *', $$ select private.sweep_circle_check_ins(); $$);

-- ---------------------------------------------------------------------------
-- 5. Grants (anon has execute through PUBLIC, so it is revoked from public)
-- ---------------------------------------------------------------------------
revoke all on function public.request_circle_check_in(uuid) from public, anon;
revoke all on function public.respond_to_circle_check_in() from public, anon;
revoke all on function public.circle_check_in_status(uuid) from public, anon;
revoke all on function public.circle_checkin_window_enabled() from public, anon;
revoke all on function public.circle_check_in_pending() from public, anon;
revoke all on function public.circle_unanswered_check_ins() from public, anon;
grant execute on function public.circle_unanswered_check_ins() to authenticated;
grant execute on function public.circle_checkin_window_enabled() to authenticated;
grant execute on function public.circle_check_in_pending() to authenticated;
grant execute on function public.request_circle_check_in(uuid) to authenticated;
grant execute on function public.respond_to_circle_check_in() to authenticated;
grant execute on function public.circle_check_in_status(uuid) to authenticated;

do $$
declare f text;
begin
  foreach f in array array['public.request_circle_check_in(uuid)', 'public.respond_to_circle_check_in()', 'public.circle_check_in_status(uuid)', 'public.circle_checkin_window_enabled()', 'public.circle_check_in_pending()', 'public.circle_unanswered_check_ins()',
                           'public.preview_care_circle_invite(text)', 'private.sweep_circle_check_ins()', 'private.circle_members_cross_org_permissions()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'anon can execute %', f; end if;
  end loop;
  if has_table_privilege('authenticated', 'public.care_circle_check_ins', 'SELECT') or has_table_privilege('anon', 'public.care_circle_check_ins', 'SELECT') then
    raise exception 'care_circle_check_ins must have no direct access';
  end if;
  if exists (select 1 from public.platform_modules where key = 'care_circle_checkin_window' and is_enabled) then
    raise exception 'the check-in window must ship OFF';
  end if;
end $$;

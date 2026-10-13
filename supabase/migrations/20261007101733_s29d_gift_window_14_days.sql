-- S29d: an unanswered gifted Membership waits 14 days, not 30 (founder decision 2026-10-07, OQ-203 area), and the patient gets one
-- reminder on day 7 so a gift is not lost to a missed notice. Config version 3 (PROPOSED, Founder owner); versions 1 and 2 stay as history.
create or replace function private.care_circle_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  foreach k in array array['invite_ttl_hours', 'default_grant_days', 'max_invites_per_day', 'max_members', 'max_attempts', 'view_weeks',
                           'alert_visible_hours', 'expiry_notice_days', 'expiry_final_notice_days', 'pause_days', 'gift_decide_days',
                           'gift_remind_days'] loop
    if (r ->> k) is null or (r ->> k) !~ '^[0-9]{1,5}$' or (r ->> k)::integer < 1 then return false; end if;
  end loop;
  return (r ->> 'default_grant_days')::integer <= 1095 and (r ->> 'invite_ttl_hours')::integer <= 720
     and (r ->> 'expiry_final_notice_days')::integer < (r ->> 'expiry_notice_days')::integer
     and (r ->> 'pause_days')::integer <= 30
     and (r ->> 'gift_remind_days')::integer < (r ->> 'gift_decide_days')::integer;
exception when others then
  return false;
end;
$$;

-- Versions 1 and 2 have no gift_remind_days; they are history and keep the values they were active with, so the check now starts at 3.
alter table public.care_circle_config drop constraint care_circle_config_rules_valid;
alter table public.care_circle_config add constraint care_circle_config_rules_valid check (version < 3 or private.care_circle_rules_valid(rules));
update public.care_circle_config set is_active = false where is_active;
-- care-circle-rules-v3-begin
insert into public.care_circle_config (version, is_active, effective_from, rules) values (3, true, '2026-10-07', $json$
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
  "gift_remind_days": 7
}
$json$::jsonb);
-- care-circle-rules-v3-end

-- The sweep: decline what is past the window (as before), and remind once, on day gift_remind_days, about a gift still waiting.
-- The reminder reuses the "someone has paid for care for you" notice, de-duplicated per gift, so it is sent once.
create or replace function private.expire_pending_gifts() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select e.id, e.order_id, o.organisation_id from public.entitlements e join public.orders o on o.id = e.order_id
            where e.acceptance = 'pending' and e.state = 'active'
              and e.created_at < now() - make_interval(days => (private.circle_rules() ->> 'gift_decide_days')::integer) loop
    update public.entitlements set acceptance = 'declined', state = 'revoked', decided_at = now() where id = r.id;
    perform private.order_incident(r.organisation_id, 'order-gift-declined:' || r.order_id, 'A gifted order was not answered in time',
      'Order ' || r.order_id || ' was paid for by someone else and the patient did not answer in time. Refund the payer (nothing else was started).');
    n := n + 1;
  end loop;
  for r in select e.id, e.patient_id, e.organisation_id, e.is_test from public.entitlements e
            where e.acceptance = 'pending' and e.state = 'active'
              and e.created_at <= now() - make_interval(days => (private.circle_rules() ->> 'gift_remind_days')::integer) loop
    perform private.circle_notify(r.patient_id, r.organisation_id, 'circle_gift_waiting', 'entitlements', r.id, array['in_app'], 'routine', r.is_test);
  end loop;
  return n;
end $$;

do $$
begin
  if (select count(*) from public.care_circle_config where is_active) <> 1 then raise exception 'exactly one care circle config must be active'; end if;
  if has_function_privilege('anon', 'private.expire_pending_gifts()', 'EXECUTE') or has_function_privilege('authenticated', 'private.expire_pending_gifts()', 'EXECUTE') then
    raise exception 'the gift sweep is callable';
  end if;
end $$;

-- Health Communication Engine — marketing consent pathway (17.4: "Marketing:
-- Separate consent and communication pathway").
--
-- notification_broadcasts (20260716200000) is the only mechanism today that
-- can plausibly carry marketing-style content (an admin-authored
-- announcement fanned out to a whole patient cohort) — every other
-- notification is transactional/clinical/operational and must never be
-- gated by marketing consent. This adds an explicit is_marketing flag to a
-- broadcast and, only when set, excludes patients who have not opted in
-- (profiles.marketing_opt_in, default false — added by the companion
-- communication_preferences_columns migration).
--
-- private.broadcast_targets() gains a new p_marketing parameter, which
-- changes its signature (arg count), so the old 3-arg overload is dropped
-- explicitly rather than left as dead, confusing shadow-code. Partner rows
-- (pharmacy/specialist) are untouched by this — marketing_opt_in lives on
-- profiles, and B2B partner outreach is a different relationship the 17.4
-- consent rule was not written for.
--
-- public.admin_broadcast_audience_count() is deliberately left with its
-- existing signature/behaviour: it is a reachability preview (does this
-- person have an email or phone at all), not a final send count. A
-- marketing broadcast's preview may therefore show a slightly higher
-- number than actually gets enqueued once consent is applied at send time
-- — an honest, documented gap rather than a wider, unverified change to a
-- second call site.
alter table public.notification_broadcasts
  add column is_marketing boolean not null default false;

comment on column public.notification_broadcasts.is_marketing is
  'When true, admin_send_broadcast excludes any patient recipient with profiles.marketing_opt_in = false (17.4 separate marketing consent pathway). Partner recipients are unaffected.';

drop function if exists private.broadcast_targets(public.broadcast_audience, jsonb, uuid);

create or replace function private.broadcast_targets(
  p_audience public.broadcast_audience,
  p_filter   jsonb,
  p_admin_id uuid,
  p_marketing boolean default false
)
returns table (
  recipient_id    uuid,
  organisation_id uuid,
  email           text,
  phone           text,
  is_partner      boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.organisation_id, u.email, p.phone, false
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and p_audience in ('all_patients', 'patients_by_state', 'subscribers_by_plan')
    and ((p_filter->>'state') is null or p.state = (p_filter->>'state'))
    and (not p_marketing or p.marketing_opt_in)
    and (
      p_audience <> 'subscribers_by_plan'
      or exists (
        select 1
        from public.subscriptions s
        join public.subscription_plans pl on pl.id = s.plan_id
        where s.subscriber_id = p.id
          and s.status in ('active', 'trialing')
          and ((p_filter->>'plan_code') is null or pl.code = (p_filter->>'plan_code'))
      )
    )

  union all

  select p_admin_id, null::uuid, ph.contact_email, ph.contact_phone, true
  from public.pharmacy_partners ph
  where ph.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'pharmacy')
    )

  union all

  select p_admin_id, null::uuid, sp.contact_email, sp.contact_phone, true
  from public.specialist_providers sp
  where sp.is_active
    and (
      p_audience = 'all_partners'
      or (p_audience = 'partners_by_type' and (p_filter->>'partner_type') = 'specialist')
    );
$$;

comment on function private.broadcast_targets(public.broadcast_audience, jsonb, uuid, boolean) is
  'Audience resolver for notification_broadcasts. p_marketing=true excludes any patient recipient with marketing_opt_in=false (17.4); partner rows are never filtered by it. SECURITY DEFINER, admin-gated by every caller.';

-- Send path: pass the broadcast's own is_marketing flag through to the
-- resolver at both the enqueue step and the final recipient_count.
create or replace function public.admin_send_broadcast(p_broadcast_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_b     public.notification_broadcasts%rowtype;
  v_ch    public.notification_channel;
  v_count integer;
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into v_b from public.notification_broadcasts where id = p_broadcast_id;
  if not found then
    raise exception 'broadcast not found';
  end if;
  if v_b.status = 'sent' then
    raise exception 'broadcast already sent';
  end if;

  foreach v_ch in array v_b.channels loop
    if v_ch = 'email' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'email', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_email', t.email)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.email is not null;

    elsif v_ch = 'sms' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'sms', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body, 'to_phone', t.phone)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null;

    elsif v_ch = 'whatsapp' then
      insert into public.notifications
        (organisation_id, recipient_id, channel, status, template, payload)
      select t.organisation_id, t.recipient_id, 'whatsapp', 'pending', 'broadcast_announcement',
             jsonb_build_object('subject', v_b.title, 'body', v_b.body)
      from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
      where t.phone is not null and t.is_partner = false;
    end if;
  end loop;

  select count(*) into v_count
  from private.broadcast_targets(v_b.audience, v_b.audience_filter, v_b.created_by, v_b.is_marketing) t
  where t.email is not null or t.phone is not null;

  update public.notification_broadcasts
    set status = 'sent', recipient_count = v_count, sent_at = now()
  where id = p_broadcast_id;

  return v_count;
end;
$$;

revoke all on function public.admin_send_broadcast(uuid) from anon;
grant execute on function public.admin_send_broadcast(uuid) to authenticated;
revoke all on function private.broadcast_targets(public.broadcast_audience, jsonb, uuid, boolean) from public, anon;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_broadcasts' and column_name = 'is_marketing'
  ) then
    raise exception 'FAIL: notification_broadcasts.is_marketing was not added';
  end if;
end $$;

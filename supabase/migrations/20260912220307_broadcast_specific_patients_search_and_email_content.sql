-- Two founder-requested additions to the admin Broadcasts tool:
--
-- 1) Specific-patient targeting: an admin picks one or more named patients
--    (rather than a whole cohort) via admin_search_patients(), and
--    private.broadcast_targets() gains a 'specific_patients' leg reading
--    p_filter->'patient_ids' (a jsonb array of uuid strings). Added as its
--    own UNION ALL leg rather than folded into the existing
--    all_patients/patients_by_state/subscribers_by_plan leg, so that leg's
--    logic (including its marketing-consent gate) is untouched. A hand-picked
--    list is not the same relationship as a cohort marketing blast, so this
--    leg is deliberately NOT filtered by p_marketing/marketing_opt_in — same
--    precedent as the partner legs below it, which are also never marketing-
--    gated.
--
-- 2) admin_search_patients(p_query): the same admin-only patient lookup
--    analytics_patient_search already does (20260718210323), but that RPC is
--    gated on private.is_analyst() and search only full_name/phone/patient_
--    number — missing email. This one is gated the same way admin_send_
--    broadcast already is (private.is_admin()) and searches full_name, phone
--    AND email (joined from auth.users, same join broadcast_targets already
--    performs), capped at 25 rows for a picker UI.
--
-- notification_broadcasts.email_content carries the branded-template inputs
-- for the email channel (headline/bodyText/imageUrl/bandColor/buttonText/
-- buttonUrl/footerNote) — nullable, additive: a broadcast drafted before this
-- column existed (or any admin who leaves it unset) falls back to today's
-- plain title/body rendering. Rendered in two places that must stay in sync
-- (documented at the top of each): supabase/functions/send-pending-
-- notifications/index.ts's broadcast_announcement handler, and apps/web/src/
-- lib/broadcasts/render-email-template.ts for the admin's live preview.

alter table public.notification_broadcasts
  add column email_content jsonb;

comment on column public.notification_broadcasts.email_content is
  'Optional branded-template content for the email channel only: { headline: string, bodyText: string, imageUrl?: string, bandColor?: "green"|"navy"|"none", buttonText?: string, buttonUrl?: string, footerNote?: string }. Null (the default, and every broadcast drafted before this column existed) falls back to the plain title/body rendering admin_send_broadcast has always produced. Rendered in two files that must be kept in sync: supabase/functions/send-pending-notifications/index.ts (broadcast_announcement handler) and apps/web/src/lib/broadcasts/render-email-template.ts (admin composer live preview).';

-- private.broadcast_targets(): add the specific_patients leg. Same output
-- shape as the existing patient leg (organisation_id, email from auth.users,
-- phone, is_partner=false). No signature change (still 4 args incl.
-- p_marketing) — plain CREATE OR REPLACE.
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
        from public.service_purchases sp
        join public.service_products spr on spr.id = sp.service_product_id
        where sp.patient_id = p.id
          and sp.status = 'active'
          and (sp.expires_at is null or sp.expires_at > now())
          and ((p_filter->>'plan_code') is null or spr.code = (p_filter->>'plan_code'))
      )
    )

  union all

  -- Hand-picked patients (2026-09-12, admin_search_patients picker). Own leg,
  -- deliberately untouched by p_marketing — see migration header.
  select p.id, p.organisation_id, u.email, p.phone, false
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and p_audience = 'specific_patients'
    and p.id in (
      select (elem)::uuid
      from jsonb_array_elements_text(coalesce(p_filter->'patient_ids', '[]'::jsonb)) as elem
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
  'Audience resolver for notification_broadcasts. subscribers_by_plan resolves against service_purchases/service_products (2026-08-31 pay-per-service model). specific_patients (2026-09-12) resolves p_filter->patient_ids, a jsonb array of uuid strings, against profiles/auth.users — its own leg, not marketing-gated. p_marketing=true excludes any patient recipient (all_patients/patients_by_state/subscribers_by_plan only) with marketing_opt_in=false (17.4); partner rows and the specific_patients leg are never filtered by it. SECURITY DEFINER, admin-gated by every caller.';

revoke all on function private.broadcast_targets(public.broadcast_audience, jsonb, uuid, boolean) from public, anon;

-- admin_send_broadcast: pass the broadcast's email_content through to the
-- email-channel notification payload (additive — nullable, absent means the
-- edge function's existing plain rendering, unchanged for sms/whatsapp).
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
             jsonb_build_object(
               'subject', v_b.title, 'body', v_b.body, 'to_email', t.email,
               'email_content', v_b.email_content
             )
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

revoke all on function public.admin_send_broadcast(uuid) from public, anon;
grant execute on function public.admin_send_broadcast(uuid) to authenticated;

-- admin_search_patients(): same admin gate admin_send_broadcast already uses
-- (private.is_admin(), not private.is_analyst() — this is the Broadcasts
-- tool, not the analytics console). Searches full_name/phone/email (the
-- existing analytics_patient_search RPC is missing email — that's the actual
-- gap this closes, not a duplicate of it). Capped at 25 rows for a picker UI.
create or replace function public.admin_search_patients(p_query text)
returns table (
  id        uuid,
  full_name text,
  email     text,
  phone     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  return query
  select p.id, p.full_name, u.email, p.phone
  from public.profiles p
  join auth.users u on u.id = p.id
  where p.role = 'patient'
    and (
      p.full_name ilike '%' || p_query || '%'
      or p.phone ilike '%' || p_query || '%'
      or u.email ilike '%' || p_query || '%'
    )
  order by p.full_name nulls last
  limit 25;
end;
$$;

comment on function public.admin_search_patients(text) is
  'Admin-only (private.is_admin()) patient lookup for the Broadcasts specific-patient picker. Searches full_name/phone/email (email joined from auth.users) via ILIKE, capped at 25 rows. Not the analytics console — see analytics_patient_search (private.is_analyst()-gated, no email) for that one, which this deliberately does not reuse or extend.';

revoke all on function public.admin_search_patients(text) from public, anon;
grant execute on function public.admin_search_patients(text) to authenticated;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'notification_broadcasts' and column_name = 'email_content'
  ) then
    raise exception 'FAIL: notification_broadcasts.email_content was not added';
  end if;

  if has_function_privilege('anon', 'public.admin_search_patients(text)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute admin_search_patients';
  end if;
  if has_function_privilege('anon', 'private.broadcast_targets(broadcast_audience, jsonb, uuid, boolean)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.broadcast_targets';
  end if;
end $$;

-- Tarragon Health
-- Data Governance gap-closure, item 6 of 7 (§87.16 "compliance calendar" of
-- the 2026-08-29 governance/safety spec audit). Confirmed live before
-- writing this via pg_get_functiondef: the existing
-- private.queue_partner_license_expiry_alerts() (built earlier this
-- project) is a single flat 30-day threshold that re-fires every single day
-- a licence stays within that window (dedup is per calendar day, not per
-- threshold crossing) -- not the graduated 90/60/30 cascade the spec asks
-- for, and there's no owner concept at all, just a blast to every admin.
--
-- This migration:
--   1. widens the scan window to 90 days and adds a threshold_days column
--      so a partner is notified once per threshold crossing (90/60/30/
--      expired), not once per day it happens to still be within 30 days;
--   2. adds compliance_owner_profile_id to all 5 partner tables so a
--      specific person -- not just "every admin" -- can be assigned
--      ownership of a partner's licence renewal;
--   3. rewrites the cron function to use both, with severity-appropriate
--      copy per threshold and the compliance owner included in the
--      recipient list (deduplicated against the admin broadcast).

alter table public.partner_license_expiry_notifications
  add column threshold_days integer;

comment on column public.partner_license_expiry_notifications.threshold_days is
  'Which cascade rung (90/60/30/0=expired) this notification was sent for. New dedup key -- replaces the old per-calendar-day dedup so a partner gets one notification per threshold crossing, not a daily repeat.';

alter table public.partner_license_expiry_notifications
  drop constraint partner_license_expiry_notifi_partner_table_partner_id_noti_key;

alter table public.partner_license_expiry_notifications
  add constraint partner_license_expiry_notifications_partner_threshold_key
    unique (partner_table, partner_id, threshold_days);

alter table public.lab_providers
  add column compliance_owner_profile_id uuid references public.profiles (id) on delete set null;
alter table public.pharmacy_partners
  add column compliance_owner_profile_id uuid references public.profiles (id) on delete set null;
alter table public.specialist_providers
  add column compliance_owner_profile_id uuid references public.profiles (id) on delete set null;
alter table public.home_visit_providers
  add column compliance_owner_profile_id uuid references public.profiles (id) on delete set null;
alter table public.logistics_partners
  add column compliance_owner_profile_id uuid references public.profiles (id) on delete set null;

comment on column public.lab_providers.compliance_owner_profile_id is
  'Admin accountable for this partner''s licence/contract renewal, §87.16. Null-gated -- an unset owner means the partner falls back to the broad admin broadcast, not that ownership is assumed.';
comment on column public.pharmacy_partners.compliance_owner_profile_id is
  'Admin accountable for this partner''s licence/contract renewal, §87.16. Null-gated -- an unset owner means the partner falls back to the broad admin broadcast, not that ownership is assumed.';
comment on column public.specialist_providers.compliance_owner_profile_id is
  'Admin accountable for this partner''s licence/contract renewal, §87.16. Null-gated -- an unset owner means the partner falls back to the broad admin broadcast, not that ownership is assumed.';
comment on column public.home_visit_providers.compliance_owner_profile_id is
  'Admin accountable for this partner''s licence/contract renewal, §87.16. Null-gated -- an unset owner means the partner falls back to the broad admin broadcast, not that ownership is assumed.';
comment on column public.logistics_partners.compliance_owner_profile_id is
  'Admin accountable for this partner''s licence/contract renewal, §87.16. Null-gated -- an unset owner means the partner falls back to the broad admin broadcast, not that ownership is assumed.';

create index lab_providers_compliance_owner_idx on public.lab_providers (compliance_owner_profile_id) where compliance_owner_profile_id is not null;
create index pharmacy_partners_compliance_owner_idx on public.pharmacy_partners (compliance_owner_profile_id) where compliance_owner_profile_id is not null;
create index specialist_providers_compliance_owner_idx on public.specialist_providers (compliance_owner_profile_id) where compliance_owner_profile_id is not null;
create index home_visit_providers_compliance_owner_idx on public.home_visit_providers (compliance_owner_profile_id) where compliance_owner_profile_id is not null;
create index logistics_partners_compliance_owner_idx on public.logistics_partners (compliance_owner_profile_id) where compliance_owner_profile_id is not null;

create or replace function private.queue_partner_license_expiry_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  t text;
  r record;
  v_admin record;
  v_message text;
  v_threshold integer;
  v_already_notified boolean;
  v_notified_profile_ids uuid[];
begin
  foreach t in array array['lab_providers', 'pharmacy_partners', 'specialist_providers', 'home_visit_providers', 'logistics_partners']
  loop
    for r in execute format(
      $sql$
        select id, name, license_expires_at, compliance_owner_profile_id
        from public.%I
        where is_active
          and license_expires_at is not null
          and license_expires_at < now() + interval '90 days'
      $sql$,
      t
    )
    loop
      v_threshold := case
        when r.license_expires_at < now() then 0
        when r.license_expires_at < now() + interval '30 days' then 30
        when r.license_expires_at < now() + interval '60 days' then 60
        else 90
      end;

      select exists (
        select 1 from public.partner_license_expiry_notifications
        where partner_table = t and partner_id = r.id and threshold_days = v_threshold
      ) into v_already_notified;

      if v_already_notified then
        continue;
      end if;

      insert into public.partner_license_expiry_notifications (partner_table, partner_id, threshold_days)
      values (t, r.id, v_threshold)
      on conflict (partner_table, partner_id, threshold_days) do nothing;

      v_message := case
        when v_threshold = 0 then
          format('%s (%s) license expired %s', r.name, t, to_char(r.license_expires_at, 'DD Mon YYYY'))
        else
          format('%s (%s) license expires %s (%s-day notice)', r.name, t, to_char(r.license_expires_at, 'DD Mon YYYY'), v_threshold)
      end;

      v_notified_profile_ids := array[]::uuid[];

      if r.compliance_owner_profile_id is not null then
        insert into public.notifications (recipient_id, channel, template, payload, status, content_class)
        values (
          r.compliance_owner_profile_id,
          'in_app',
          'partner_license_expiry',
          jsonb_build_object('message', v_message, 'partner_table', t, 'partner_id', r.id, 'threshold_days', v_threshold, 'as_compliance_owner', true),
          'pending',
          'non_clinical'
        );
        v_notified_profile_ids := array_append(v_notified_profile_ids, r.compliance_owner_profile_id);
      end if;

      -- Below the 60-day mark, escalate beyond the named owner to every
      -- admin -- a single owner missing a 30-day/expired notice is exactly
      -- the failure mode a compliance calendar exists to prevent.
      if v_threshold <= 60 then
        for v_admin in select id from public.profiles where role = 'admin' and id <> all (v_notified_profile_ids)
        loop
          insert into public.notifications (recipient_id, channel, template, payload, status, content_class)
          values (
            v_admin.id,
            'in_app',
            'partner_license_expiry',
            jsonb_build_object('message', v_message, 'partner_table', t, 'partner_id', r.id, 'threshold_days', v_threshold, 'as_compliance_owner', false),
            'pending',
            'non_clinical'
          );
        end loop;
      elsif r.compliance_owner_profile_id is null then
        -- No owner assigned at all -- fall back to the broad admin
        -- broadcast even at the earliest (90-day) rung, matching the old
        -- behaviour for un-owned partners.
        for v_admin in select id from public.profiles where role = 'admin'
        loop
          insert into public.notifications (recipient_id, channel, template, payload, status, content_class)
          values (
            v_admin.id,
            'in_app',
            'partner_license_expiry',
            jsonb_build_object('message', v_message, 'partner_table', t, 'partner_id', r.id, 'threshold_days', v_threshold, 'as_compliance_owner', false),
            'pending',
            'non_clinical'
          );
        end loop;
      end if;
    end loop;
  end loop;
end;
$function$;

comment on function private.queue_partner_license_expiry_alerts() is
  '§87.16 compliance calendar. 90/60/30/expired cascade, one notification per threshold crossing (not per day). A partner with a compliance_owner_profile_id is notified directly at every rung; the full admin group is added from 60 days out downward, or immediately if no owner is assigned.';

revoke all on function private.queue_partner_license_expiry_alerts() from public, anon;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'partner_license_expiry_notifications' and column_name = 'threshold_days'
  ) then
    raise exception 'threshold_days column missing after migration';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_providers' and column_name = 'compliance_owner_profile_id'
  ) is false then
    raise exception 'compliance_owner_profile_id missing on lab_providers';
  end if;
  if pg_get_functiondef('private.queue_partner_license_expiry_alerts()'::regprocedure) not like '%90 days%' then
    raise exception 'queue_partner_license_expiry_alerts was not updated to the 90-day cascade';
  end if;
  raise notice 'PASS: 90/60/30 compliance cascade + compliance_owner_profile_id live on all 5 partner tables';
end $$;

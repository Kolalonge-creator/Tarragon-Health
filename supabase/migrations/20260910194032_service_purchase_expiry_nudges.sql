-- Renewal-on-expiry nudge for service_purchases.
--
-- The pricing page has promised this since Continuous Monitoring launched
-- ("We tell you before it runs out, so it never lapses without you
-- knowing" — apps/web/src/app/(marketing)/_content/pricing.ts) but nothing
-- ever implemented it: service_purchases.status never transitions out of
-- 'active' on its own (private.apply_service_purchase_payment only ever
-- sets it TO 'active'), and no cron/trigger warns a patient before
-- expires_at passes. private.patient_has_feature_access already checks
-- expires_at live, so access itself has always cut off on time — this closes
-- the two real gaps: nobody was ever told in advance, and a lapsed purchase
-- sat forever reading 'active' to any UI/report that trusts the status
-- column instead of re-deriving from expires_at (e.g. a "my services" list).
--
-- Modelled directly on private.run_care_voucher_expiry()
-- (20260731215424_care_vouchers_lifecycle_and_rewards.sql): warn once inside
-- a window before expiry (deduped via notifications.source_table/source_id,
-- same mechanism), then sweep anything actually past expiry. The window is
-- 14 days here rather than the voucher's 30 — service_purchases terms run as
-- short as 90 days (Continuous Monitoring 3-month, Supervised Weight
-- Management 3-month), where a 30-day warning would fire a third of the way
-- into a freshly-bought term.
--
-- content_class stays at its 'non_clinical' default (this is a billing/
-- account matter, not a care reminder — same reasoning the voucher-expiry
-- header note already gives), so in_app + email are both fine channels per
-- notifications_no_clinical_on_open_rail; whatsapp/sms are deliberately not
-- used for the same reason the voucher warning excludes them.

create or replace function private.run_service_purchase_expiry_nudges()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  -- Warn 14 days out, once per purchase (deduped on the notification itself).
  for v_row in
    select sp.*, spr.name as product_name
    from public.service_purchases sp
    join public.service_products spr on spr.id = sp.service_product_id
    where sp.status = 'active'
      and sp.expires_at is not null
      and sp.expires_at between now() and now() + interval '14 days'
      and not exists (
        select 1 from public.notifications n
        where n.template = 'service_purchase_expiring'
          and n.source_table = 'service_purchases' and n.source_id = sp.id
      )
  loop
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, source_table, source_id)
    select v_row.organisation_id, v_row.patient_id, ch, 'service_purchase_expiring',
           jsonb_build_object(
             'service_purchase_id', v_row.id,
             'label', v_row.product_name,
             'expires_on', to_char(v_row.expires_at, 'DD Mon YYYY')),
           'service_purchases', v_row.id
      from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  end loop;

  -- Sweep anything genuinely past expiry. Access itself already cut off via
  -- expires_at (patient_has_feature_access checks it live) — this only fixes
  -- the status column so a "my services" list stops calling a lapsed
  -- purchase active.
  update public.service_purchases
    set status = 'expired'
    where status = 'active' and expires_at is not null and expires_at <= now();
end;
$$;

comment on function private.run_service_purchase_expiry_nudges is
  'Daily: warns a patient 14 days before an active service_purchases row expires (in_app + email, deduped via notifications.source_table/source_id), then flips anything already past expires_at to status=''expired''. Mirrors private.run_care_voucher_expiry(). Scheduled via cron.schedule below.';

select cron.schedule('service-purchase-expiry-daily', '35 3 * * *',
  $$select private.run_service_purchase_expiry_nudges();$$);

-- ---------------------------------------------------------------------------
-- Notification template registry + copy, following the exact seeding shape
-- of 20260830002554_notification_templates_seed.sql /
-- 20260830002748_notification_template_locales_inapp_batch.sql.
-- ---------------------------------------------------------------------------

insert into public.notification_templates
  (key, category, business_priority, audience, default_channels, description)
values
  ('service_purchase_expiring', 'administrative', 'routine', 'patient',
   array['in_app', 'email']::public.notification_channel[],
   'A paid service (Continuous Monitoring, Supervised Weight Management, or a doctor-time credit) is expiring soon.')
on conflict (key) do nothing;

insert into public.notification_template_locales
  (template_key, locale, channel, subject, body)
values
  ('service_purchase_expiring', 'en', 'in_app', null,
   '{{label}} runs out on {{expires_on}}. Buy it again to keep it going, or let it lapse if you''re done.'),
  ('service_purchase_expiring', 'en', 'email', 'Your {{label}} runs out on {{expires_on}}',
   'Hi,

{{label}} on your Tarragon Health account runs out on {{expires_on}}.

Nothing renews on its own and no card is kept on file — if you''d like to keep it going, buy it again from the app before then. If you''re done with it, there''s nothing you need to do.

— Tarragon Health')
on conflict (template_key, locale, channel) do nothing;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.notification_template_locales
  where template_key = 'service_purchase_expiring' and channel in ('in_app', 'email');
  if v_count <> 2 then
    raise exception 'service_purchase_expiring template locales incomplete: found % rows, expected 2', v_count;
  end if;
  raise notice 'PASS: service_purchase_expiring seeded with % locale rows', v_count;
end $$;

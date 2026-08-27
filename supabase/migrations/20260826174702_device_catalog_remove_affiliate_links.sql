-- ---------------------------------------------------------------------------
-- Remove device_catalog's affiliate-link mechanism (founder decision
-- 2026-08-26, one day after device_catalog itself shipped).
--
-- Reasoning: Jumia/Konga don't run a workable affiliate programme for these
-- device categories, and linking to an international/direct-manufacturer
-- store (the Xiaomi scale row) exposes a Nigerian patient to import duty on
-- checkout — neither is a link Tarragon should be putting in front of a
-- patient and calling a recommendation. Tarragon goes back to plain
-- clinical recommendation with no purchase link and no commission: patients
-- buy a suggested scale/glucometer/monitor from whatever local retailer they
-- already use, same as CLAUDE.md's existing "Tarragon does NOT sell/import/
-- bundle BP cuffs or glucometers" founder decision (2026-08-02) — this just
-- closes the one narrower gap that decision didn't cover (an affiliate
-- link-out is not selling/importing, but it's the same "don't put Tarragon
-- in the commerce path" spirit).
--
-- Row count checked live before writing this migration: exactly 3 rows,
-- ALL fulfillment_type = 'affiliate', and — because both gates in the
-- original migration default to false pending a real pairing test — ALL
-- three still have active = false AND clinically_reviewed = false. Nothing
-- has ever been patient-visible, so this is a pure structural change with
-- zero rows to convert or backfill.
--
-- fulfillment_type's 'affiliate' value is renamed (not dropped) to
-- 'recommend_only' rather than the enum being recreated — a plain
-- ALTER TYPE ... RENAME VALUE is metadata-only and keeps the OID the 3
-- existing rows already store, so it needs no data UPDATE and the app-level
-- "affiliate" meaning can't silently persist under an old name: the label a
-- reader now sees for these rows is the new, correct one.
-- 'tarragon_owned' is untouched — still reserved for the wearable band once
-- a real Yucheng/YCAviation relationship exists (see CLAUDE.md's Device &
-- Wearable Integration section).
-- ---------------------------------------------------------------------------

alter table public.device_catalog
  drop constraint device_catalog_affiliate_link_required;

alter table public.device_catalog
  drop column affiliate_partner,
  drop column affiliate_link;

alter type public.device_catalog_fulfillment_type rename value 'affiliate' to 'recommend_only';

alter table public.device_catalog
  alter column fulfillment_type set default 'recommend_only';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'device_catalog'
      and column_name in ('affiliate_link', 'affiliate_partner')
  ) then
    raise exception 'device_catalog_remove_affiliate_links: affiliate_link/affiliate_partner column still exists';
  end if;

  if exists (
    select 1 from pg_enum e
    join pg_type t on t.oid = e.enumtypid
    where t.typname = 'device_catalog_fulfillment_type' and e.enumlabel = 'affiliate'
  ) then
    raise exception 'device_catalog_remove_affiliate_links: fulfillment_type still has an affiliate value';
  end if;

  if exists (select 1 from public.device_catalog where fulfillment_type::text <> 'recommend_only') then
    raise exception 'device_catalog_remove_affiliate_links: a pre-existing row did not carry over to recommend_only';
  end if;
end $$;

-- Tarragon Health
-- Home collection & delivery logistics — enforce is_active at assignment time.
--
-- Found during the post-merge browser verification pass for
-- 20260715230120_home_visit_and_logistics_partners.sql: useAssignHomeVisitProvider
-- and useAssignLogisticsPartner (apps/web/src/lib/queries/logistics-partners.ts)
-- write home_visit_provider_id/logistics_partner_id straight through the
-- Supabase client. Only the *matching* query (useMatchedHomeVisitProviders/
-- useMatchedLogisticsPartners) filters on is_active — that's a UI courtesy,
-- not a guarantee, and an inactive placeholder row was in fact found assigned
-- to a real lab_orders row this way. That defeats the whole feature's design:
-- per home_visit_and_logistics_partners.sql, activating a partner row is
-- supposed to be "the entire mechanism" that turns the real UI on for
-- patients — a UI-only filter doesn't actually guarantee that.
--
-- Same structural-gate pattern as enforce_medication_confirm_only/
-- enforce_lab_order_origin: RLS decides who may attempt the update, this
-- BEFORE trigger decides whether the specific value being written is valid.
-- Covers INSERT too (belt-and-braces — today's app flow never sets these
-- columns at insert time, but nothing else guarantees that stays true).

create or replace function private.enforce_home_visit_provider_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.home_visit_provider_id is not null
    and (tg_op = 'INSERT' or old.home_visit_provider_id is distinct from new.home_visit_provider_id)
  then
    if not exists (
      select 1 from public.home_visit_providers
      where id = new.home_visit_provider_id
        and is_active
    ) then
      raise exception 'home_visit_provider_id must reference an active home_visit_providers row' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger lab_orders_enforce_home_visit_provider_active
  before insert or update on public.lab_orders
  for each row execute function private.enforce_home_visit_provider_active();

create or replace function private.enforce_logistics_partner_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logistics_partner_id is not null
    and (tg_op = 'INSERT' or old.logistics_partner_id is distinct from new.logistics_partner_id)
  then
    if not exists (
      select 1 from public.logistics_partners
      where id = new.logistics_partner_id
        and is_active
    ) then
      raise exception 'logistics_partner_id must reference an active logistics_partners row' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create trigger pharmacy_orders_enforce_logistics_partner_active
  before insert or update on public.pharmacy_orders
  for each row execute function private.enforce_logistics_partner_active();

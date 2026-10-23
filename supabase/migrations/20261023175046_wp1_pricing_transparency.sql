-- WP1: pricing transparency. Competitor gap B1 (a "not included" list with prices), B2 (a price-change notice for people who hold an item).
-- B3 (the monthly equivalent of an annual price) is display only and lives in packages/commerce; it needs nothing in the database.
--
-- What this adds, on top of S25/S73 (nothing there is rebuilt, and catalogue(), catalogue_item() and price_quote() are NOT touched):
--   * catalog_item_extras: effective-dated, immutable rows saying what an item does not include. A row is EITHER a real catalogue item (an
--     "extra": its name and its price come from the catalogue and the price book, never from this table) OR an i18n label key for something that
--     is not sold here at all (for example medicines). Closing a row is the only change ever made to one, so the history is the version trail.
--   * public.catalogue_not_included(p_code): what a signed-in patient may see, with the same visibility as catalogue() (an item that is not on
--     sale shows nothing). An extra with no live price comes back with amount_kobo null and the screen says "Ask us": a price is never invented.
--   * public.admin_item_extras() / public.admin_set_item_extras(): an admin chooses which catalogue items are listed as extras for an item,
--     with a reason, audited. Label-only rows are code-governed (they need i18n copy) and are left alone by this function.
--   * price_change_notice: when a new list price replaces a different one, every person holding an active, unfinished entitlement of that item
--     that they paid the old price for gets ONE in-app notice. The unique index makes a replay a no-op. A failure to write a notice never blocks
--     the price change (it is logged to audit_log). The old price is honoured because nothing renews by itself: what a person already paid is
--     paid, and the new price applies only to a purchase they choose to make later.
--   * public.my_price_change_notices(): the details behind the notice, for the card on the Membership screen.
-- Sponsor-covered purchases (sponsor_share_kobo > 0) are never told about a list price: they did not pay it.
--
-- Counted first: catalog_item_extras is new (0 rows). Nothing is converted. Standing lessons applied: RLS on, no table grant to authenticated or
-- anon, every function revoked from public (anon inherits execute through PUBLIC) and re-checked in the self-check, no pgvector, no hand-typed timestamp.

-- ---------------------------------------------------------------------------
-- 1. The not-included list
-- ---------------------------------------------------------------------------
create table public.catalog_item_extras (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  catalog_item_id uuid not null references public.catalog_items (id) on delete restrict,
  extra_item_id   uuid references public.catalog_items (id) on delete restrict,
  label_key       text check (label_key ~ '^[a-z][a-z0-9_.]{2,100}$'),
  sort_order      smallint not null default 0 check (sort_order between 0 and 99),
  valid_from      timestamptz not null default now(),
  valid_to        timestamptz,
  created_by      uuid references public.profiles (id) on delete set null,
  reason          text,
  created_at      timestamptz not null default now(),
  check ((extra_item_id is null) <> (label_key is null)),
  check (extra_item_id is distinct from catalog_item_id),
  check (valid_to is null or valid_to > valid_from)
);
create unique index catalog_item_extras_one_item on public.catalog_item_extras (catalog_item_id, extra_item_id) where valid_to is null and extra_item_id is not null;
create unique index catalog_item_extras_one_label on public.catalog_item_extras (catalog_item_id, label_key) where valid_to is null and label_key is not null;
create index catalog_item_extras_item_idx on public.catalog_item_extras (catalog_item_id) where valid_to is null;
alter table public.catalog_item_extras enable row level security;
revoke all on public.catalog_item_extras from public, anon, authenticated;
-- No table grant: patients read catalogue_not_included(), admins admin_item_extras().

-- A row is a fact about a time range: only its end can be set, once. Nothing deletes one. An extra must be a patient-facing item of the same organisation.
create function private.catalog_item_extras_guard() returns trigger language plpgsql set search_path = '' as $$
declare a public.catalog_items%rowtype; b public.catalog_items%rowtype;
begin
  if tg_op = 'DELETE' then raise exception 'extras_immutable' using errcode = 'P0001'; end if;
  if tg_op = 'UPDATE' then
    if old.valid_to is not null or new.valid_to is null
       or new.id is distinct from old.id or new.organisation_id is distinct from old.organisation_id or new.catalog_item_id is distinct from old.catalog_item_id
       or new.extra_item_id is distinct from old.extra_item_id or new.label_key is distinct from old.label_key or new.sort_order is distinct from old.sort_order
       or new.valid_from is distinct from old.valid_from then
      raise exception 'extras_immutable' using errcode = 'P0001';
    end if;
    return new;
  end if;
  select * into a from public.catalog_items where id = new.catalog_item_id;
  if a.organisation_id is distinct from new.organisation_id or a.audience <> 'patient' then raise exception 'extras_item_invalid' using errcode = '22023'; end if;
  if new.extra_item_id is not null then
    select * into b from public.catalog_items where id = new.extra_item_id;
    if b.organisation_id is distinct from new.organisation_id or b.audience <> 'patient' then raise exception 'extras_item_invalid' using errcode = '22023'; end if;
  end if;
  -- a short list: twelve open rows at most per item
  if (select count(*) from public.catalog_item_extras where catalog_item_id = new.catalog_item_id and valid_to is null) >= 12 then
    raise exception 'extras_too_many' using errcode = '22023';
  end if;
  return new;
end $$;
revoke all on function private.catalog_item_extras_guard() from public, anon, authenticated;
create trigger catalog_item_extras_guard before insert or update or delete on public.catalog_item_extras
  for each row execute function private.catalog_item_extras_guard();

-- Seed (PROPOSED wording, owner Founder; the label copy is in packages/i18n and a test fails if a key here has no words).
-- The Membership says in its own description that medicines are not included; the single consultation says the same of medicines and offers the test package.
insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id, label_key, sort_order, reason)
select i.organisation_id, i.id, x.id, v.label_key, v.sort_order, 'Seeded by WP1 (proposed wording)'
  from (values
    ('membership_annual', null::text, 'catalog.notincl.medicines', 0),
    ('membership_annual', null, 'catalog.notincl.hospital_care', 1),
    ('membership_annual', 'consultation_single', null, 2),
    ('membership_annual', 'lab_panel_standard', null, 3),
    ('consultation_single', null, 'catalog.notincl.medicines', 0),
    ('consultation_single', 'lab_panel_standard', null, 1)
  ) as v(item_code, extra_code, label_key, sort_order)
  join public.catalog_items i on i.code = v.item_code
  left join public.catalog_items x on x.code = v.extra_code and x.organisation_id = i.organisation_id
 where v.extra_code is null or x.id is not null
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Patient read: same visibility as catalogue()
-- ---------------------------------------------------------------------------
create function public.catalogue_not_included(p_code text default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('code', i.code, 'items', e.items) order by i.code), '[]'::jsonb)
    from public.catalog_items i
    cross join lateral (
      select coalesce(jsonb_agg(jsonb_build_object(
               'label_key', coalesce(x.name_key, r.label_key),
               'extra_code', x.code,
               -- a price only for an extra that is itself on sale with a live price; otherwise null and the screen says "Ask us"
               'amount_kobo', case when x.id is not null and x.active and x.audience = 'patient' then (private.current_price(x.id)).amount_kobo end)
             order by r.sort_order, r.created_at), '[]'::jsonb) as items
        from public.catalog_item_extras r
        left join public.catalog_items x on x.id = r.extra_item_id
       where r.catalog_item_id = i.id and r.valid_to is null and r.valid_from <= now()
    ) e
   where i.active and i.audience = 'patient' and (private.current_price(i.id)).id is not null
     and (p_code is null or i.code = p_code)
     and i.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))
     and coalesce((select is_enabled from public.platform_modules where key = 'v5_checkout'), false)
$$;
revoke all on function public.catalogue_not_included(text) from public, anon;
grant execute on function public.catalogue_not_included(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Admin: read and set the priced extras of an item
-- ---------------------------------------------------------------------------
create function public.admin_item_extras() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', i.code,
             'extra_codes', coalesce((select jsonb_agg(x.code order by r.sort_order) from public.catalog_item_extras r join public.catalog_items x on x.id = r.extra_item_id
                                       where r.catalog_item_id = i.id and r.valid_to is null), '[]'::jsonb),
             'label_keys', coalesce((select jsonb_agg(r.label_key order by r.sort_order) from public.catalog_item_extras r
                                      where r.catalog_item_id = i.id and r.valid_to is null and r.label_key is not null), '[]'::jsonb))
           order by i.code)
      from public.catalog_items i where i.organisation_id = v_org and i.audience = 'patient'), '[]'::jsonb);
end $$;
revoke all on function public.admin_item_extras() from public, anon;
grant execute on function public.admin_item_extras() to authenticated;

create function public.admin_set_item_extras(p_code text, p_extra_codes text[], p_reason text) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_org uuid := (select organisation_id from public.profiles where id = (select auth.uid()));
  it public.catalog_items%rowtype; v_codes text[] := coalesce(p_extra_codes, '{}'); v_c text; v_x public.catalog_items%rowtype; v_pos smallint := 20; v_open integer;
begin
  if (select auth.uid()) is null or not private.is_admin() then raise exception 'catalogue_not_authorised' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then raise exception 'catalogue_reason_needed' using errcode = '22023'; end if;
  select * into it from public.catalog_items where organisation_id = v_org and code = p_code and audience = 'patient';
  if not found then raise exception 'unknown_item' using errcode = '22023'; end if;
  if cardinality(v_codes) > 12 or (select count(distinct c) from unnest(v_codes) c) <> cardinality(v_codes) then raise exception 'extras_invalid' using errcode = '22023'; end if;
  -- close the priced rows that are no longer wanted
  update public.catalog_item_extras r set valid_to = now()
   where r.catalog_item_id = it.id and r.valid_to is null and r.extra_item_id is not null
     and not exists (select 1 from public.catalog_items x where x.id = r.extra_item_id and x.code = any (v_codes));
  -- add the new ones, in the order given, after the code-governed label rows
  foreach v_c in array v_codes loop
    select * into v_x from public.catalog_items where organisation_id = v_org and code = v_c and audience = 'patient';
    if not found or v_x.id = it.id then raise exception 'extras_invalid' using errcode = '22023'; end if;
    insert into public.catalog_item_extras (organisation_id, catalog_item_id, extra_item_id, sort_order, created_by, reason)
    values (v_org, it.id, v_x.id, least(v_pos, 99), (select auth.uid()), btrim(p_reason))
    on conflict do nothing;
    v_pos := v_pos + 1;
  end loop;
  perform private.log_audit('catalogue.extras_set', 'catalog_items', it.id, jsonb_build_object('code', p_code, 'extra_codes', to_jsonb(v_codes), 'reason', p_reason));
  select count(*) into v_open from public.catalog_item_extras where catalog_item_id = it.id and valid_to is null;
  return v_open;
end $$;
revoke all on function public.admin_set_item_extras(text, text[], text) from public, anon;
grant execute on function public.admin_set_item_extras(text, text[], text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The price-change notice
-- ---------------------------------------------------------------------------
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('price_change_notice', 'administrative', 'routine', 'patient', array['in_app']::public.notification_channel[], 'immediate',
   'The price of something you already hold is changing. Nothing is charged: what you paid is paid, and the new price applies only if you choose to buy again.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('price_change_notice', 'en', 'in_app', null, 'A price is changing. You have already paid for what you hold, so nothing changes for you. Open the app to see the details')
on conflict (template_key, locale, channel) do nothing;

create unique index notifications_price_change_once
  on public.notifications (recipient_id, template, (payload ->> 'price_id'))
  where template = 'price_change_notice';

create function private.notify_price_change() returns trigger language plpgsql security definer set search_path = '' as $$
declare prev public.prices%rowtype;
begin
  select * into prev from public.prices where catalog_item_id = new.catalog_item_id and valid_to = new.valid_from limit 1;
  if not found or prev.amount_kobo = new.amount_kobo then return new; end if;
  begin
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    select distinct on (e.patient_id) e.organisation_id, e.patient_id, 'in_app', 'pending', 'price_change_notice',
           jsonb_build_object('price_id', new.id, 'item_code', it.code), 'non_clinical'
      from public.entitlements e
      join public.orders o on o.id = e.order_id
      join public.prices pp on pp.id = o.price_id
      join public.catalog_items it on it.id = o.catalog_item_id
     where o.catalog_item_id = new.catalog_item_id and e.state = 'active' and e.ends_at is not null and e.ends_at > now()
       and o.sponsor_share_kobo = 0 and pp.amount_kobo <> new.amount_kobo
    on conflict do nothing;
  exception when others then
    -- a notice must never stop a price from being set; the failure is recorded, not hidden
    insert into public.audit_log (action, entity_type, entity_id, event)
    values ('price_change_notice.error', 'price', new.id, jsonb_build_object('error', left(sqlerrm, 300)));
  end;
  return new;
end $$;
revoke all on function private.notify_price_change() from public, anon, authenticated;
create trigger prices_notify_change after insert on public.prices for each row execute function private.notify_price_change();

-- The details behind the notice, for the signed-in person only.
create function public.my_price_change_notices() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'item_code', n.code, 'name_key', n.name_key, 'paid_list_kobo', n.paid_kobo, 'new_kobo', n.new_kobo,
           'new_from', n.new_from, 'ends_at', n.ends_at) order by n.ends_at), '[]'::jsonb)
    from (
      select distinct on (e.id) it.code, it.name_key, pp.amount_kobo as paid_kobo, np.amount_kobo as new_kobo, np.valid_from as new_from, e.ends_at
        from public.entitlements e
        join public.orders o on o.id = e.order_id
        join public.prices pp on pp.id = o.price_id
        join public.catalog_items it on it.id = o.catalog_item_id
        cross join lateral (select p.amount_kobo, p.valid_from from public.prices p where p.catalog_item_id = it.id order by p.valid_from desc limit 1) np
       where e.patient_id = (select auth.uid()) and e.state = 'active' and e.ends_at is not null and e.ends_at > now()
         and o.sponsor_share_kobo = 0 and np.amount_kobo <> pp.amount_kobo and np.valid_from > pp.valid_from
    ) n
$$;
revoke all on function public.my_price_change_notices() from public, anon;
grant execute on function public.my_price_change_notices() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.catalog_item_extras'::regclass) then raise exception 'WP1: catalog_item_extras has no RLS'; end if;
  if has_table_privilege('authenticated', 'public.catalog_item_extras', 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon', 'public.catalog_item_extras', 'SELECT') then
    raise exception 'WP1: catalog_item_extras is reachable directly';
  end if;
  if has_function_privilege('anon', 'public.catalogue_not_included(text)', 'EXECUTE') or has_function_privilege('anon', 'public.admin_item_extras()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_set_item_extras(text,text[],text)', 'EXECUTE') or has_function_privilege('anon', 'public.my_price_change_notices()', 'EXECUTE') then
    raise exception 'WP1: anon can execute a pricing transparency function';
  end if;
  if has_function_privilege('authenticated', 'private.notify_price_change()', 'EXECUTE') then raise exception 'WP1: the notice trigger function is callable'; end if;
end $$;

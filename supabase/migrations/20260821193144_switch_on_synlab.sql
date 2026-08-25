-- Switching Synlab on.
--
-- Everything up to here built the machinery. This is the row that makes it
-- real: one active laboratory, which is what private.resolve_lab_order_provider
-- needs to resolve a provider without guessing, and what
-- public.region_service_available needs to answer "yes" for a lab in Lagos.
--
-- Two things had to be fixed first, because both fire on exactly the event
-- this switch makes possible for the first time — a partner-billed order
-- reaching payment_confirmed. Neither has ever run in production, because no
-- laboratory has ever been active. Both would have run on the first one.

-- ---------------------------------------------------------------------------
-- 1. A live partner cannot carry placeholder contact details.
--
-- private.enqueue_lab_order_lab_notifications sends the laboratory an SMS and
-- an email naming the patient and quoting their patient number, the moment an
-- order is paid. Synlab's seeded contacts were labs@synlab.example and
-- +2348030000101 — an invented address and an invented Nigerian phone number
-- that may well belong to a real subscriber. Activating with those in place
-- would have sent identifiable patient information to a stranger on the first
-- paid order.
--
-- So this is a constraint rather than a note to be careful: a partner cannot
-- be active while its contact details are a placeholder. The failure mode is a
-- refused UPDATE, which somebody reads, instead of a text message to a number
-- nobody chose.
--
-- Scoped to lab_providers deliberately. The same seeded-.example pattern is on
-- pharmacy_partners, specialist_providers, home_visit_providers and
-- logistics_partners, and each will need the same guard when it is switched
-- on; doing all five here would be changing four things nobody asked about.
-- ---------------------------------------------------------------------------
alter table public.lab_providers drop constraint if exists lab_providers_active_needs_real_contacts;
alter table public.lab_providers add constraint lab_providers_active_needs_real_contacts check (
  not is_active
  or (coalesce(contact_email, '') not like '%.example'
      and coalesce(contact_email, '') not like '%.example.com'
      and coalesce(contact_email, '') not like '%@example.%')
);

comment on constraint lab_providers_active_needs_real_contacts on public.lab_providers is
  'A laboratory that is live must not carry a seeded placeholder address, because the paid-order trigger sends it the patient''s name and patient number. Null is allowed and means "no alert is sent yet" — the notification trigger is null-guarded on both channels.';

-- ---------------------------------------------------------------------------
-- 2. A partner-billed order earns no commission, because the margin IS the
--    income.
--
-- private.record_lab_commission is from the referral era, when a patient paid
-- the laboratory directly and the laboratory paid Tarragon a percentage. Six
-- bundles still carry commission_rate 0.2000 from that model.
--
-- Under the partner-billed model that percentage is not owed to Tarragon by
-- anybody. Tarragon has already collected the whole price; its income is the
-- difference between the patient price and the contract cost, and that
-- difference is posted to 4100 by private.finance_post_from_payment. A
-- commissions row on top of it is a second, phantom record of the same income
-- — and it lands in the admin commissions dashboard and the accounting ageing
-- report as money a partner owes Tarragon, which is the exact opposite of the
-- truth: on a partner order Tarragon owes the laboratory.
--
-- Self-arranged orders are untouched. They keep the old behaviour, which is
-- also dormant — private.enforce_lab_order_origin will not let a self-arranged
-- order reach pending_payment at all, so it never reaches payment_confirmed
-- through Tarragon either.
-- ---------------------------------------------------------------------------
create or replace function private.record_lab_commission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  bundle record;
  provider_name text;
  computed_amount bigint;
begin
  -- Partner-billed: Tarragon collected the whole price and owes the
  -- laboratory its share. There is no commission to record, and recording one
  -- would double-count the margin already posted to revenue.
  if new.fulfilment = 'partner' then
    return new;
  end if;

  select commission_rate_type, commission_rate, commission_flat_kobo
  into bundle
  from public.panel_bundles
  where id = new.panel_bundle_id;

  select name into provider_name from public.lab_providers where id = new.provider_id;

  if bundle.commission_rate_type = 'flat' then
    computed_amount := coalesce(bundle.commission_flat_kobo, 0);
  else
    computed_amount := round(new.total_kobo * coalesce(bundle.commission_rate, 0));
  end if;

  insert into public.commissions (
    organisation_id, commission_type, source_id, source_reference,
    partner_name, amount_kobo, rate, rate_type
  ) values (
    new.organisation_id, 'lab', new.id, new.order_number,
    provider_name, computed_amount, bundle.commission_rate, coalesce(bundle.commission_rate_type, 'percentage')
  );

  return new;
end;
$$;

revoke all on function private.record_lab_commission() from public;

-- ---------------------------------------------------------------------------
-- 3. The switch.
--
-- Contacts are cleared rather than guessed. Transmission today is a person
-- sending the request and recording Synlab's own reference against it
-- (public.mark_lab_order_transmitted), not an automated email, so a null
-- contact costs nothing operationally — it only means the automatic
-- "you have a new order" alert stays silent until the real address and number
-- from the contract are entered. Entering them is an UPDATE, and the
-- constraint above will accept them the moment they are real.
--
-- The other three laboratories stay inactive on purpose.
-- private.resolve_lab_order_provider will only fall back to "the single active
-- laboratory" while there is exactly one; a second active partner makes every
-- order that does not name a provider ambiguous, and it refuses rather than
-- picking a price list at random.
-- ---------------------------------------------------------------------------
update public.lab_providers
   set contact_email = null,
       contact_phone = null,
       is_active     = true
 where name = 'Synlab Nigeria';

-- ---------------------------------------------------------------------------
-- 4. Assertions — "switched on" proved, not assumed.
-- ---------------------------------------------------------------------------
do $$
declare
  v_synlab uuid;
  v_active int;
  v_underpriced text;
begin
  select id into v_synlab from public.lab_providers where name = 'Synlab Nigeria' and is_active;
  if v_synlab is null then
    raise exception 'Synlab is not active';
  end if;

  select count(*) into v_active from public.lab_providers where is_active;
  if v_active <> 1 then
    raise exception 'expected exactly one active laboratory, found % — provider resolution becomes ambiguous', v_active;
  end if;

  -- The fallback in resolve_lab_order_provider now has something to resolve to.
  if private.resolve_lab_order_provider(null, null) is distinct from v_synlab then
    raise exception 'an order naming no provider does not resolve to Synlab';
  end if;

  -- And a patient in a live state can now be told a laboratory is available.
  if not public.region_service_available('Lagos', 'lab') then
    raise exception 'Lagos still reports no laboratory service';
  end if;

  -- No placeholder contact survived activation.
  if exists (select 1 from public.lab_providers
              where is_active and coalesce(contact_email, '') like '%.example') then
    raise exception 'an active laboratory still carries a placeholder contact address';
  end if;

  -- Every price Synlab can be billed against still covers its contract cost.
  -- assert_test_price_covers_cost only looks at ACTIVE providers, so until
  -- this migration it had nothing to compare against and could not have
  -- caught a loss-making price.
  select string_agg(st.code || ' (patient ' || st.price_kobo || ' < cost ' || lt.price_kobo || ')', ', ')
    into v_underpriced
    from public.screen_types st
    join public.lab_tests lt on lt.code = st.code and lt.provider_id = v_synlab
   where st.price_kobo is not null and st.price_kobo < lt.price_kobo;
  if v_underpriced is not null then
    raise exception 'Tarragon would pay to run these tests: %', v_underpriced;
  end if;

  -- The commission double-count is closed.
  if pg_get_functiondef('private.record_lab_commission()'::regprocedure) not like '%fulfilment = ''partner''%' then
    raise exception 'a partner-billed order would still record a phantom commission';
  end if;
end $$;

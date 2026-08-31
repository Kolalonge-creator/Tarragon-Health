-- Proves 20260831090100_video_visit_request_source_linkage.sql and the
-- Synlab consult-bundling payment path built on top of it.
--
-- Two things matter and are checked here:
--   1. A bundled video_visit_requests row is priced EXACTLY like every other
--      one — from video_visit_prices via private.pin_video_visit_amount(),
--      never from anything the client (or this feature's own server action)
--      could set. A patient session attempting to spoof amount_minor/status
--      on insert is the sabotage-once proof that still holds with the two
--      new columns present.
--   2. Bundling a consult with a Synlab lab order never touches that order's
--      own price — total_kobo/payable_kobo for a bundled order must be
--      byte-identical to an unbundled control order for the same panel.
--
-- The webhook's "confirm a second row from the same charge" fan-out
-- (paystack-webhook/index.ts, stripe-webhook/index.ts) is simulated directly
-- here as the same two UPDATE statements the Edge Function runs, since Deno
-- Edge Functions cannot be exercised from a SQL test.
--
-- Run inside a single transaction and ROLLED BACK.
--
-- To re-run:
--   npx supabase db query --linked -f packages/db/tests/video_visit_bundle_and_source_linkage.sql

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

insert into ids
select 'patient', id from public.profiles
 where id in (select id from auth.users where email = 'patient.complete.test@tarragon.test');
insert into ids
select 'org', organisation_id from public.profiles
 where id = (select v from ids where k = 'patient');
insert into ids
select 'clinician', id from public.profiles
 where id in (select id from auth.users where email = 'clinician.tier2.test@tarragon.test');
insert into ids
select 'bundle', id from public.panel_bundles where code = 'screen_core';

do $$
declare
  v_state text;
begin
  select state into v_state from public.profiles where id = (select v from ids where k = 'patient');
  update public.service_regions set is_active = true where state = v_state;
  if not found then insert into public.service_regions (state, is_active) values (v_state, true); end if;
  update public.lab_providers set is_active = true, regions = array[v_state] where name = 'Synlab Nigeria';
end $$;

-- A published, open, future slot to request against.
insert into ids
select 'slot', id from public.consult_availability_slots
where clinician_profile_id = (select v from ids where k = 'clinician')
  and booked_consultation_id is null and slot_start > now()
limit 1;

with new_slot as (
  insert into public.consult_availability_slots
    (organisation_id, clinician_profile_id, slot_start, slot_end)
  select
    (select v from ids where k = 'org'),
    (select v from ids where k = 'clinician'),
    now() + interval '1 day',
    now() + interval '1 day 15 minutes'
  where (select v from ids where k = 'slot') is null
  returning id
)
insert into ids select 'slot', id from new_slot
on conflict (k) do update set v = excluded.v;

------------------------------------------------------------------
-- As the patient — this is the exact insert shape
-- createAndPayForPartnerLabOrder / requestVideoVisit produce.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k = 'patient'), 'role', 'authenticated')::text, true);
set local role authenticated;

with new_order as (
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
  values (
    (select v from ids where k = 'org'),
    (select v from ids where k = 'patient'),
    (select v from ids where k = 'bundle'),
    'partner', 'pending_payment'
  )
  returning id
)
insert into ids select 'bundled_order', id from new_order;

with new_order as (
  insert into public.lab_orders
    (organisation_id, patient_id, panel_bundle_id, fulfilment, status)
  values (
    (select v from ids where k = 'org'),
    (select v from ids where k = 'patient'),
    (select v from ids where k = 'bundle'),
    'partner', 'pending_payment'
  )
  returning id
)
insert into ids select 'control_order', id from new_order;

insert into results select 'bundling never changes the lab order''s own price',
  (select total_kobo::text || '/' || payable_kobo::text from public.lab_orders
    where id = (select v from ids where k = 'control_order')),
  (select total_kobo::text || '/' || payable_kobo::text from public.lab_orders
    where id = (select v from ids where k = 'bundled_order'));

-- A spoofed insert: client-supplied amount_minor/status/origin, exactly what
-- a forged request would try. private.pin_video_visit_amount() must still
-- override every one of these, same as it did before this feature existed.
with new_request as (
  insert into public.video_visit_requests
    (organisation_id, patient_id, slot_id, source_lab_order_id, amount_minor, status, origin)
  values (
    (select v from ids where k = 'org'),
    (select v from ids where k = 'patient'),
    (select v from ids where k = 'slot'),
    (select v from ids where k = 'bundled_order'),
    1, 'accepted', 'staff_scheduled'
  )
  returning id
)
insert into ids select 'bundled_request', id from new_request;

insert into results select 'bundled request is priced from video_visit_prices, not the insert',
  (select amount_minor > 1 and status = 'requested' and origin = 'patient_initiated' and currency is not null
     from public.video_visit_requests where id = (select v from ids where k = 'bundled_request'))::text,
  'true';

insert into results select 'bundled request keeps its source_lab_order_id linkage',
  (select v from ids where k = 'bundled_order')::text,
  (select source_lab_order_id::text from public.video_visit_requests
    where id = (select v from ids where k = 'bundled_request'));

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Webhook fan-out simulation: one charge reference confirms both rows,
-- neither row's own amount is touched by the other.
------------------------------------------------------------------
do $$
declare
  v_ref text := 'test_ref_' || gen_random_uuid()::text;
  v_lab_before bigint;
  v_visit_before bigint;
begin
  select total_kobo into v_lab_before from public.lab_orders
   where id = (select v from ids where k = 'bundled_order');
  select amount_minor into v_visit_before from public.video_visit_requests
   where id = (select v from ids where k = 'bundled_request');

  update public.lab_orders set pending_payment_provider_ref = v_ref
   where id = (select v from ids where k = 'bundled_order');
  update public.video_visit_requests set pending_payment_provider_ref = v_ref
   where id = (select v from ids where k = 'bundled_request');

  -- The two UPDATEs the webhook's "kind = booking" branch runs, once per
  -- matched pending_payment_provider_ref row.
  update public.lab_orders
    set status = 'payment_confirmed', payment_provider = 'paystack',
        payment_provider_ref = v_ref, pending_payment_provider_ref = null
   where pending_payment_provider_ref = v_ref;
  update public.video_visit_requests
    set status = 'payment_confirmed', payment_provider = 'paystack',
        payment_provider_ref = v_ref, pending_payment_provider_ref = null
   where pending_payment_provider_ref = v_ref;

  insert into results select 'webhook fan-out confirms both rows from one reference',
    'payment_confirmed/visit:payment_confirmed',
    (select status from public.lab_orders where id = (select v from ids where k = 'bundled_order'))
      || '/visit:' ||
    (select status from public.video_visit_requests where id = (select v from ids where k = 'bundled_request'));

  insert into results select 'confirming the bundle never changes either row''s own amount',
    v_lab_before::text || '/' || v_visit_before::text,
    (select total_kobo from public.lab_orders where id = (select v from ids where k = 'bundled_order'))::text
      || '/' ||
    (select amount_minor from public.video_visit_requests where id = (select v from ids where k = 'bundled_request'))::text;
end $$;

select count(*) filter (where expected <> actual) as failures, count(*) as total from results;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results;

rollback;

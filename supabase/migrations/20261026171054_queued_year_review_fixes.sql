-- Review fixes for the queued Membership year (code review of feat/membership-queued-year, 2026-10-26). Applies after
-- 20261026142011_membership_queued_year.sql.
--
--   1. The roll gap. The daily job meant a Plus year that had run out stayed "active, in grace" for up to a day while the paid queued
--      year waited, and the shop would let the person buy yet another year. Now (a) a small job rolls queued years every 10 minutes, and
--      (b) create_order, create_payment_request and create_request_order refuse a Membership for anyone whose next year is queued.
--   2. Deleting an order that bought a queued year no longer fails: the scheduled-row CHECK no longer demands order_id (the FK nulls it).
--   3. A refund cancels its queued year whether or not an entitlement is still active, so a refunded order can never start a free year.
--   4. The lifecycle job reports how many queued years it rolled (queued_rolled), so a roll that stops is visible.
--   5. my_entitlements hides a queued year's entitlement until it starts (it would otherwise show as a second running Membership with 400+
--      days left); my_membership already reports it as next_starts_at.
-- Known and left (OQ-QUEUED-1): an early activation (the Plus year refunded or ended) moves the queued row's start earlier, but a revenue
--   schedule already built keeps the later start. No rebase API exists in finance; the amount is small and only timing.
-- ROLLBACK: restore the patched functions from the previous migration, unschedule the job, restore the CHECK.

-- 2
alter table public.patient_memberships drop constraint patient_memberships_scheduled_shape;
alter table public.patient_memberships add constraint patient_memberships_scheduled_shape check (state <> 'scheduled' or ends_at is not null);

drop function if exists pg_temp.patch_fn(regprocedure, text[], integer[]);
create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[]) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    if n <> 1 then raise exception 'queued-year review-fix patch of % expected 1 match for [%], found %', p_sig, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

-- 1b. no second purchase while the next year waits
select pg_temp.patch_fn('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure, array[
  $p$m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())$p$,
  $p$m.patient_id = v_ben and ((m.state = 'active' and (m.ends_at is null or m.ends_at > now())) or m.state = 'scheduled')$p$]);
select pg_temp.patch_fn(p.oid::regprocedure, array[
  $p$m.patient_id = v_ben and m.state = 'active' and (m.ends_at is null or m.ends_at > now())$p$,
  $p$m.patient_id = v_ben and ((m.state = 'active' and (m.ends_at is null or m.ends_at > now())) or m.state = 'scheduled')$p$])
  from pg_proc p where p.proname = 'create_payment_request' and p.pronamespace = 'public'::regnamespace;
select pg_temp.patch_fn(p.oid::regprocedure, array[
  $p$m.patient_id = pr.beneficiary_id and m.state = 'active' and (m.ends_at is null or m.ends_at$p$,
  $p$m.patient_id = pr.beneficiary_id and ((m.state = 'active' and (m.ends_at is null or m.ends_at > now())) or m.state = 'scheduled') and (m.ends_at is null or m.ends_at$p$])
  from pg_proc p where p.proname = 'create_request_order' and p.pronamespace = 'public'::regnamespace;

-- 3. the cancel no longer depends on an entitlement
select pg_temp.patch_fn('public.decide_order_refund(uuid,boolean,text)'::regprocedure, array[
  $p$  if e.id is not null then
    -- a year that is still queued (not started) is cancelled on its own: the running membership belongs to another order and is not touched
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Queued Membership year refunded (refund ' || p_refund || ')'
     where order_id = o.id and state = 'scheduled';
    if not found then
      for m in select id from public.patient_memberships
                where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
        v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
      end loop;
    end if;
  end if;$p$,
  $p$  -- a year that is still queued (not started) is cancelled on its own, whether or not an entitlement is still active: the running
  -- membership belongs to another order and is not touched, and a refunded order must never start a year later
  update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Queued Membership year refunded (refund ' || p_refund || ')'
   where order_id = o.id and state = 'scheduled';
  if e.id is not null and not found then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;$p$]);

-- 4. the job reports the roll
select pg_temp.patch_fn('private.run_membership_lifecycle()'::regprocedure, array[
  $p$declare v_rem integer; v_lapsed integer; v_seats integer;$p$,
  $p$declare v_rem integer; v_lapsed integer; v_seats integer; v_rolled integer;$p$,
  $p$  perform private.roll_queued_membership_years();$p$,
  $p$  v_rolled := private.roll_queued_membership_years();$p$,
  $p$jsonb_build_object('reminders', v_rem, 'lapsed', v_lapsed, 'seats_started', v_seats)$p$,
  $p$jsonb_build_object('reminders', v_rem, 'lapsed', v_lapsed, 'seats_started', v_seats, 'queued_rolled', v_rolled)$p$]);

-- 5. a queued entitlement is not a running one
select pg_temp.patch_fn('public.my_entitlements()'::regprocedure, array[
  $p$where e.patient_id = (select auth.uid())$p$,
  $p$where e.patient_id = (select auth.uid()) and not (e.kind = 'membership' and e.starts_at > now())$p$]);

-- 1a. roll queued years every ten minutes, not once a day
do $$
begin
  perform cron.unschedule(jobname) from cron.job where jobname = 'membership-queued-roll';
  perform cron.schedule('membership-queued-roll', '*/10 * * * *', $c$select private.roll_queued_membership_years()$c$);
  if (select count(*) from cron.job where jobname = 'membership-queued-roll') <> 1 then raise exception 'queued-year review fixes: the roll job was not scheduled'; end if;
end $$;

do $$
begin
  if pg_get_functiondef('public.create_order(text,uuid,uuid,text,boolean,bigint)'::regprocedure) not ilike '%m.state = ''scheduled''%'
     or pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure) not ilike '%whether or not an entitlement%'
     or pg_get_functiondef('private.run_membership_lifecycle()'::regprocedure) not ilike '%queued_rolled%'
     or pg_get_functiondef('public.my_entitlements()'::regprocedure) not ilike '%e.starts_at > now()%' then
    raise exception 'queued-year review fixes: a patched function does not carry the change';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'create_payment_request' and p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ilike '%m.state = ''scheduled''%') then
    raise exception 'queued-year review fixes: create_payment_request does not refuse a queued year';
  end if;
  if not exists (select 1 from pg_proc p where p.proname = 'create_request_order' and p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) ilike '%m.state = ''scheduled''%') then
    raise exception 'queued-year review fixes: create_request_order does not refuse a queued year';
  end if;
end $$;

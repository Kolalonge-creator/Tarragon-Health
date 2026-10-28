-- Queued Membership year (founder decision 2026-10-26, chosen over "keep Plus" and "refund instead").
--
-- THE CASE. A Membership (no annual panel) payment, or an accepted Membership gift, lands on a person whose Plus year is still running
-- (create_order refuses a purchase while a membership runs, so this needs a race: the order was made before they became a member).
-- Before: the Plus year was extended by 365 days and stayed Plus, so Tarragon gave Plus for a Membership price. Dropping the person to
-- Membership at once would take away a panel they paid for. NOW: the Membership year is QUEUED. It starts the moment the Plus year ends.
-- Nobody loses what they paid for, and nobody gets more than they paid for.
--
-- WHAT IT DOES
--   1. patient_memberships gains the state 'scheduled' and the column order_id (the order that bought a queued year). A scheduled row is
--      invisible to every reader that filters state = 'active' (audited: 36 functions mention patient_memberships; the ones without that
--      filter only take min(starts_at) or an earliest row, which a later queued row cannot change).
--   2. private.membership_queue_applies / private.queue_membership_year: the one rule and the one insert, used by both paths that can
--      meet this case (record_order_payment and respond_to_gifted_pack). Same-tier and higher-tier payments still extend, as before.
--   3. A trigger activates the earliest queued row whenever a patient's active membership ends by ANY path (natural end, refund, admin end,
--      employer roster change). Ended early, it starts now and keeps its paid length; ended on its date, it starts on that date.
--   4. private.roll_queued_membership_years(): the daily lifecycle job ends a year whose end date has passed when a queued year waits,
--      which fires the trigger (without it the queued year would wait for the 14 day grace to run out).
--   5. Refund of a still-queued order cancels ONLY that queued row. Without this the refund would end the running Plus year.
--   6. Renewal reminders skip a person whose next year is already queued. The revenue schedule of a queued order starts on the queued
--      start date. my_membership also returns next_tier and next_starts_at.
-- Live counts before (read-only): patient_memberships with any state other than active/ended/lapsed: 0; queued purchases: 0 (new).
-- Known and left: for up to a day after a Plus year's end date, before the daily job rolls the queued year, the tier still reads plus.
-- ROLLBACK: cancel any scheduled rows, restore the patched functions from 20261021111211 / 20261026135940, drop the trigger and the two private
--   functions, drop patient_memberships.order_id, restore the state CHECK without 'scheduled'.

-- 1. state and link
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'public.patient_memberships'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) ilike '%''active''%''ended''%''lapsed''%' loop
    execute format('alter table public.patient_memberships drop constraint %I', c.conname);
  end loop;
end $$;
alter table public.patient_memberships add constraint patient_memberships_state_check check (state in ('active', 'ended', 'lapsed', 'scheduled'));
alter table public.patient_memberships add column order_id uuid references public.orders (id) on delete set null;
alter table public.patient_memberships add constraint patient_memberships_scheduled_shape
  check (state <> 'scheduled' or (order_id is not null and ends_at is not null));
create index patient_memberships_scheduled_idx on public.patient_memberships (patient_id, starts_at) where state = 'scheduled';
comment on column public.patient_memberships.order_id is 'Set only for a queued year: the order that bought it. A refund of that order cancels this row, not the running membership.';

-- 2. the rule and the insert
create function private.membership_queue_applies(p_patient uuid, p_code text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.membership_tier_for_item(p_code) = 'evergreen'
     and exists (select 1 from public.patient_memberships m
                  where m.patient_id = p_patient and m.state = 'active' and m.tier = 'plus' and m.ends_at is not null and m.ends_at > now())
$$;
revoke all on function private.membership_queue_applies(uuid, text) from public, anon, authenticated;

create function private.queue_membership_year(p_org uuid, p_patient uuid, p_order uuid, p_code text, p_days integer, p_is_test boolean)
returns timestamptz language plpgsql security definer set search_path = ''
as $$
declare v_start timestamptz; v_id uuid;
begin
  select greatest(coalesce(max(m.ends_at), now()), now()) into v_start
    from public.patient_memberships m where m.patient_id = p_patient and m.state in ('active', 'scheduled') and m.ends_at is not null;
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier, order_id)
  values (p_org, p_patient, 'purchase', 'scheduled', v_start, v_start + make_interval(days => p_days), p_is_test, private.membership_tier_for_item(p_code), p_order)
  returning id into v_id;
  perform private.log_audit('membership.year_queued', 'patient_memberships', v_id, jsonb_build_object('order_id', p_order, 'starts_at', v_start, 'code', p_code));
  return v_start;
end $$;
revoke all on function private.queue_membership_year(uuid, uuid, uuid, text, integer, boolean) from public, anon, authenticated;

-- 3. activation whenever the running membership ends, by any path
create function private.activate_queued_membership() returns trigger language plpgsql security definer set search_path = ''
as $$
declare q public.patient_memberships%rowtype; v_len interval; v_from timestamptz;
begin
  select * into q from public.patient_memberships where patient_id = new.patient_id and state = 'scheduled' order by starts_at limit 1 for update;
  if not found then return null; end if;
  v_len := q.ends_at - q.starts_at;
  v_from := least(q.starts_at, now());
  update public.patient_memberships set state = 'active', starts_at = v_from, ends_at = v_from + v_len where id = q.id;
  perform private.log_audit('membership.queued_year_started', 'patient_memberships', q.id, jsonb_build_object('after', new.id, 'starts_at', v_from));
  return null;
end $$;
revoke all on function private.activate_queued_membership() from public, anon, authenticated;
create trigger patient_memberships_activate_queued after update of state on public.patient_memberships
  for each row when (old.state = 'active' and new.state in ('ended', 'lapsed')) execute function private.activate_queued_membership();

-- 4. the daily job rolls a year that has run out when a queued year waits
create function private.roll_queued_membership_years() returns integer language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0;
begin
  for r in select m.id from public.patient_memberships m
            where m.state = 'active' and m.ends_at is not null and m.ends_at <= now()
              and exists (select 1 from public.patient_memberships q where q.patient_id = m.patient_id and q.state = 'scheduled')
            order by m.ends_at for update skip locked loop
    update public.patient_memberships set state = 'ended', ended_at = now(), end_reason = 'Year ended; the next, already paid year began'
     where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.roll_queued_membership_years() from public, anon, authenticated;

-- earlier migrations in this session leave a three-argument patch_fn in pg_temp; a two-argument call would then be ambiguous on replay
drop function if exists pg_temp.patch_fn(regprocedure, text[], integer[]);
create or replace function pg_temp.patch_fn(p_sig regprocedure, p_pairs text[]) returns void language plpgsql as $f$
declare d text := pg_get_functiondef(p_sig); i integer := 1; n integer;
begin
  while i < array_length(p_pairs, 1) loop
    n := (length(d) - length(replace(d, p_pairs[i], ''))) / length(p_pairs[i]);
    if n <> 1 then raise exception 'queued-year patch of % expected 1 match for [%], found %', p_sig, p_pairs[i], n; end if;
    d := replace(d, p_pairs[i], p_pairs[i + 1]);
    i := i + 2;
  end loop;
  execute d;
end $f$;

select pg_temp.patch_fn('private.run_membership_lifecycle()'::regprocedure, array[
  $p$  v_lapsed := private.lapse_expired_memberships();$p$,
  $p$  perform private.roll_queued_membership_years();
  v_lapsed := private.lapse_expired_memberships();$p$]);

-- 2. payment path
select pg_temp.patch_fn('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure, array[
  $p$  v_ent uuid;
$p$,
  $p$  v_ent uuid;
  v_q timestamptz;
$p$,
  $p$    if exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start)$p$,
  $p$    if private.membership_queue_applies(o.beneficiary_patient_id, it.code) then
      -- a Membership year bought by someone whose Plus year is still running starts when that year ends
      v_q := private.queue_membership_year(o.organisation_id, o.beneficiary_patient_id, o.id, it.code, it.duration_days, o.is_test);
      update public.entitlements set starts_at = v_q, ends_at = v_q + make_interval(days => it.duration_days) where id = v_ent;
    elsif exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
      update public.patient_memberships
         set ends_at = greatest(ends_at, v_start)$p$]);

-- 2. accepted gift path
select pg_temp.patch_fn('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure, array[
  $p$declare e public.entitlements%rowtype; o public.orders%rowtype; it public.catalog_items%rowtype;$p$,
  $p$declare e public.entitlements%rowtype; o public.orders%rowtype; it public.catalog_items%rowtype; v_q timestamptz;$p$,
  $p$      if exists (select 1 from public.patient_memberships where patient_id = e.patient_id and state = 'active') then
        update public.patient_memberships set ends_at = greatest(ends_at, now())$p$,
  $p$      if private.membership_queue_applies(e.patient_id, it.code) then
        v_q := private.queue_membership_year(o.organisation_id, e.patient_id, o.id, it.code, it.duration_days, o.is_test);
        update public.entitlements set starts_at = v_q, ends_at = v_q + make_interval(days => it.duration_days) where id = e.id;
      elsif exists (select 1 from public.patient_memberships where patient_id = e.patient_id and state = 'active') then
        update public.patient_memberships set ends_at = greatest(ends_at, now())$p$]);

-- 5. refund of a still-queued year cancels only that row
select pg_temp.patch_fn('public.decide_order_refund(uuid,boolean,text)'::regprocedure, array[
  $p$  if e.id is not null then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;$p$,
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
  end if;$p$]);

-- 6. reminders, revenue schedule start, my_membership
select pg_temp.patch_fn('private.queue_membership_renewal_reminders()'::regprocedure, array[
  $p$where m.state = 'active' and m.ends_at is not null and m.ends_at > now()$p$,
  $p$where m.state = 'active' and m.ends_at is not null and m.ends_at > now()
       and not exists (select 1 from public.patient_memberships q where q.patient_id = m.patient_id and q.state = 'scheduled')$p$]);

select pg_temp.patch_fn('private.post_order_to_ledger(uuid,boolean)'::regprocedure, array[
  $p$v_gross, v_date, v_date + case when it.code = 'membership_upgrade_plus'$p$,
  $p$v_gross, coalesce((select (m.starts_at at time zone 'Africa/Lagos')::date from public.patient_memberships m where m.order_id = o.id), v_date),
      coalesce((select (m.starts_at at time zone 'Africa/Lagos')::date from public.patient_memberships m where m.order_id = o.id), v_date) + case when it.code = 'membership_upgrade_plus'$p$]);

select pg_temp.patch_fn('public.my_membership()'::regprocedure, array[
  $p$'grace_ends_at', case when m.ends_at is null then null else m.ends_at + make_interval(days => v_grace) end);$p$,
  $p$'grace_ends_at', case when m.ends_at is null then null else m.ends_at + make_interval(days => v_grace) end,
    'next_tier', (select q.tier from public.patient_memberships q where q.patient_id = v_uid and q.state = 'scheduled' order by q.starts_at limit 1),
    'next_starts_at', (select q.starts_at from public.patient_memberships q where q.patient_id = v_uid and q.state = 'scheduled' order by q.starts_at limit 1));$p$]);

do $$
begin
  if pg_get_functiondef('public.record_order_payment(text,bigint,bigint,bigint,text,text,text,text,timestamptz,jsonb,bigint)'::regprocedure) not ilike '%queue_membership_year%'
     or pg_get_functiondef('public.respond_to_gifted_pack(uuid,boolean)'::regprocedure) not ilike '%queue_membership_year%'
     or pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure) not ilike '%state = ''scheduled''%'
     or pg_get_functiondef('private.run_membership_lifecycle()'::regprocedure) not ilike '%roll_queued_membership_years%'
     or pg_get_functiondef('private.queue_membership_renewal_reminders()'::regprocedure) not ilike '%scheduled%'
     or pg_get_functiondef('private.post_order_to_ledger(uuid,boolean)'::regprocedure) not ilike '%m.order_id = o.id%'
     or pg_get_functiondef('public.my_membership()'::regprocedure) not ilike '%next_starts_at%' then
    raise exception 'queued year: a patched function does not carry the change';
  end if;
  if exists (select 1 from public.patient_memberships where state = 'scheduled') then raise exception 'queued year: a scheduled row exists before any purchase'; end if;
  if has_function_privilege('anon', 'private.queue_membership_year(uuid,uuid,uuid,text,integer,boolean)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.roll_queued_membership_years()', 'EXECUTE') then raise exception 'queued year: a private function is callable by a client role'; end if;
end $$;

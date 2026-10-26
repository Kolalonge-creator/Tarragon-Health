-- Proof: the queued Membership year (migration *_membership_queued_year.sql). Raises on any failed check. One rolled-back transaction.
--   1. A Membership payment onto a running Plus year QUEUES a year: the Plus year, its tier and its end date are untouched; a scheduled row
--      starts when the Plus year ends and lasts the paid length; the entitlement carries the queued dates; the person is still a Member and still Plus.
--   2. Same-tier and higher-tier payments still extend (Plus on Plus; Plus on Membership flips to Plus).
--   3. When the Plus year runs out the daily job rolls it: the queued year becomes the active one on the old end date, with follow-up months.
--   4. When the Plus year ends EARLY (any path) the queued year starts now and keeps its paid length.
--   5. Refunding a still-queued order cancels only that row: the running Plus year is untouched.
--   6. The renewal reminder skips a person whose next year is already queued.
--   SABOTAGE: (a) the activation trigger dropped, (b) the refund cancel clause disabled: checks 4 and 5 must flip.
begin;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'qy-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, '00000000-0000-0000-0000-000000000001', p_role::public.user_role, 'QY ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as $f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.mkorder(p_user uuid, p_code text) returns text language plpgsql as $f$
declare it uuid; pr uuid; amt bigint; ref text := 'qyo_' || replace(gen_random_uuid()::text, '-', '');
begin
  select id into it from public.catalog_items where code = p_code order by created_at limit 1;
  select id, amount_kobo into pr, amt from public.prices where catalog_item_id = it and valid_to is null;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test, list_amount_kobo)
  values (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', p_user, p_user, it, pr, amt, ref, true, amt);
  return ref;
end $f$;
create function pg_temp.pay(p_ref text) returns jsonb language plpgsql as $f$ declare r text; amt bigint;
begin
  select amount_kobo into amt from public.orders where paystack_reference = p_ref;
  r := pg_temp.svc(format($q$select public.record_order_payment(%L, %s, 0, %s, 'NGN', 'success', 'webhook', %L, now(), '{}'::jsonb)::text$q$, p_ref, amt, amt, 'evt-' || p_ref));
  if r like 'ERR:%' then raise exception 'payment call failed: %', r; end if;
  return r::jsonb;
end $f$;
-- a patient with a running Plus year (100 days in, 265 left), and an Membership order paid onto it. Returns the patient id.
create function pg_temp.queued_patient(p_label text) returns uuid language plpgsql as $f$
declare p uuid := pg_temp.mkuser(p_label, 'patient'); j jsonb;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', p, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'plus');
  j := pg_temp.pay(pg_temp.mkorder(p, 'membership_annual_no_panel'));
  if j ->> 'result' <> 'paid' then raise exception 'FAIL queued_patient payment: %', j; end if;
  return p;
end $f$;

create temp table fx(k text primary key, v text) on commit drop;
grant all on fx to public;
do $$ begin insert into fx values ('ad', pg_temp.mkuser('admin', 'admin')::text); end $$;

-- 1. queue
do $$
declare p uuid := pg_temp.queued_patient('q1'); a public.patient_memberships; s public.patient_memberships; e record; ends_before timestamptz;
begin
  select * into a from public.patient_memberships where patient_id = p and state = 'active';
  select * into s from public.patient_memberships where patient_id = p and state = 'scheduled';
  if a.id is null or a.tier <> 'plus' then raise exception 'FAIL the running Plus year was changed'; end if;
  if abs(extract(epoch from (a.ends_at - (now() + interval '265 days')))) > 5 then raise exception 'FAIL the running Plus year was extended or shortened: %', a.ends_at; end if;
  if s.id is null then raise exception 'FAIL no queued year was made'; end if;
  if s.tier <> 'evergreen' or s.order_id is null then raise exception 'FAIL queued row shape: tier %, order %', s.tier, s.order_id; end if;
  if s.starts_at <> a.ends_at then raise exception 'FAIL the queued year does not start when the Plus year ends: % vs %', s.starts_at, a.ends_at; end if;
  if s.ends_at - s.starts_at <> interval '365 days' then raise exception 'FAIL queued length %', s.ends_at - s.starts_at; end if;
  select en.starts_at, en.ends_at into e from public.entitlements en where en.order_id = s.order_id;
  if e.starts_at is distinct from s.starts_at or e.ends_at is distinct from s.ends_at then raise exception 'FAIL the entitlement does not carry the queued dates'; end if;
  if not private.patient_is_member(p) then raise exception 'FAIL the person stopped being a Member'; end if;
  if private.patient_membership_tier(p) <> 'plus' then raise exception 'FAIL the tier is not plus while the Plus year runs'; end if;
  declare j jsonb;
  begin
    j := pg_temp.q_as(p, 'select public.my_membership()::text')::jsonb;
    if j ->> 'tier' <> 'plus' or j ->> 'next_tier' <> 'evergreen' or (j ->> 'next_starts_at')::timestamptz is distinct from s.starts_at then
      raise exception 'FAIL my_membership does not show the running Plus year and the queued Membership year: %', j;
    end if;
  end;
end $$;

-- 2. same and higher tier still extend
do $$
declare pp uuid := pg_temp.mkuser('q2-plus', 'patient'); pe uuid := pg_temp.mkuser('q2-eg', 'patient'); j jsonb; e0 timestamptz;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', pp, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'plus'),
         ('00000000-0000-0000-0000-000000000001', pe, 'purchase', 'active', now() - interval '100 days', now() + interval '265 days', true, 'evergreen');
  select ends_at into e0 from public.patient_memberships where patient_id = pp and state = 'active';
  j := pg_temp.pay(pg_temp.mkorder(pp, 'membership_annual'));
  if exists (select 1 from public.patient_memberships where patient_id = pp and state = 'scheduled') then raise exception 'FAIL Plus on Plus was queued'; end if;
  if (select ends_at from public.patient_memberships where patient_id = pp and state = 'active') <> e0 + interval '365 days' then raise exception 'FAIL Plus on Plus did not extend'; end if;
  j := pg_temp.pay(pg_temp.mkorder(pe, 'membership_annual'));
  if exists (select 1 from public.patient_memberships where patient_id = pe and state = 'scheduled') then raise exception 'FAIL Plus on Membership was queued'; end if;
  if (select tier from public.patient_memberships where patient_id = pe and state = 'active') <> 'plus' then raise exception 'FAIL Plus on Membership did not flip to plus'; end if;
end $$;

-- 3. roll at the natural end
do $$
declare p uuid := pg_temp.queued_patient('q3'); old_id uuid; new_id uuid; v_end timestamptz := now() - interval '1 day'; n integer; fu integer;
begin
  select id into old_id from public.patient_memberships where patient_id = p and state = 'active';
  -- the Plus year ran out yesterday (still inside the grace); the queued year was set to start on that date
  update public.patient_memberships set ends_at = v_end where id = old_id;
  update public.patient_memberships set starts_at = v_end, ends_at = v_end + interval '365 days' where patient_id = p and state = 'scheduled';
  n := private.roll_queued_membership_years();
  if n < 1 then raise exception 'FAIL the daily job rolled nothing'; end if;
  if (select state from public.patient_memberships where id = old_id) <> 'ended' then raise exception 'FAIL the old year was not ended'; end if;
  select id into new_id from public.patient_memberships where patient_id = p and state = 'active';
  if new_id is null or new_id = old_id then raise exception 'FAIL the queued year did not become the active one'; end if;
  if (select tier from public.patient_memberships where id = new_id) <> 'evergreen' then raise exception 'FAIL the new year is not Membership'; end if;
  if (select starts_at from public.patient_memberships where id = new_id) <> v_end then raise exception 'FAIL the new year did not start on the old end date'; end if;
  if private.patient_membership_tier(p) <> 'evergreen' then raise exception 'FAIL the tier did not become evergreen'; end if;
  if not private.patient_is_member(p) then raise exception 'FAIL not a Member after the roll'; end if;
  select count(*) into fu from public.member_followup_entitlements where membership_id = new_id;
  if fu = 0 then raise exception 'FAIL the new year has no follow-up months'; end if;
  if private.roll_queued_membership_years() <> 0 then raise exception 'FAIL rolling twice changed something'; end if;
end $$;

-- 4 and 5 as scenarios (so the sabotage can re-run them)
create function pg_temp.early_end() returns text language plpgsql as $f$
declare p uuid := pg_temp.queued_patient('q4-' || substr(gen_random_uuid()::text, 1, 6)); old_id uuid; r record; ok boolean;
begin
  select id into old_id from public.patient_memberships where patient_id = p and state = 'active';
  ok := private.end_membership_now(old_id, null, 'proof: the Plus year ended early on purpose');
  if not ok then return 'end_failed'; end if;
  select state, tier, starts_at, ends_at into r from public.patient_memberships where patient_id = p and tier = 'evergreen' order by created_at desc limit 1;
  if r.state is distinct from 'active' then return 'queued_is_' || coalesce(r.state, 'missing'); end if;
  if abs(extract(epoch from (r.starts_at - now()))) > 120 then return 'wrong_start'; end if;
  if r.ends_at - r.starts_at <> interval '365 days' then return 'wrong_length'; end if;
  return 'ok';
end $f$;
create function pg_temp.refund_queued() returns text language plpgsql as $f$
declare p uuid := pg_temp.queued_patient('q5-' || substr(gen_random_uuid()::text, 1, 6)); ad uuid := (select v::uuid from fx where k = 'ad');
        oid uuid; r text; v_refund uuid; a_state text; a_tier text; s_state text;
begin
  select order_id into oid from public.patient_memberships where patient_id = p and state = 'scheduled';
  r := pg_temp.q_as(p, format($q$select public.request_order_refund(%L, 'proof refund of the queued year')::text$q$, oid));
  if r like 'ERR:%' then return 'request_' || r; end if;
  v_refund := (r::jsonb ->> 'refund_id')::uuid;
  r := pg_temp.q_as(ad, format($q$select public.decide_order_refund(%L, true, 'approved in proof')::text$q$, v_refund));
  if r like 'ERR:%' then return 'decide_' || r; end if;
  select state, tier into a_state, a_tier from public.patient_memberships where patient_id = p and tier = 'plus' order by created_at limit 1;
  select state into s_state from public.patient_memberships where order_id = oid;
  if a_state <> 'active' or a_tier <> 'plus' then return 'running_year_touched_' || a_state; end if;
  if s_state <> 'ended' then return 'queued_not_cancelled_' || s_state; end if;
  return 'ok';
end $f$;

do $$
declare x text;
begin
  x := pg_temp.early_end();
  if x <> 'ok' then raise exception 'FAIL early end of the Plus year: %', x; end if;
  x := pg_temp.refund_queued();
  if x <> 'ok' then raise exception 'FAIL refund of the queued year: %', x; end if;
end $$;

-- 6. reminders skip a queued person
do $$
declare q uuid := pg_temp.mkuser('q6-queued', 'patient'); c uuid := pg_temp.mkuser('q6-control', 'patient'); nq integer; nc integer;
begin
  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test, tier)
  values ('00000000-0000-0000-0000-000000000001', q, 'purchase', 'active', now() - interval '345 days', now() + interval '20 days', true, 'plus'),
         ('00000000-0000-0000-0000-000000000001', c, 'purchase', 'active', now() - interval '345 days', now() + interval '20 days', true, 'plus');
  perform pg_temp.pay(pg_temp.mkorder(q, 'membership_annual_no_panel'));
  perform private.queue_membership_renewal_reminders();
  select count(*) into nq from public.notifications where recipient_id = q;
  select count(*) into nc from public.notifications where recipient_id = c;
  if nc = 0 then raise exception 'FAIL fixture: the control person got no reminder, so the test proves nothing'; end if;
  if nq <> 0 then raise exception 'FAIL a person with a queued year was sent % renewal reminder(s)', nq; end if;
end $$;

-- SABOTAGE (a): no activation trigger -> an early end leaves the queued year unstarted
do $$
declare x text;
begin
  drop trigger patient_memberships_activate_queued on public.patient_memberships;
  x := pg_temp.early_end();
  if x = 'ok' then raise exception 'FAIL early-end check did not flip with the trigger dropped'; end if;
end $$;

-- SABOTAGE (b): the refund cancel clause disabled -> the refund ends the running Plus year
do $$
declare d text; x text;
begin
  d := pg_get_functiondef('public.decide_order_refund(uuid,boolean,text)'::regprocedure);
  if position('where order_id = o.id and state = ''scheduled''' in d) = 0 then raise exception 'FAIL sabotage (b) cannot apply, test is stale'; end if;
  execute replace(d, 'where order_id = o.id and state = ''scheduled''', 'where order_id = o.id and state = ''scheduled'' and false');
  x := pg_temp.refund_queued();
  if x = 'ok' then raise exception 'FAIL refund check did not flip with the cancel clause disabled'; end if;
end $$;

select 'PASS membership_queued_year' as result;
rollback;

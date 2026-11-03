-- ===========================================================================
-- Proof: inviting the payer into the Care Circle at gift acceptance (20261103230906_circle_share_with_gift_payer.sql).
--   1. Nothing is shared before the tap: accepting a gift (the real respond_to_gifted_pack) creates no membership, the payer's supporter
--      view is "not found", and the patient's offer list names the payer by first name only. A pending gift does not count.
--   2. Only a real payer: the patient cannot add a stranger; nobody can name themself; a non-patient caller is refused.
--   3. Permissions: an empty list, an unknown name and attend_consultation are refused.
--   4. The tap: an active membership with exactly the ticked permissions and the monthly report, one audit row, one in-app notice to the
--      payer; the payer's supporter view now shows the blocks. A repeat changes nothing and is not re-logged; a wider choice widens
--      (union, never narrows), logs once more, and does not notify twice. The payer drops off the offer list.
--   5. Under 18: the share is refused and the offer list is empty.
--   6. anon has no execute; the payer test is not callable by a signed-in user.
--   7. SABOTAGE (each must flip): the payer test always true (a stranger is added); the minor test always false (the under-18 patient is
--      allowed); attend_consultation added to the gift-share list (it is accepted).
-- BEGIN/ROLLBACK; mints its own fixtures. Fixture orders and entitlements are written with triggers off (session_replication_role) so
-- the proof does not depend on the checkout path, which has its own proofs.
-- ===========================================================================
begin;
create temp table gs_results (check_name text, observed text, expected text, verdict text);
grant all on gs_results to public;

create function pg_temp.mkuser(p_name text, p_dob date default date '1970-01-01') returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'gs-' || replace(v::text, '-', '') || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, v_org, 'patient'::public.user_role, p_name, '+23481' || lpad((floor(random() * 99999999))::integer::text, 8, '0'), p_dob, true)
  on conflict (id) do update set full_name = excluded.full_name, date_of_birth = excluded.date_of_birth, is_test = true;
  return v;
end $$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  execute 'set local role authenticated';
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claims', '', true);
  return r;
end $$;
create function pg_temp.share(p_pat uuid, p_payer uuid, p_perms text[], p_monthly boolean default false) returns text language sql as $$
  select pg_temp.q_as(p_pat, format('select public.share_circle_with_gift_payer(%L::uuid, %L::text[], %L::boolean)::text', p_payer, p_perms, p_monthly))
$$;
-- a paid gift order from p_payer to p_pat, its entitlement in the given acceptance state; triggers off so no checkout machinery runs
create function pg_temp.gift(p_pat uuid, p_payer uuid, p_acceptance text) returns uuid language plpgsql as $$
declare o uuid := gen_random_uuid(); e uuid := gen_random_uuid(); v_org uuid := (select organisation_id from public.profiles where id = p_pat);
        it public.catalog_items%rowtype; pr uuid;
begin
  select * into it from public.catalog_items where kind = 'membership' and grants_lead order by duration_days desc nulls last limit 1;
  select id into pr from public.prices where catalog_item_id = it.id limit 1;
  if it.id is null or pr is null then raise exception 'fixture FAIL: no membership catalog item with a price'; end if;
  set local session_replication_role = replica;
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, fee_kobo, total_kobo, state, paid_at,
                             paystack_reference, is_test)
  values (o, v_org, p_payer, p_pat, it.id, pr, 100000, 0, 100000, 'paid', now(), 'gs_' || replace(o::text, '-', ''), true);
  insert into public.entitlements (id, organisation_id, patient_id, order_id, kind, starts_at, ends_at, is_test, acceptance, decided_at)
  values (e, v_org, p_pat, o, 'membership', now(), now() + interval '365 days', true, p_acceptance,
          case when p_acceptance in ('accepted', 'declined') then now() end);
  set local session_replication_role = origin;
  return e;
end $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into gs_results values (p_name, p_actual, p_expected, case when p_actual is not distinct from p_expected then 'PASS' else 'FAIL' end) $$;
create function pg_temp.members(p_pat uuid, p_sup uuid) returns integer language sql as
$$ select count(*)::integer from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup and state = 'active' $$;
create function pg_temp.events(p_pat uuid, p_sup uuid) returns integer language sql as
$$ select count(*)::integer from public.care_access_events where patient_id = p_pat and actor_profile_id = p_sup and scope = 'care_circle'
                                 and kind in ('granted', 'permission_changed') $$;
create function pg_temp.notes(p_sup uuid) returns integer language sql as
$$ select count(*)::integer from public.notifications where recipient_id = p_sup and template = 'circle_shared_with_you' $$;

do $$
declare
  pt uuid; py uuid; st uuid; mn uuid; py2 uuid; ent uuid; r text; v_view text; v_payers jsonb; v_perms text;
  v_usual text[] := array['weekly_bp_trend', 'adherence_summary', 'appointments', 'red_alerts'];
begin
  pt := pg_temp.mkuser('Gs Patient Adaeze'); py := pg_temp.mkuser('Chinedu Okafor'); st := pg_temp.mkuser('Gs Stranger');
  mn := pg_temp.mkuser('Gs Minor'); py2 := pg_temp.mkuser('Gs Payer Two');
  -- registration is adults only, so the under-18 patient is made by changing the date of birth afterwards (not a dependant account, so
  -- the minor test, not the dependant test, is what refuses)
  -- (the adults-only registration trigger also guards a later edit, so the fixture sets it with triggers off)
  set local session_replication_role = replica;
  update public.profiles set date_of_birth = ((now() at time zone 'Africa/Lagos')::date - interval '15 years')::date where id = mn;
  set local session_replication_role = origin;

  -- 1. a PENDING gift does not count yet
  ent := pg_temp.gift(pt, py, 'pending');
  perform pg_temp.ck('1a pending gift: the offer list is empty', '[]', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text'));
  perform pg_temp.ck('1b pending gift: the payer cannot be added yet', 'ERR:42501', pg_temp.share(pt, py, v_usual));
  -- the patient accepts through the real function
  r := pg_temp.q_as(pt, format('select (public.respond_to_gifted_pack(%L::uuid, true) ->> ''result'')', ent));
  perform pg_temp.ck('1c the patient accepted the gift', 'accepted', r);
  perform pg_temp.ck('1d nothing shared before the tap: no membership', '0', pg_temp.members(pt, py)::text);
  perform pg_temp.ck('1e nothing shared before the tap: the payer''s view is not found', 'ERR:P0002',
    pg_temp.q_as(py, format('select public.circle_supporter_view(%L::uuid)::text', pt)));
  perform pg_temp.ck('1f nothing shared before the tap: no audit row, no notice', '0/0', pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  v_payers := pg_temp.q_as(pt, 'select public.circle_gift_payers()::text')::jsonb;
  perform pg_temp.ck('1g the offer names the payer by first name only', 'Chinedu/false/1',
    (v_payers -> 0 ->> 'first_name') || '/' || (v_payers -> 0 ->> 'is_member') || '/' || jsonb_array_length(v_payers)::text);
  perform pg_temp.ck('1h the offer carries the accepted entitlement', 'true', ((v_payers -> 0 -> 'entitlement_ids') ? ent::text)::text);
  perform pg_temp.ck('1i the payer sees no offer list about the patient', '[]', pg_temp.q_as(py, 'select public.circle_gift_payers()::text'));

  -- 2. only a real payer
  perform pg_temp.ck('2a the patient cannot add a stranger', 'ERR:42501', pg_temp.share(pt, st, v_usual));
  perform pg_temp.ck('2b the stranger cannot add the payer to their own circle', 'ERR:42501', pg_temp.share(st, py, v_usual));
  perform pg_temp.ck('2c the payer cannot add themself (auth.uid is the patient)', 'ERR:42501', pg_temp.share(py, py, v_usual));
  perform pg_temp.ck('2d the patient cannot name themself', 'ERR:42501', pg_temp.share(pt, pt, v_usual));
  perform pg_temp.ck('2e nothing was created by any refused call', '0/0', pg_temp.members(pt, st) || '/' || pg_temp.members(pt, py));

  -- 3. permissions
  perform pg_temp.ck('3a empty list refused', 'ERR:22023', pg_temp.share(pt, py, '{}'::text[]));
  perform pg_temp.ck('3b unknown permission refused', 'ERR:22023', pg_temp.share(pt, py, array['everything']));
  perform pg_temp.ck('3c attend_consultation is not offered here', 'ERR:22023', pg_temp.share(pt, py, array['attend_consultation']));

  -- 4. the tap: "Share the usual"
  r := pg_temp.share(pt, py, v_usual, true);
  perform pg_temp.ck('4a the share succeeds and creates a member', 'true/true', (r::jsonb ->> 'ok') || '/' || (r::jsonb ->> 'created'));
  select array_to_string(permissions, ',') || '/' || monthly_report_shared::text into v_perms from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'active';
  perform pg_temp.ck('4b exactly the ticked permissions and the monthly report', 'adherence_summary,appointments,red_alerts,weekly_bp_trend/true', v_perms);
  perform pg_temp.ck('4c one audit row, one in-app notice to the payer', '1/1', pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  perform pg_temp.ck('4d the notice is in-app and names nothing', 'in_app/{}',
    (select channel::text || '/' || payload::text from public.notifications where recipient_id = py and template = 'circle_shared_with_you' limit 1));
  v_view := pg_temp.q_as(py, format('select public.circle_supporter_view(%L::uuid)::text', pt));
  perform pg_temp.ck('4e the payer now sees the shared blocks', 'true/true', (v_view::jsonb ? 'bp_trend')::text || '/' || (v_view::jsonb ? 'appointments')::text);
  perform pg_temp.ck('4f a block not ticked is not sent', 'false', (v_view::jsonb ? 'doctor_note')::text);
  r := pg_temp.share(pt, py, v_usual, true);
  perform pg_temp.ck('4g a repeat changes nothing', 'false/1/1/1', (r::jsonb ->> 'changed') || '/' || pg_temp.members(pt, py) || '/' || pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  r := pg_temp.share(pt, py, array['doctor_note'], false);
  select array_to_string(permissions, ',') || '/' || monthly_report_shared::text into v_perms from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'active';
  perform pg_temp.ck('4h a wider choice widens, never narrows (monthly stays on)', 'adherence_summary,appointments,doctor_note,red_alerts,weekly_bp_trend/true', v_perms);
  perform pg_temp.ck('4i the widening is logged once more and not re-notified', '2/1', pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  perform pg_temp.ck('4j the payer drops off the offer list', '[]', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text'));

  -- 5. under 18
  ent := pg_temp.gift(mn, py2, 'accepted');
  perform pg_temp.ck('5a under 18: the share is refused', 'ERR:42501', pg_temp.share(mn, py2, v_usual));
  perform pg_temp.ck('5b under 18: the offer list is empty', '[]', pg_temp.q_as(mn, 'select public.circle_gift_payers()::text'));
  perform pg_temp.ck('5c under 18: no membership', '0', pg_temp.members(mn, py2)::text);

  -- 6. grants
  perform pg_temp.ck('6a anon cannot execute either function', 'false/false',
    has_function_privilege('anon', 'public.share_circle_with_gift_payer(uuid, text[], boolean)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.circle_gift_payers()', 'EXECUTE')::text);
  perform pg_temp.ck('6b the payer test is not callable by a signed-in user', 'false',
    has_function_privilege('authenticated', 'private.circle_is_accepted_gift_payer(uuid, uuid)', 'EXECUTE')::text);

  -- 7. sabotage: each block undoes itself by raising, keeping only the observed value
  begin
    create or replace function private.circle_is_accepted_gift_payer(p_patient uuid, p_payer uuid) returns boolean
      language sql stable security definer set search_path = '' as $f$ select p_payer is not null and p_payer <> p_patient $f$;
    r := pg_temp.share(pt, st, v_usual);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('7a SABOTAGE payer test removed: a stranger IS added (flips 2a)', 'true', coalesce((r like '{%')::text, 'false'));
  perform pg_temp.ck('7a after undo the stranger is still refused', 'ERR:42501', pg_temp.share(pt, st, v_usual));
  begin
    create or replace function private.circle_patient_is_minor(p_patient uuid) returns boolean
      language sql stable security definer set search_path = '' as $f$ select false $f$;
    r := pg_temp.share(mn, py2, v_usual);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('7b SABOTAGE minor test removed: the under-18 share IS allowed (flips 5a)', 'true', coalesce((r like '{%')::text, 'false'));
  begin
    create or replace function private.circle_gift_share_permissions() returns text[]
      language sql immutable set search_path = '' as $f$ select array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'doctor_note', 'pay_for_care', 'attend_consultation']::text[] $f$;
    r := pg_temp.share(pt, py, array['attend_consultation']);
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('7c SABOTAGE list widened: attend_consultation IS accepted (flips 3c)', 'true', coalesce((r like '{%')::text, 'false'));
end $$;

select verdict, check_name, observed, expected from gs_results order by verdict, check_name;
do $$
declare n integer;
begin
  select count(*) into n from gs_results where verdict <> 'PASS';
  if n > 0 then raise exception 'circle_share_with_gift_payer: % check(s) FAILED', n; end if;
  if (select count(*) from gs_results) < 30 then raise exception 'circle_share_with_gift_payer: fewer checks ran than expected'; end if;
end $$;
rollback;

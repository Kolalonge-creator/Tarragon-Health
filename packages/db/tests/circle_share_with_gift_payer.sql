-- ===========================================================================
-- Proof: inviting the payer into the Care Circle at gift acceptance (20261103230906_circle_share_with_gift_payer.sql).
--   1. Nothing is shared before the tap: accepting a gift (the real respond_to_gifted_pack) creates no membership, the payer's supporter
--      view is "not found", and the patient's offer list names the payer by first name only. A pending gift does not count.
--   2. Only a real payer: the patient cannot add a stranger; nobody can name themself; a non-patient caller is refused.
--   3. Permissions: an empty list, an unknown name and attend_consultation are refused.
--   4. The tap (Care Circle P1, founder decision D3 2026-11-04): an OFFER the payer must accept. Before they accept: no active member,
--      their view is "not found", no audit row; they are told (in-app and push, naming nothing) and see the offer by first name; the patient
--      sees it as waiting; neither a stranger nor the patient can accept it. After the payer accepts: exactly the ticked permissions and
--      the monthly report, one audit row, the patient told they joined, the payer's view shows the blocks. A repeat changes nothing; a
--      wider choice widens an existing member (union, never narrows), logs once more, and does not notify twice. The payer drops off the
--      offer list.
--   9. Declining, withdrawing and the deadline: a decline shares nothing; the patient can withdraw an unanswered offer; an offer past its
--      deadline cannot be accepted and is replaced by a fresh share. SABOTAGE: the share made active again shows the payer the blocks.
--   5. Under 18: the share is refused and the offer list is empty.
--   6. anon has no execute; the payer test is not callable by a signed-in user.
--   7. SABOTAGE (each must flip): the payer test always true (a stranger is added); the minor test always false (the under-18 patient is
--      allowed); attend_consultation added to the gift-share list (it is accepted).
--   8. "Not now" is remembered per payer: a stranger or the payer cannot write a dismissal, nobody inserts one directly, only the patient
--      reads it, a later accepted gift from the same payer does not re-open the offer, and the patient can still share deliberately.
--      SABOTAGE: circle_gift_payers without the dismissal clause offers the dismissed payer again.
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
  pt uuid; py uuid; st uuid; mn uuid; py2 uuid; py3 uuid; ent uuid; r text; v_view text; v_payers jsonb; v_perms text;
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

  -- 4. the tap: "Share the usual". Care Circle P1 (founder decision D3, 2026-11-04): the tap makes an OFFER the payer must accept.
  r := pg_temp.share(pt, py, v_usual, true);
  perform pg_temp.ck('4a the share succeeds and creates an offer', 'true/true/true', (r::jsonb ->> 'ok') || '/' || (r::jsonb ->> 'created') || '/' || (r::jsonb ->> 'offered'));
  perform pg_temp.ck('4a1 before the payer accepts: no active member, view not found, no audit row', '0/ERR:P0002/0',
    pg_temp.members(pt, py) || '/' || pg_temp.q_as(py, format('select public.circle_supporter_view(%L::uuid)::text', pt)) || '/' || pg_temp.events(pt, py));
  perform pg_temp.ck('4a2 the payer is told, in-app and push, naming nothing', '2/{}',
    pg_temp.notes(py) || '/' || (select string_agg(distinct payload::text, ',') from public.notifications where recipient_id = py and template = 'circle_shared_with_you'));
  perform pg_temp.ck('4a3 the payer sees one open offer, first name only', '1/Gs',
    jsonb_array_length(pg_temp.q_as(py, 'select public.my_circle_share_offers()::text')::jsonb) || '/' ||
    (pg_temp.q_as(py, 'select public.my_circle_share_offers()::text')::jsonb -> 0 ->> 'name'));
  perform pg_temp.ck('4a4 the patient sees it as waiting, and is not offered the payer again', 'waiting/true',
    (pg_temp.q_as(pt, 'select public.my_care_circle()::text')::jsonb -> 'offers' -> 0 ->> 'state') || '/' ||
    (pg_temp.q_as(pt, 'select public.circle_gift_payers()::text')::jsonb -> 0 ->> 'offer_pending'));
  perform pg_temp.ck('4a5 a stranger cannot accept the payer''s offer', 'ERR:P0002',
    pg_temp.q_as(st, format('select public.respond_to_circle_share_offer(%L::uuid, true)::text',
                            (select id from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'offered'))));
  perform pg_temp.ck('4a6 the patient cannot accept on the payer''s behalf', 'ERR:P0002',
    pg_temp.q_as(pt, format('select public.respond_to_circle_share_offer(%L::uuid, true)::text',
                            (select id from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'offered'))));
  perform pg_temp.ck('4a7 the payer accepts', 'true',
    pg_temp.q_as(py, format('select (public.respond_to_circle_share_offer(%L::uuid, true) ->> ''accepted'')',
                            (select id from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'offered'))));
  select array_to_string(permissions, ',') || '/' || monthly_report_shared::text into v_perms from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'active';
  perform pg_temp.ck('4b exactly the ticked permissions and the monthly report', 'adherence_summary,appointments,red_alerts,weekly_bp_trend/true', v_perms);
  perform pg_temp.ck('4c one audit row (the acceptance), no further notice to the payer', '1/2', pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  perform pg_temp.ck('4d the patient is told the payer joined', '1',
    (select count(*)::text from public.notifications where recipient_id = pt and template = 'circle_joined'));
  v_view := pg_temp.q_as(py, format('select public.circle_supporter_view(%L::uuid)::text', pt));
  perform pg_temp.ck('4e the payer now sees the shared blocks', 'true/true', (v_view::jsonb ? 'bp_trend')::text || '/' || (v_view::jsonb ? 'appointments')::text);
  perform pg_temp.ck('4f a block not ticked is not sent', 'false', (v_view::jsonb ? 'doctor_note')::text);
  r := pg_temp.share(pt, py, v_usual, true);
  perform pg_temp.ck('4g a repeat changes nothing', 'false/1/1/2', (r::jsonb ->> 'changed') || '/' || pg_temp.members(pt, py) || '/' || pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  r := pg_temp.share(pt, py, array['doctor_note'], false);
  select array_to_string(permissions, ',') || '/' || monthly_report_shared::text into v_perms from public.care_circle_members where patient_id = pt and supporter_id = py and state = 'active';
  perform pg_temp.ck('4h a wider choice widens an existing member, never narrows (monthly stays on)', 'adherence_summary,appointments,doctor_note,red_alerts,weekly_bp_trend/true', v_perms);
  perform pg_temp.ck('4i the widening is logged once more and not re-notified as an invitation', '2/2', pg_temp.events(pt, py) || '/' || pg_temp.notes(py));
  perform pg_temp.ck('4i2 an existing member is told the patient changed what they share, naming nothing', '1/{}',
    (select count(*)::text from public.notifications where recipient_id = py and template = 'circle_share_widened') || '/' ||
    (select string_agg(distinct payload::text, ',') from public.notifications where recipient_id = py and template = 'circle_share_widened'));
  perform pg_temp.ck('4j the payer drops off the offer list', '[]', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text'));
  perform pg_temp.ck('4k the answered offer is gone from the payer''s list', '[]', pg_temp.q_as(py, 'select public.my_circle_share_offers()::text'));

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

  -- 8. "Not now" is remembered per payer
  py3 := pg_temp.mkuser('Ifeoma Nwosu');
  ent := pg_temp.gift(pt, py3, 'accepted');
  perform pg_temp.ck('8a a new payer is offered', 'Ifeoma', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text')::jsonb -> 0 ->> 'first_name');
  perform pg_temp.ck('8b a stranger cannot be dismissed (nothing to remember)', 'false/0',
    pg_temp.q_as(pt, format('select public.dismiss_gift_payer_offer(%L::uuid)::text', st)) || '/' || (select count(*)::text from public.care_circle_gift_payer_dismissals where patient_id = pt));
  perform pg_temp.ck('8c the payer cannot dismiss themself from the patient''s offers', 'false/0',
    pg_temp.q_as(py3, format('select public.dismiss_gift_payer_offer(%L::uuid)::text', py3)) || '/' || (select count(*)::text from public.care_circle_gift_payer_dismissals));
  perform pg_temp.ck('8d the patient says Not now', 'true', pg_temp.q_as(pt, format('select public.dismiss_gift_payer_offer(%L::uuid)::text', py3)));
  perform pg_temp.ck('8e ... and is not asked again', '[]', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text'));
  ent := pg_temp.gift(pt, py3, 'accepted');
  perform pg_temp.ck('8f a later accepted gift from the same payer does NOT re-open the offer', '[]', pg_temp.q_as(pt, 'select public.circle_gift_payers()::text'));
  perform pg_temp.ck('8g Not now shares nothing', '0', pg_temp.members(pt, py3)::text);
  perform pg_temp.ck('8h the dismissal is the patient''s alone to read', '1/0/0',
    pg_temp.q_as(pt, 'select count(*)::text from public.care_circle_gift_payer_dismissals') || '/' ||
    pg_temp.q_as(py3, 'select count(*)::text from public.care_circle_gift_payer_dismissals') || '/' ||
    pg_temp.q_as(st, 'select count(*)::text from public.care_circle_gift_payer_dismissals'));
  perform pg_temp.ck('8i nobody writes a dismissal directly', 'ERR:42501',
    pg_temp.q_as(pt, format('insert into public.care_circle_gift_payer_dismissals (patient_id, payer_id, organisation_id) values (%L, %L, %L) returning ''ok''',
                             pt, st, (select organisation_id from public.profiles where id = pt))));
  begin
    create or replace function public.circle_gift_payers() returns jsonb
    language plpgsql stable security definer set search_path = ''
    as $f$
    declare v_uid uuid := (select auth.uid());
    begin
      if v_uid is null or private.circle_patient_is_minor(v_uid) then return '[]'::jsonb; end if;
      return coalesce((
        select jsonb_agg(jsonb_build_object('payer_id', g.payer, 'first_name', g.first_name, 'entitlement_ids', to_jsonb(g.ents),
                                            'last_gift_at', g.last_at, 'is_member', g.is_member) order by g.last_at desc)
          from (
            select o.buyer_profile_id as payer,
                   nullif(split_part(btrim(coalesce(bp.full_name, '')), ' ', 1), '') as first_name,
                   array_agg(e.id order by e.decided_at) as ents,
                   max(e.decided_at) as last_at,
                   exists (select 1 from public.care_circle_members m where m.patient_id = v_uid and m.supporter_id = o.buyer_profile_id
                              and m.state = 'active' and m.expires_at > now()) as is_member
              from public.entitlements e
              join public.orders o on o.id = e.order_id
              join public.profiles bp on bp.id = o.buyer_profile_id and bp.is_active
             where e.patient_id = v_uid and e.acceptance = 'accepted' and o.state = 'paid'
               and o.beneficiary_patient_id = v_uid and o.buyer_profile_id <> v_uid
             group by o.buyer_profile_id, bp.full_name
          ) g
         where not exists (select 1 from public.care_circle_members m
                            where m.patient_id = v_uid and m.supporter_id = g.payer and m.state = 'active' and m.expires_at > now()
                              and not (m.permissions <@ array['pay_for_care', 'attend_consultation']::text[]))
      ), '[]'::jsonb);
    end $f$;
    r := pg_temp.q_as(pt, 'select public.circle_gift_payers()::text');
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('8k SABOTAGE dismissal ignored: the dismissed payer IS offered again (flips 8f)', 'true', (r like '%' || py3::text || '%')::text);
  perform pg_temp.ck('8j the patient can still choose to share later, deliberately', 'true',
    (pg_temp.share(pt, py3, array['appointments']) like '{%')::text);

  -- 9. Care Circle P1 (D3): declining, withdrawing and the deadline
  perform pg_temp.ck('9a a deliberate share is still only an offer', 'offered/0',
    (select state from public.care_circle_members where patient_id = pt and supporter_id = py3 order by created_at desc limit 1) || '/' || pg_temp.members(pt, py3));
  perform pg_temp.ck('9b the payer declines', 'false',
    pg_temp.q_as(py3, format('select (public.respond_to_circle_share_offer(%L::uuid, false) ->> ''accepted'')',
                             (select id from public.care_circle_members where patient_id = pt and supporter_id = py3 and state = 'offered'))));
  perform pg_temp.ck('9c declined: nothing shared, view not found, no offer left', '0/ERR:P0002/[]',
    pg_temp.members(pt, py3) || '/' || pg_temp.q_as(py3, format('select public.circle_supporter_view(%L::uuid)::text', pt)) || '/' ||
    pg_temp.q_as(py3, 'select public.my_circle_share_offers()::text'));
  r := pg_temp.share(pt, py3, array['appointments']);
  v_perms := pg_temp.q_as(pt, format('select public.withdraw_circle_share_offer(%L::uuid)::text', (r::jsonb ->> 'member_id')));
  perform pg_temp.ck('9d the patient withdraws a new offer before it is answered', 'true/withdrawn',
    v_perms || '/' || (select state from public.care_circle_members where id = (r::jsonb ->> 'member_id')::uuid));
  perform pg_temp.ck('9e a withdrawn offer cannot be accepted', 'ERR:P0002',
    pg_temp.q_as(py3, format('select public.respond_to_circle_share_offer(%L::uuid, true)::text', (r::jsonb ->> 'member_id'))));
  r := pg_temp.share(pt, py3, array['appointments']);
  update public.care_circle_members set expires_at = now() - interval '1 minute' where id = (r::jsonb ->> 'member_id')::uuid;
  perform pg_temp.ck('9f an offer past its deadline cannot be accepted, and is not listed', 'ERR:P0002/[]',
    pg_temp.q_as(py3, format('select public.respond_to_circle_share_offer(%L::uuid, true)::text', (r::jsonb ->> 'member_id'))) || '/' ||
    pg_temp.q_as(py3, 'select public.my_circle_share_offers()::text'));
  v_perms := (pg_temp.share(pt, py3, array['appointments']) like '{%')::text;
  perform pg_temp.ck('9g a fresh share after a lapsed offer makes a new one, and the lapsed one is closed', 'true/1/expired',
    v_perms || '/' || (select count(*)::text from public.care_circle_members where patient_id = pt and supporter_id = py3 and state = 'offered')
    || '/' || (select state from public.care_circle_members where id = (r::jsonb ->> 'member_id')::uuid));
  -- review fix: an open offer cannot be accepted once the patient's account is closed (closure ends only ACTIVE memberships)
  update public.profiles set is_active = false where id = pt;
  perform pg_temp.ck('9g2 the patient''s account closed: the open offer is not listed and cannot be accepted', '[]/ERR:P0002',
    pg_temp.q_as(py3, 'select public.my_circle_share_offers()::text') || '/' ||
    pg_temp.q_as(py3, format('select public.respond_to_circle_share_offer(%L::uuid, true)::text',
                             (select id from public.care_circle_members where patient_id = pt and supporter_id = py3 and state = 'offered'))));
  update public.profiles set is_active = true where id = pt;
  perform pg_temp.ck('9g3 the history names the withdrawal and the lapse for what they were', 'true/true',
    exists (select 1 from public.care_circle_permission_history where patient_id = pt and supporter_id = py3 and 'withdrawn' = any (changes))::text || '/' ||
    exists (select 1 from public.care_circle_permission_history where patient_id = pt and supporter_id = py3 and 'offer_lapsed' = any (changes))::text);
  perform pg_temp.ck('9h anon cannot execute the offer functions', 'false/false/false',
    has_function_privilege('anon', 'public.respond_to_circle_share_offer(uuid, boolean)', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.my_circle_share_offers()', 'EXECUTE')::text || '/' ||
    has_function_privilege('anon', 'public.withdraw_circle_share_offer(uuid)', 'EXECUTE')::text);
  -- SABOTAGE: the share made active again (the pre-D3 behaviour). A new payer then sees the blocks without ever saying yes.
  declare d text;
  begin
    select pg_get_functiondef('public.share_circle_with_gift_payer(uuid, text[], boolean)'::regprocedure) into d;
    d := replace(d, 'v_perms, ''offered'',', 'v_perms, ''active'',');
    if d = pg_get_functiondef('public.share_circle_with_gift_payer(uuid, text[], boolean)'::regprocedure) then raise exception 'sabotage D3 did not change the function'; end if;
    execute d;
    py := pg_temp.mkuser('Gs Payer Four');
    ent := pg_temp.gift(pt, py, 'accepted');
    perform pg_temp.share(pt, py, array['appointments']);
    r := pg_temp.q_as(py, format('select public.circle_supporter_view(%L::uuid)::text', pt));
    raise exception using errcode = 'P0099';
  exception when sqlstate 'P0099' then null;
  end;
  perform pg_temp.ck('9i SABOTAGE share made active: the payer IS shown blocks without accepting (flips 4a1)', 'true', (r like '{%')::text);
end $$;

-- only failing checks are printed (a passing run prints none), plus the count of checks that held
select check_name, observed, expected from gs_results where verdict <> 'PASS' order by check_name;
select count(*) as checks_held from gs_results where verdict = 'PASS';
do $$
declare n integer;
begin
  select count(*) into n from gs_results where verdict <> 'PASS';
  if n > 0 then raise exception 'circle_share_with_gift_payer: % check(s) did not hold', n; end if;
  if (select count(*) from gs_results) < 45 then raise exception 'circle_share_with_gift_payer: fewer checks ran than expected'; end if;
end $$;
rollback;

-- S29e proof: Care Circle reach and the patient-first check-in window (migration *_s29e_care_circle_reach_and_checkin_window.sql).
-- One rolled-back transaction. Proves: expiry warnings travel by the patient's reminder channel, once per step, never to the supporter;
-- the cross-organisation rule (supporter-only accounts only, never pay_for_care, a full patient of another organisation is refused with
-- the same silent answer, paying across organisations stays refused, the supporter abroad still gets the neutral red alert); the
-- check-in window (module OFF refuses, member gate, patient told first, nobody else told inside the window, escalation after it,
-- answered requests never escalate, daily cap, pause honoured), and that a RED EVENT IS NEVER DELAYED with the module ON and a window waiting.
-- SABOTAGE (each must flip a check): the cross-organisation trigger dropped, the module gate removed, the window made to hold back a red event.


-- Two-tier: only the Membership may be on sale (catalog_items_only_membership_sellable). The order machinery under test is generic and
-- uses care-pack and consultation fixtures, so the constraint is dropped here on purpose, inside this rolled-back transaction.
alter table public.catalog_items drop constraint catalog_items_only_membership_sellable;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table fxt(k text primary key, v text) on commit drop;
grant all on fxt to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.svc(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  perform set_config('request.jwt.claim.role', 'service_role', true);
  set local role service_role;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
-- a patient-role account (patients and supporters are both role patient); a supporter-only account has receives_care false
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_support boolean default false) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's29-' || p_label || '-' || substr(v::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S29 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  -- the signup trigger puts every new account in the default organisation; the proof places it where it needs to be
  update public.profiles set organisation_id = p_org where id = v;
  if p_support then update public.profiles set receives_care = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.email_of(p_uid uuid) returns text language sql as $$ select email from auth.users where id = p_uid $$;

-- create an invite as a patient and keep its token
create function pg_temp.invite(p_pat uuid, p_kind text, p_contact text, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text; j jsonb;
begin
  r := pg_temp.q_as(p_pat, format($q$select public.create_care_circle_invite(%L, %L, 'Daughter', %L::text[])::text$q$, p_kind, p_contact, p_perms::text));
  if r like 'ERR:%' then return r; end if;
  j := r::jsonb;
  insert into fxt values ('tok-' || p_label, j ->> 'token') on conflict (k) do update set v = excluded.v;
  insert into fx values ('inv-' || p_label, (j ->> 'invite_id')::uuid) on conflict (k) do update set v = excluded.v;
  return 'ok';
end $f$;
create function pg_temp.tok(p_label text) returns text language sql as $$ select v from fxt where k = 'tok-' || p_label $$;
create function pg_temp.join_as(p_uid uuid, p_label text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.accept_care_circle_invite(%L)::text$q$, pg_temp.tok(p_label))) $$;
create function pg_temp.view_as(p_uid uuid, p_patient uuid) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.circle_supporter_view(%L)::text$q$, p_patient)) $$;
create function pg_temp.member(p_pat uuid, p_sup uuid) returns uuid language sql as
$$ select id from public.care_circle_members where patient_id = p_pat and supporter_id = p_sup order by (state = 'active') desc, created_at desc limit 1 $$;
create function pg_temp.join_with(p_pat uuid, p_sup uuid, p_perms text[], p_label text) returns text language plpgsql as
$f$ declare r text;
begin
  r := pg_temp.invite(p_pat, 'email', pg_temp.email_of(p_sup), p_perms, p_label);
  if r <> 'ok' then return r; end if;
  return pg_temp.join_as(p_sup, p_label);
end $f$;

-- a fresh red triage event for a patient (a shadow event: a fixture, it never pages anyone by itself)
create function pg_temp.newte(p_patient uuid) returns uuid language plpgsql as
$f$ declare v_id uuid; v_rs record;
begin
  select id, code, version into v_rs from public.triage_rule_sets order by version desc limit 1;
  insert into public.triage_events (organisation_id, patient_id, trigger_type, trigger_id, grade, rule_id, rule_set_id, rule_set_code, rule_set_version, rule_set_status, actions, shadow, is_test, basis)
  select organisation_id, p_patient, 'observation', gen_random_uuid(), 'red', 'R1', v_rs.id, v_rs.code, v_rs.version, 'draft',
         '[{"kind":"page_on_call"}]'::jsonb, true, true, gen_random_uuid()::text from public.profiles where id = p_patient
  returning id into v_id;
  return v_id;
end $f$;
-- a root page (nobody on the rota: an escalation row at level 2) or a child of one
create function pg_temp.newpage(p_patient uuid, p_te uuid, p_parent uuid default null) returns uuid language plpgsql as
$f$ declare v_id uuid;
begin
  perform set_config('tarragon.paging_write', 'on', true);
  insert into public.pages (organisation_id, patient_id, triage_event_id, parent_page_id, role, escalation_level, config_version, is_test, no_cover)
  select organisation_id, p_patient, p_te, p_parent, 'escalation', 2, 1, true, p_parent is null from public.profiles where id = p_patient
  returning id into v_id;
  perform set_config('tarragon.paging_write', 'off', true);
  return v_id;
end $f$;



create function public.s29e_boom() returns trigger language plpgsql as $b$ begin raise exception 'proof: notification write failed'; end $b$;
create function pg_temp.fail_notify_on(p_uid uuid) returns void language plpgsql as
$f$ begin
  execute format('create trigger s29e_boom before insert on public.notifications for each row when (new.template = ''circle_check_in_unanswered'' and new.channel = ''push'' and (%L::uuid is null or new.recipient_id = %L::uuid)) execute function public.s29e_boom()', p_uid, p_uid);
end $f$;
create function pg_temp.fail_notify_off() returns void language plpgsql as
$f$ begin drop trigger s29e_boom on public.notifications; end $f$;

-- claims only (no role switch): lets a SECURITY DEFINER private function that reads auth.uid() be called from the proof session
create function pg_temp.claims(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
end $f$;
create function pg_temp.clear_claims() returns void language plpgsql as
$f$ begin perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
create function pg_temp.cnt(p_uid uuid, p_template text, p_source uuid default null, p_channel text default null) returns text language sql as
$$ select count(*)::text from public.notifications where recipient_id = p_uid and template = p_template
     and (p_source is null or source_id = p_source) and (p_channel is null or channel::text = p_channel) $$;

do $$
declare
  v_org uuid; v_org2 uuid; v_admin uuid; v_pat uuid; v_sa uuid; v_sb uuid; v_sd uuid; v_other uuid; v_sx uuid; v_sy uuid; v_pe uuid; v_se uuid; v_pp uuid; v_sp uuid; v_sz uuid;
  r text; v_mem uuid; v_ci uuid; v_pg uuid; v_ends timestamptz; n integer; v_def text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  insert into public.organisations (name, type) select 'S29e abroad proof org', type from public.organisations where id = v_org returning id into v_org2;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_sa := pg_temp.mkuser(v_org, 'sup-a', 'patient', true);   -- adherence only (no red_alerts)
  v_sb := pg_temp.mkuser(v_org, 'sup-b', 'patient', true);   -- red_alerts
  v_sd := pg_temp.mkuser(v_org, 'sup-d', 'patient', true);   -- red_alerts (second)
  v_other := pg_temp.mkuser(v_org, 'other', 'patient', true);
  v_sx := pg_temp.mkuser(v_org2, 'abroad-x', 'patient', true);  -- supporter-only, other organisation
  v_sy := pg_temp.mkuser(v_org2, 'abroad-y', 'patient', false); -- a full patient of the other organisation
  v_sz := pg_temp.mkuser(v_org2, 'abroad-z', 'patient', true);
  v_pe := pg_temp.mkuser(v_org, 'patient-email', 'patient');
  v_se := pg_temp.mkuser(v_org, 'sup-email', 'patient', true);
  v_pp := pg_temp.mkuser(v_org, 'patient-push', 'patient');
  v_sp := pg_temp.mkuser(v_org, 'sup-push', 'patient', true);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('sb', v_sb); perform pg_temp.setf('sx', v_sx);

  -- 1. Expiry warnings travel by the patient's own reminder channel, once per step ----------------------------------------------
  perform pg_temp.ck('E joins', 'true', (pg_temp.join_with(v_pe, v_se, array['adherence_summary'], 'e') like '%"ok": true%')::text);
  perform pg_temp.ck('P joins', 'true', (pg_temp.join_with(v_pp, v_sp, array['adherence_summary'], 'p') like '%"ok": true%')::text);
  perform pg_temp.ck('S joins (red_alerts)', 'true', (pg_temp.join_with(v_pat, v_sb, array['red_alerts'], 'b') like '%"ok": true%')::text);
  perform pg_temp.ck('S2 joins (red_alerts)', 'true', (pg_temp.join_with(v_pat, v_sd, array['red_alerts'], 'd') like '%"ok": true%')::text);
  perform pg_temp.ck('A joins (adherence only)', 'true', (pg_temp.join_with(v_pat, v_sa, array['adherence_summary'], 'a') like '%"ok": true%')::text);

  -- default patient (no email preference, no push subscription): in-app only
  v_mem := pg_temp.member(v_pat, v_sa);
  update public.care_circle_members set expires_at = now() + interval '10 days' where id = v_mem;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('default channel: the 14-day warning is in-app, once', '1', pg_temp.cnt(v_pat, 'circle_expiring', v_mem));
  perform pg_temp.ck('default channel: nothing by email', '0', pg_temp.cnt(v_pat, 'circle_expiring', v_mem, 'email'));

  -- email preference: in-app AND email, still once per step
  update public.profiles set notification_channel_preference = 'email' where id = v_pe;
  v_mem := pg_temp.member(v_pe, v_se);
  update public.care_circle_members set expires_at = now() + interval '10 days' where id = v_mem;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('email preference: the 14-day warning also goes by email, once', '1', pg_temp.cnt(v_pe, 'circle_expiring', v_mem, 'email'));
  perform pg_temp.ck('email preference: and stays in the inbox, once', '1', pg_temp.cnt(v_pe, 'circle_expiring', v_mem, 'in_app'));
  update public.care_circle_members set expires_at = now() + interval '2 days' where id = v_mem;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('email preference: the 3-day warning by email, once', '1', pg_temp.cnt(v_pe, 'circle_expiring_soon', v_mem, 'email'));
  perform pg_temp.ck('the supporter is told nothing at any step', '0', (select count(*)::text from public.notifications where recipient_id = v_se and template like 'circle_expiring%'));
  perform pg_temp.ck('warnings carry nothing but the template (INV-07)', 'true',
    (select bool_and(payload = '{}'::jsonb and content_class = 'non_clinical') from public.notifications where recipient_id = v_pe and template like 'circle_expiring%')::text);
  perform pg_temp.ck('renewal is only the patient''s tap: the supporter cannot renew', 'true',
    (pg_temp.q_as(v_se, format($q$select public.renew_care_circle_member(%L)::text$q$, v_mem)) like '%"ok": false%')::text);

  -- push subscription: in-app AND push
  insert into public.push_subscriptions (organisation_id, profile_id, endpoint, p256dh_key, auth_key) values (v_org, v_pp, 'https://push.invalid/s29e', 'k', 'a');
  v_mem := pg_temp.member(v_pp, v_sp);
  update public.care_circle_members set expires_at = now() + interval '10 days' where id = v_mem;
  perform private.expire_care_circle();
  perform pg_temp.ck('push subscriber: the 14-day warning also goes by push', '1', pg_temp.cnt(v_pp, 'circle_expiring', v_mem, 'push'));

  update public.care_circle_invites set created_at = now() - interval '3 days' where patient_id = v_pat;  -- the daily invite cap is not under test here
  -- 2. Supporters abroad: the cross-organisation rule -------------------------------------------------------------------------
  perform pg_temp.ck('invite for a supporter abroad including pay_for_care is created', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_sx), array['adherence_summary', 'weekly_bp_trend', 'red_alerts', 'pay_for_care'], 'x'));
  perform pg_temp.ck('the preview says it is across organisations and drops the payment permission', 'true,false',
    (pg_temp.q_as(v_sx, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('x'))) :: jsonb ->> 'cross_organisation') || ',' ||
    ((pg_temp.q_as(v_sx, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('x'))) :: jsonb -> 'permissions') ? 'pay_for_care')::text);
  perform pg_temp.ck('a supporter-only account abroad can join', 'true', (pg_temp.join_as(v_sx, 'x') like '%"ok": true%')::text);
  perform pg_temp.ck('and holds no payment permission', 'false', ((select 'pay_for_care' = any (permissions) from public.care_circle_members where id = pg_temp.member(v_pat, v_sx)))::text);
  perform pg_temp.ck('and keeps the others', '3', (select cardinality(permissions)::text from public.care_circle_members where id = pg_temp.member(v_pat, v_sx)));
  r := pg_temp.view_as(v_sx, v_pat);
  perform pg_temp.ck('the supporter abroad reads the weekly view', 'true', (r like '%bp_trend%' and r like '%adherence%')::text);
  perform pg_temp.ck('and the view carries no raw reading, condition or medicine field', 'false',
    (r ~* '(systolic|diastolic|"reading"|condition|medicine|diagnosis|result)')::text);
  perform pg_temp.ck('the patient can read nothing of the supporter''s profile through it', 'true',
    (pg_temp.q_as(v_sx, format($q$select count(*)::text from public.vitals_readings where patient_id = %L$q$, v_pat)) = '0')::text);
  -- the patient re-ticks payment for them: still stripped
  update public.care_circle_members set permissions = array['adherence_summary', 'pay_for_care'] where id = pg_temp.member(v_pat, v_sx);
  perform pg_temp.ck('an edit that adds pay_for_care for a supporter abroad is stripped', 'false',
    ((select 'pay_for_care' = any (permissions) from public.care_circle_members where id = pg_temp.member(v_pat, v_sx)))::text);
  begin
    update public.care_circle_members set permissions = array['pay_for_care'] where id = pg_temp.member(v_pat, v_sx);
    perform pg_temp.ck('a row left with only payment for a supporter abroad is refused', '23514', 'accepted');
  exception when check_violation then
    perform pg_temp.ck('a row left with only payment for a supporter abroad is refused', '23514', '23514');
  end;
  -- paying across organisations stays refused, with a same-organisation control
  update public.care_circle_members set permissions = array['adherence_summary', 'red_alerts'] where id = pg_temp.member(v_pat, v_sx);
  perform pg_temp.claims(v_sx);
  begin perform private.order_beneficiary_check(v_sx, v_pat); r := 'allowed'; exception when others then r := sqlerrm; end;
  perform pg_temp.clear_claims();
  perform pg_temp.ck('a supporter abroad cannot pay for the patient', 'order_beneficiary_not_allowed', r);
  perform pg_temp.ck('a payment-only invite to a supporter abroad is created', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_sz), array['pay_for_care'], 'z1'));
  perform pg_temp.ck('(and cannot be accepted: nothing but payment is on offer abroad)', 'false', (pg_temp.join_as(v_sz, 'z1') like '%"ok": true%')::text);
  perform pg_temp.ck('(and no member row exists for them)', '0', (select count(*)::text from public.care_circle_members where supporter_id = v_sz));
  perform pg_temp.ck('a full patient of another organisation cannot join (no bridge between two records)', 'ok', pg_temp.invite(v_pat, 'email', pg_temp.email_of(v_sy), array['adherence_summary'], 'y2'));
  perform pg_temp.ck('(refused, with the same silent answer)', 'false', (pg_temp.join_as(v_sy, 'y2') like '%"ok": true%')::text);
  perform pg_temp.ck('(and no member row exists for them)', '0', (select count(*)::text from public.care_circle_members where supporter_id = v_sy));
  perform pg_temp.ck('the preview for that account is the same silent no', 'true',
    (pg_temp.q_as(v_sy, format($q$select public.preview_care_circle_invite(%L)::text$q$, pg_temp.tok('y2'))) like '%"ok": false%')::text);
  -- same-organisation control: pay_for_care is kept
  perform pg_temp.ck('control: a same-organisation supporter keeps pay_for_care', 'true',
    (pg_temp.join_with(v_pat, v_other, array['pay_for_care'], 'o') like '%"ok": true%')::text);
  perform pg_temp.claims(v_other);
  begin perform private.order_beneficiary_check(v_other, v_pat); r := 'allowed'; exception when others then r := sqlerrm; end;
  perform pg_temp.clear_claims();
  perform pg_temp.ck('control: and can pay', 'allowed', r);
  -- a red event reaches the supporter abroad, neutrally
  v_pg := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('a red event reaches a supporter abroad who holds red_alerts', '1', pg_temp.cnt(v_sx, 'circle_check_in', v_pg, 'in_app'));
  perform pg_temp.ck('and the alert is neutral (empty payload)', 'true',
    (select bool_and(payload = '{}'::jsonb) from public.notifications where recipient_id = v_sx and template = 'circle_check_in' and source_id = v_pg)::text);

  -- 3. The patient-first window (NON-EMERGENCY) --------------------------------------------------------------------------------
  perform pg_temp.ck('the module ships OFF', 'false', (select is_enabled::text from public.platform_modules where key = 'care_circle_checkin_window'));
  perform pg_temp.ck('the active config carries a 5 minute window', '5',
    (select rules ->> 'checkin_window_minutes' from public.care_circle_config where is_active));
  perform pg_temp.ck('with the module off a request is refused', 'true',
    (pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat)) like '%circle_checkin_unavailable%')::text);
  perform pg_temp.ck('anon cannot request', '42501', pg_temp.try_anon(format($q$select public.request_circle_check_in(%L)$q$, v_pat)));
  perform pg_temp.ck('anon cannot answer', '42501', pg_temp.try_anon($q$select public.respond_to_circle_check_in()$q$));
  perform pg_temp.ck('the table has no direct access for the patient', 'true',
    (pg_temp.q_as(v_pat, $q$select count(*)::text from public.care_circle_check_ins$q$) like 'ERR:%permission denied%')::text);
  perform pg_temp.ck('nor for a supporter', 'true',
    (pg_temp.q_as(v_sb, $q$select count(*)::text from public.care_circle_check_ins$q$) like 'ERR:%permission denied%')::text);
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S29e proof run' where key = 'care_circle_checkin_window';

  perform pg_temp.ck('a pay-only member cannot ask', 'true', (pg_temp.q_as(v_other, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  perform pg_temp.ck('a member without red_alerts cannot ask', 'true',
    (pg_temp.q_as(v_sa, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  r := pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat));
  perform pg_temp.ck('a member with red_alerts can ask', 'true', (r like '%"ok": true%')::text);
  v_ci := (select id from public.care_circle_check_ins where patient_id = v_pat and state = 'waiting');
  perform pg_temp.ck('the window is 5 minutes', '5', (select round(extract(epoch from window_ends_at - requested_at) / 60)::text from public.care_circle_check_ins where id = v_ci));
  perform pg_temp.ck('the patient is told first, neutrally, in-app', '1', pg_temp.cnt(v_pat, 'circle_check_in_asked', v_ci, 'in_app'));
  perform pg_temp.ck('the ask carries no payload', 'true', (select bool_and(payload = '{}'::jsonb) from public.notifications where template = 'circle_check_in_asked' and source_id = v_ci)::text);
  perform pg_temp.ck('nobody in the circle is told yet', '0',
    (select count(*)::text from public.notifications where source_id = v_ci and recipient_id <> v_pat));
  perform pg_temp.ck('a second request while one waits is refused politely', 'already_waiting',
    pg_temp.q_as(v_sd, format($q$select (public.request_circle_check_in(%L) ->> 'reason')$q$, v_pat)));
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('inside the window the sweep tells nobody', '0', (select count(*)::text from public.notifications where source_id = v_ci and recipient_id <> v_pat));
  -- RED NEVER DELAYED: a root page while a window is waiting still reaches every red_alerts member at once
  v_pg := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('RED: with the module ON and a window waiting, a red event reaches B at once', '1', pg_temp.cnt(v_sb, 'circle_check_in', v_pg, 'in_app'));
  perform pg_temp.ck('RED: and by push', '1', pg_temp.cnt(v_sb, 'circle_check_in', v_pg, 'push'));
  perform pg_temp.ck('RED: and D at once', '1', pg_temp.cnt(v_sd, 'circle_check_in', v_pg, 'in_app'));
  perform pg_temp.ck('RED: critical priority, so quiet hours never hold it', 'critical',
    (select min(priority::text) from public.notifications where template = 'circle_check_in' and source_id = v_pg and recipient_id = v_sb));
  perform pg_temp.ck('RED: and the supporter abroad too', '1', pg_temp.cnt(v_sx, 'circle_check_in', v_pg, 'in_app'));
  select pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) into v_def;
  perform pg_temp.ck('RED: the red-alert function knows nothing of the window (structural)', 'false', (v_def ~* 'check_in_window|care_circle_check_ins|checkin')::text);

  -- the window passes unanswered
  update public.care_circle_check_ins set window_ends_at = now() - interval '1 second' where id = v_ci;
  perform private.sweep_circle_check_ins();
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('after the window the request is escalated', 'escalated', (select state from public.care_circle_check_ins where id = v_ci));
  perform pg_temp.ck('B is told once (in-app)', '1', pg_temp.cnt(v_sb, 'circle_check_in_unanswered', v_ci, 'in_app'));
  perform pg_temp.ck('B is told once (push)', '1', pg_temp.cnt(v_sb, 'circle_check_in_unanswered', v_ci, 'push'));
  perform pg_temp.ck('D is told once', '1', pg_temp.cnt(v_sd, 'circle_check_in_unanswered', v_ci, 'in_app'));
  perform pg_temp.ck('a member without red_alerts is not told', '0', pg_temp.cnt(v_sa, 'circle_check_in_unanswered', v_ci));
  perform pg_temp.ck('the circle notice is neutral (empty payload, non-clinical) and critical, so quiet hours cannot hold the escalation', 'true',
    (select bool_and(payload = '{}'::jsonb and content_class = 'non_clinical' and priority = 'critical') from public.notifications where template = 'circle_check_in_unanswered' and source_id = v_ci)::text);
  perform pg_temp.ck('the patient''s ask is routine, so it never enters the critical follow-up ladder (a stale question 40 minutes later)', 'routine',
    (select min(priority::text) from public.notifications where template = 'circle_check_in_asked' and source_id = v_ci));
  perform pg_temp.ck('and in-app is never held by quiet hours', '1', pg_temp.cnt(v_pat, 'circle_check_in_asked', v_ci, 'in_app'));
  perform pg_temp.ck('the supporter sees WHO did not answer (name only), so the notice is actionable', 'true',
    ((pg_temp.q_as(v_sb, $q$select public.circle_unanswered_check_ins()::text$q$)) like '%S29 patient%' and (pg_temp.q_as(v_sb, $q$select public.circle_unanswered_check_ins()::text$q$)) not like '%reading%')::text);
  perform pg_temp.ck('a member without red_alerts sees nobody', '[]', pg_temp.q_as(v_sa, $q$select public.circle_unanswered_check_ins()::text$q$));
  perform pg_temp.ck('a member without red_alerts cannot mark it called', 'true',
    (pg_temp.q_as(v_sa, format($q$select public.circle_ack_unanswered(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  perform pg_temp.ck('"I called them" clears it for that supporter only', 'true,true',
    ((pg_temp.q_as(v_sb, format($q$select public.circle_ack_unanswered(%L)::text$q$, v_pat)) = 'true')::text) || ',' ||
    ((pg_temp.q_as(v_sb, $q$select public.circle_unanswered_check_ins()::text$q$) = '[]')::text));
  perform pg_temp.ck('and tapping again is still a clean true (already marked)', 'true', pg_temp.q_as(v_sb, format($q$select public.circle_ack_unanswered(%L)::text$q$, v_pat)));
  perform pg_temp.ck('and the other supporter still sees it', 'true',
    (pg_temp.q_as(v_sd, $q$select public.circle_unanswered_check_ins()::text$q$) like '%S29 patient%')::text);

  -- answered inside the window: nobody is told
  r := pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat));
  v_ci := (select id from public.care_circle_check_ins where patient_id = v_pat and state = 'waiting');
  perform pg_temp.ck('a second request later is allowed', 'true', (r like '%"ok": true%')::text);
  perform pg_temp.ck('a supporter cannot answer for the patient', 'false', pg_temp.q_as(v_sb, $q$select public.respond_to_circle_check_in()::text$q$));
  perform pg_temp.ck('the patient answers', 'true', pg_temp.q_as(v_pat, $q$select public.respond_to_circle_check_in()::text$q$));
  update public.care_circle_check_ins set window_ends_at = now() - interval '1 second' where id = v_ci;
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('an answered request is never escalated', 'answered', (select state from public.care_circle_check_ins where id = v_ci));
  perform pg_temp.ck('and nobody in the circle was told', '0', (select count(*)::text from public.notifications where source_id = v_ci and recipient_id <> v_pat));

  -- the access log records what was stored: a supporter abroad was offered pay_for_care and never got it
  perform pg_temp.ck('the access log for a supporter abroad never claims a payment permission they do not hold', 'false',
    (select coalesce(bool_or(metadata::text like '%pay_for_care%'), false)::text from public.care_access_events
      where patient_id = v_pat and subject_profile_id = v_sx and kind in ('granted', 'permission_changed') and scope = 'care_circle'));

  -- one member's failure does not undo the others' notices: D's push fails, B (and the asker) are still told and the request escalates
  delete from public.care_circle_check_ins where patient_id = v_pat;
  insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, window_ends_at, is_test)
    select organisation_id, v_pat, v_sb, now() - interval '1 second', true from public.profiles where id = v_pat;
  v_ci := (select id from public.care_circle_check_ins where patient_id = v_pat and state = 'waiting');
  perform pg_temp.fail_notify_on(v_sd);
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('partial failure: the request still escalates', 'escalated', (select state from public.care_circle_check_ins where id = v_ci));
  perform pg_temp.ck('partial failure: the healthy member is told', '2', pg_temp.cnt(v_sb, 'circle_check_in_unanswered', v_ci));
  perform pg_temp.ck('partial failure: the failing member has none and an incident is open', 'true',
    (pg_temp.cnt(v_sd, 'circle_check_in_unanswered', v_ci) = '0' and exists (select 1 from public.ops_incidents where title like 'A Care Circle check-in could not reach one member%'))::text);
  perform pg_temp.fail_notify_off();

  -- every member fails: retried, then marked failed after three tries (not left blocking), and the asker is told in-app
  delete from public.care_circle_check_ins where patient_id = v_pat;
  insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, window_ends_at, is_test)
    select organisation_id, v_pat, v_sb, now() - interval '1 second', true from public.profiles where id = v_pat;
  v_ci := (select id from public.care_circle_check_ins where patient_id = v_pat and state = 'waiting');
  perform pg_temp.fail_notify_on(null);
  perform private.sweep_circle_check_ins();
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('total failure is retried', 'waiting,2', (select state || ',' || attempts from public.care_circle_check_ins where id = v_ci));
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('and after three tries it is marked failed, not left blocking', 'failed', (select state from public.care_circle_check_ins where id = v_ci));
  perform pg_temp.ck('the asker is told in-app that it could not be passed on (so they can call themselves)', '1', pg_temp.cnt(v_sb, 'circle_check_in_unanswered', v_ci, 'in_app'));
  perform pg_temp.ck('and the other member has none', '0', pg_temp.cnt(v_sd, 'circle_check_in_unanswered', v_ci));
  perform pg_temp.fail_notify_off();
  perform pg_temp.ck('so a new request is possible again', 'true',
    (pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat)) like '%"ok": true%')::text);

  -- the daily cap (3): three answered requests inside a day, then the fourth is refused
  update public.care_circle_check_ins set state = 'answered', resolved_at = now() where patient_id = v_pat and state in ('waiting', 'escalated');
  delete from public.care_circle_check_ins where patient_id = v_pat;
  for n in 1..3 loop
    insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, state, window_ends_at, resolved_at, is_test)
      select organisation_id, v_pat, v_sb, 'answered', now(), now(), true from public.profiles where id = v_pat;
  end loop;
  perform pg_temp.ck('a fourth request inside a day hits the cap', 'limit', pg_temp.q_as(v_sb, format($q$select (public.request_circle_check_in(%L) ->> 'reason')$q$, v_pat)));

  -- a pause of check-in requests: refused to ask, and a request already waiting ends without telling anyone
  delete from public.care_circle_check_ins where patient_id = v_pat;
  perform pg_temp.ck('the patient pauses check-in requests', 'true', (pg_temp.q_as(v_pat, $q$select public.pause_care_circle(true)::text$q$) like '%paused_until%')::text);
  perform pg_temp.ck('a paused circle cannot be asked', 'true',
    (pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  perform pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat));
  v_ci := (select id from public.care_circle_check_ins where patient_id = v_pat and state = 'waiting');
  perform pg_temp.q_as(v_pat, $q$select public.pause_care_circle(true)::text$q$);
  update public.care_circle_check_ins set window_ends_at = now() - interval '1 second' where id = v_ci;
  perform private.sweep_circle_check_ins();
  perform pg_temp.ck('paused after asking: the request ends and nobody is told', '0',
    (select count(*)::text from public.notifications where source_id = v_ci and recipient_id <> v_pat));
  update public.care_circle_pauses set paused_from = now() - interval '10 minutes' where patient_id = v_pat;
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  update public.care_circle_check_ins set resolved_at = now() - interval '2 minutes' where id = v_ci;  -- one transaction has one clock
  perform pg_temp.ck('and after the pause ends the swept request is never shown as "did not answer"', '[]',
    pg_temp.q_as(v_sd, $q$select public.circle_unanswered_check_ins()::text$q$));
end $$;

-- ===========================================================================================================================
-- SABOTAGE: each gate removed in turn; the matching check must flip.
-- ===========================================================================================================================
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_sb uuid := pg_temp.f('sb'); v_sx uuid := pg_temp.f('sx');
  d text; r text; n integer; v_pg uuid; v_mem uuid;
begin
  v_mem := (select id from public.care_circle_members where patient_id = v_pat and supporter_id = v_sx);

  -- (a) the cross-organisation trigger dropped: pay_for_care survives for a supporter abroad
  drop trigger care_circle_members_cross_org_permissions on public.care_circle_members;
  update public.care_circle_members set permissions = array['adherence_summary', 'pay_for_care'] where id = v_mem;
  insert into results values ('sabotaged', 'a supporter abroad never holds pay_for_care', 'false',
    (select ('pay_for_care' = any (permissions))::text from public.care_circle_members where id = v_mem));

  -- (b) the module gate removed from the request function
  select pg_get_functiondef('public.request_circle_check_in(uuid)'::regprocedure) into d;
  d := replace(d, 'if not private.module_enabled(''care_circle_checkin_window'') then', 'if false then');
  if d = pg_get_functiondef('public.request_circle_check_in(uuid)'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  update public.platform_modules set is_enabled = false, enabled_at = null, enabled_by = null, activation_note = null where key = 'care_circle_checkin_window';
  execute d;
  delete from public.care_circle_check_ins where patient_id = v_pat;
  r := pg_temp.q_as(v_sb, format($q$select public.request_circle_check_in(%L)::text$q$, v_pat));
  insert into results values ('sabotaged', 'with the module off a request is refused', 'true', (r like '%circle_checkin_unavailable%')::text);

  -- (c) the window made to delay a red event: the red-alert function skips supporters while a window waits
  select pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) into d;
  d := replace(d, 'if private.circle_alerts_paused(new.patient_id) then return new; end if;',
    'if private.circle_alerts_paused(new.patient_id) then return new; end if; if exists (select 1 from public.care_circle_check_ins c where c.patient_id = new.patient_id and c.state = ''waiting'') then return new; end if;');
  if d = pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  delete from public.care_circle_check_ins where patient_id = v_pat;
  insert into public.care_circle_check_ins (organisation_id, patient_id, requested_by, window_ends_at, is_test)
    select organisation_id, v_pat, v_sb, now() + interval '5 minutes', true from public.profiles where id = v_pat;
  v_pg := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  select count(*) into n from public.notifications where template = 'circle_check_in' and source_id = v_pg and recipient_id = v_sb;
  insert into results values ('sabotaged', 'a red event is never held back by a waiting window', '1', n::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S29e proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

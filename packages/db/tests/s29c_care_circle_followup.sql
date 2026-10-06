-- S29c proof: Care Circle follow-up pack (migration *_s29c_care_circle_followup.sql). One rolled-back transaction.
-- Proves: expiry notices at 14 and 3 days, each once, reset by a renewal, never sent to the supporter; one-tap renewal is
-- patient-only and idempotent; the preview is the supporter's own builder (identical output, never logged as a look, no block that
-- was not ticked); a pause silences the view, the lists and (by choice) the check-in requests, says nothing to the supporter,
-- leaves paying alone, ends by itself and tells the patient once; alert mode drops only the push; "I called them" is one private
-- row per supporter per request; and for someone else only the full yearly Membership can be bought (also under the older grant).
-- SABOTAGE (each must flip a check): the pause removed from the one gate, the pause removed from the alert trigger, the gift rule
-- removed from create_order, the red_alerts gate removed from the acknowledgement.
begin;


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


do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_sa uuid; v_sb uuid; v_sc uuid; v_sd uuid; v_other uuid; v_plain uuid;
  r text; r2 text; n integer; v_te uuid; v_page uuid; v_item uuid; v_mem_a uuid; v_exp timestamptz; v_before integer; v_view text; v_prev text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_sa := pg_temp.mkuser(v_org, 'sup-a', 'patient', true);   -- adherence, bp, appointments
  v_sb := pg_temp.mkuser(v_org, 'sup-b', 'patient', true);   -- red_alerts
  v_sc := pg_temp.mkuser(v_org, 'sup-c', 'patient', true);   -- pay_for_care only
  v_sd := pg_temp.mkuser(v_org, 'sup-d', 'patient', true);   -- red_alerts (a second one, to prove acks are private)
  v_other := pg_temp.mkuser(v_org, 'other', 'patient', true);
  v_plain := pg_temp.mkuser(v_org, 'plain', 'patient', true);
  perform pg_temp.setf('pat', v_pat); perform pg_temp.setf('sa', v_sa); perform pg_temp.setf('sb', v_sb); perform pg_temp.setf('sc', v_sc);
  perform pg_temp.setf('sd', v_sd); perform pg_temp.setf('other', v_other); perform pg_temp.setf('org', v_org); perform pg_temp.setf('admin', v_admin);

  perform pg_temp.ck('A joins with three blocks', 'true', (pg_temp.join_with(v_pat, v_sa, array['adherence_summary', 'weekly_bp_trend', 'appointments'], 'a') like '%"ok": true%')::text);
  perform pg_temp.ck('B joins for red alerts', 'true', (pg_temp.join_with(v_pat, v_sb, array['red_alerts'], 'b') like '%"ok": true%')::text);
  perform pg_temp.ck('C joins for paying only', 'true', (pg_temp.join_with(v_pat, v_sc, array['pay_for_care'], 'c') like '%"ok": true%')::text);
  perform pg_temp.ck('D joins for red alerts', 'true', (pg_temp.join_with(v_pat, v_sd, array['red_alerts'], 'd') like '%"ok": true%')::text);
  v_mem_a := pg_temp.member(v_pat, v_sa);

  -- 1. Shape, grants, config -----------------------------------------------------------------------------------------
  perform pg_temp.ck('the new tables have RLS on', '2',
    (select count(*)::text from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('care_circle_pauses', 'care_circle_alert_acks') and c.relrowsecurity));
  perform pg_temp.ck('anon holds nothing on them', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('care_circle_pauses', 'care_circle_alert_acks') and grantee in ('anon', 'PUBLIC')));
  perform pg_temp.ck('authenticated cannot write them', '0',
    (select count(*)::text from information_schema.role_table_grants where table_schema = 'public' and table_name in ('care_circle_pauses', 'care_circle_alert_acks') and grantee = 'authenticated' and privilege_type <> 'SELECT'));
  perform pg_temp.ck('anon cannot pause', '42501', pg_temp.try_anon($q$select public.pause_care_circle()$q$));
  perform pg_temp.ck('anon cannot preview', '42501', pg_temp.try_anon($q$select public.circle_preview_permissions(array['red_alerts'])$q$));
  perform pg_temp.ck('anon cannot acknowledge an alert', '42501', pg_temp.try_anon(format($q$select public.circle_ack_alert(%L)$q$, v_pat)));
  perform pg_temp.ck('anon cannot renew', '42501', pg_temp.try_anon(format($q$select public.renew_care_circle_member(%L)$q$, v_mem_a)));
  perform pg_temp.ck('the active config is version 2 with the 14 and 3 day notices and a 7 day pause', '2,14,3,7',
    (select version::text || ',' || (rules ->> 'expiry_notice_days') || ',' || (rules ->> 'expiry_final_notice_days') || ',' || (rules ->> 'pause_days') from public.care_circle_config where is_active));
  begin
    insert into public.care_circle_config (version, is_active, effective_from, rules)
      select 96, false, current_date, jsonb_set(rules, '{expiry_final_notice_days}', '20') from public.care_circle_config where is_active;
    perform pg_temp.ck('a final notice earlier than the first is refused', '23514', 'accepted');
  exception when check_violation then
    perform pg_temp.ck('a final notice earlier than the first is refused', '23514', '23514');
  end;
  begin
    insert into public.care_circle_config (version, is_active, effective_from, rules)
      select 95, false, current_date, jsonb_set(rules, '{pause_days}', '31') from public.care_circle_config where is_active;
    perform pg_temp.ck('a pause longer than 30 days is refused', '23514', 'accepted');
  exception when check_violation then
    perform pg_temp.ck('a pause longer than 30 days is refused', '23514', '23514');
  end;

  -- 2. Expiry notices (14 and 3 days) and the one-tap renewal ---------------------------------------------------------------
  update public.care_circle_members set expires_at = now() + interval '10 days' where id = v_mem_a;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('ten days out: the patient is told once', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring' and source_id = v_mem_a));
  perform pg_temp.ck('and not yet the final notice', '0',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring_soon' and source_id = v_mem_a));
  perform pg_temp.ck('the supporter is told nothing', '0',
    (select count(*)::text from public.notifications where recipient_id = v_sa and template like 'circle_expiring%'));
  perform pg_temp.ck('the notice carries nothing but the template (INV-07)', 'true',
    (select bool_and(payload = '{}'::jsonb and content_class = 'non_clinical') from public.notifications where recipient_id = v_pat and template = 'circle_expiring' and source_id = v_mem_a)::text);
  update public.care_circle_members set expires_at = now() + interval '2 days' where id = v_mem_a;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('two days out: the final notice, once', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring_soon' and source_id = v_mem_a));
  perform pg_temp.ck('and no second first-notice', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring' and source_id = v_mem_a));
  perform pg_temp.ck('a supporter cannot renew their own access', 'false',
    pg_temp.q_as(v_sa, format($q$select (public.renew_care_circle_member(%L))->>'ok'$q$, v_mem_a)));
  perform pg_temp.ck('another patient cannot renew it either', 'false',
    pg_temp.q_as(v_other, format($q$select (public.renew_care_circle_member(%L))->>'ok'$q$, v_mem_a)));
  perform pg_temp.ck('the patient renews with one tap', 'true',
    pg_temp.q_as(v_pat, format($q$select (public.renew_care_circle_member(%L))->>'ok'$q$, v_mem_a)));
  select expires_at into v_exp from public.care_circle_members where id = v_mem_a;
  perform pg_temp.ck('and gets a full year from today', 'true', (v_exp between now() + interval '364 days' and now() + interval '366 days')::text);
  perform pg_temp.q_as(v_pat, format($q$select (public.renew_care_circle_member(%L))->>'ok'$q$, v_mem_a));
  perform pg_temp.ck('renewing twice changes nothing', 'true', ((select expires_at from public.care_circle_members where id = v_mem_a) = v_exp)::text);
  perform private.expire_care_circle();
  perform pg_temp.ck('a renewed member is not noticed again until the new date is near', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring_soon' and source_id = v_mem_a));
  update public.care_circle_members set expires_at = now() + interval '9 days' where id = v_mem_a;
  perform private.expire_care_circle();
  perform pg_temp.ck('a year later the notices come round again (renewal resets them)', '2',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_expiring' and source_id = v_mem_a));
  update public.care_circle_members set expires_at = now() + interval '365 days' where id = v_mem_a;
  update public.care_circle_members set state = 'revoked', revoked_at = now() where id = pg_temp.member(v_pat, v_sd);
  perform pg_temp.ck('a revoked member cannot be renewed', 'false',
    pg_temp.q_as(v_pat, format($q$select (public.renew_care_circle_member(%L))->>'ok'$q$, pg_temp.member(v_pat, v_sd))));
  update public.care_circle_members set state = 'active', revoked_at = null where id = pg_temp.member(v_pat, v_sd);

  -- 3. Preview: the supporter's own builder, run for the patient, never a look ---------------------------------------------
  perform pg_temp.q_as(v_sa, format($q$select public.circle_supporter_view(%L)::text$q$, v_pat));
  v_view := pg_temp.view_as(v_sa, v_pat);
  select count(*) into v_before from public.care_access_events where patient_id = v_pat and kind = 'record_viewed';
  v_prev := pg_temp.q_as(v_pat, format($q$select public.circle_preview_member(%L)::text$q$, v_mem_a));
  perform pg_temp.ck('the preview is exactly what the supporter sees (plus its two preview markers)', 'true',
    ((v_prev::jsonb - 'preview' - 'alert_sample') = v_view::jsonb)::text);
  perform pg_temp.ck('the preview says it is a preview', 'true', ((v_prev::jsonb ->> 'preview') = 'true')::text);
  select count(*) into n from public.care_access_events where patient_id = v_pat and kind = 'record_viewed';
  perform pg_temp.ck('previewing is not logged as a supporter looking', 'true', (n = v_before)::text);
  perform pg_temp.ck('a supporter cannot preview', 'true',
    (pg_temp.q_as(v_sa, format($q$select public.circle_preview_member(%L)::text$q$, v_mem_a)) like '%circle_not_found%')::text);
  perform pg_temp.ck('another patient cannot preview someone else''s member', 'true',
    (pg_temp.q_as(v_other, format($q$select public.circle_preview_member(%L)::text$q$, v_mem_a)) like '%circle_not_found%')::text);
  r := pg_temp.q_as(v_pat, $q$select public.circle_preview_permissions(array['adherence_summary'], 'Son')::text$q$);
  perform pg_temp.ck('the invite preview shows only the ticked block (no blood pressure when it is not ticked)', 'true',
    (r like '%"adherence"%' and r not like '%bp_trend%' and r not like '%"appointments"%')::text);
  r := pg_temp.q_as(v_pat, $q$select public.circle_preview_permissions(array['red_alerts'])::text$q$);
  perform pg_temp.ck('a red-alert-only preview has no health block but shows the sample request', 'true',
    (r not like '%"adherence"%' and r not like '%bp_trend%' and (r::jsonb ->> 'alert_sample') = 'true')::text);
  perform pg_temp.ck('an invalid permission is refused by the preview', 'true',
    (pg_temp.q_as(v_pat, $q$select public.circle_preview_permissions(array['view_results'])::text$q$) like '%invite_permissions_invalid%')::text);
  perform pg_temp.ck('a supporter-only account cannot use the invite preview', 'true',
    (pg_temp.q_as(v_plain, $q$select public.circle_preview_permissions(array['red_alerts'])::text$q$) like '%circle_not_authorised%')::text);

  -- 4. Alerts: mode, "I called them" ----------------------------------------------------------------------------------------
  perform pg_temp.ck('with nothing open there is nothing to mark', 'false', pg_temp.q_as(v_sb, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)));
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('B gets the request in the app and as a push by default', '2',
    (select count(*)::text from public.notifications where recipient_id = v_sb and template = 'circle_check_in' and source_id = v_page));
  perform pg_temp.ck('B turns the push off', 'true', pg_temp.q_as(v_sb, format($q$select public.set_circle_alert_mode(%L, 'app_only')::text$q$, v_pat)));
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('then only the in-app request arrives', 'in_app',
    (select string_agg(channel::text, ',') from public.notifications where recipient_id = v_sb and template = 'circle_check_in' and source_id = v_page));
  perform pg_temp.ck('D, who did not, still gets both', '2',
    (select count(*)::text from public.notifications where recipient_id = v_sd and template = 'circle_check_in' and source_id = v_page));
  perform pg_temp.ck('an unknown alert mode is refused', 'true',
    (pg_temp.q_as(v_sb, format($q$select public.set_circle_alert_mode(%L, 'never')::text$q$, v_pat)) like '%circle_alert_mode_invalid%')::text);
  perform pg_temp.ck('someone not in the circle cannot set a mode', 'false', pg_temp.q_as(v_other, format($q$select public.set_circle_alert_mode(%L, 'app_only')::text$q$, v_pat)));
  perform pg_temp.ck('B sees the request as not yet called', 'false', pg_temp.q_as(v_sb, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
  perform pg_temp.ck('B marks "I called them"', 'true', pg_temp.q_as(v_sb, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)));
  perform pg_temp.ck('and the request now reads as called', 'true', pg_temp.q_as(v_sb, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
  select count(*) into n from public.care_circle_alert_acks where supporter_id = v_sb;
  perform pg_temp.q_as(v_sb, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat));
  perform pg_temp.ck('saying it twice adds nothing', 'true', ((select count(*) from public.care_circle_alert_acks where supporter_id = v_sb) = n)::text);
  perform pg_temp.ck('D still sees the request as not called: the status is private', 'false', pg_temp.q_as(v_sd, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
  perform pg_temp.ck('D cannot read B''s acknowledgement', '0', pg_temp.q_as(v_sd, 'select count(*)::text from public.care_circle_alert_acks'));
  perform pg_temp.ck('the patient cannot read it either', '0', pg_temp.q_as(v_pat, 'select count(*)::text from public.care_circle_alert_acks'));
  perform pg_temp.ck('a member without red_alerts cannot mark one', 'true',
    (pg_temp.q_as(v_sa, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  perform pg_temp.ck('a stranger cannot mark one', 'true',
    (pg_temp.q_as(v_other, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);

  -- 5. Pause all sharing ---------------------------------------------------------------------------------------------------
  perform pg_temp.ck('before the pause A reads the summary', 'true', (pg_temp.view_as(v_sa, v_pat) like '%"adherence"%')::text);
  perform pg_temp.ck('a supporter-only account cannot pause', 'true', (pg_temp.q_as(v_plain, $q$select public.pause_care_circle()::text$q$) like '%circle_not_authorised%')::text);
  r := pg_temp.q_as(v_pat, $q$select public.pause_care_circle(true)::text$q$);
  perform pg_temp.ck('the patient pauses for seven days', 'true',
    ((select paused_until from public.care_circle_pauses where patient_id = v_pat) between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour')::text);
  perform pg_temp.ck('the patient sees the pause in their own circle', 'true', (pg_temp.q_as(v_pat, 'select public.my_care_circle()::text') like '%"pause": {%')::text);
  perform pg_temp.ck('A reads nothing while paused, and the answer is the ordinary "not found"', 'true',
    (pg_temp.view_as(v_sa, v_pat) like '%circle_not_found%')::text);
  perform pg_temp.ck('A''s list no longer shows the patient', '0', pg_temp.q_as(v_sa, $q$select jsonb_array_length(public.my_supported_people())::text$q$));
  perform pg_temp.ck('a supporter cannot read the pause row', '0', pg_temp.q_as(v_sa, 'select count(*)::text from public.care_circle_pauses'));
  r := pg_temp.view_as(v_sc, v_pat);
  perform pg_temp.ck('C, who only pays, still sees the person and can pay, and nothing else', 'true',
    (r like '%"can_pay": true%' and r not like '%adherence%' and r not like '%bp_trend%')::text);
  perform pg_temp.ck('C still appears in their own list with only the pay permission', '["pay_for_care"]',
    pg_temp.q_as(v_sc, $q$select (public.my_supported_people() -> 0 -> 'permissions')::text$q$));
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('a red alert during a full pause reaches no supporter', '0',
    (select count(*)::text from public.notifications where template = 'circle_check_in' and source_id = v_page));
  perform pg_temp.ck('and the open-request list is empty for B', '0', pg_temp.q_as(v_sb, $q$select jsonb_array_length(public.circle_open_alerts())::text$q$));
  perform pg_temp.ck('B cannot mark a request while alerts are paused', 'true',
    (pg_temp.q_as(v_sb, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)) like '%circle_not_found%')::text);
  perform pg_temp.ck('the patient resumes', 'true', pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$));
  perform pg_temp.ck('A reads again', 'true', (pg_temp.view_as(v_sa, v_pat) like '%"adherence"%')::text);
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('and the next red alert reaches B and D again', '2',
    (select count(distinct recipient_id)::text from public.notifications where template = 'circle_check_in' and source_id = v_page));
  -- a pause that keeps check-in requests on
  perform pg_temp.q_as(v_pat, $q$select public.pause_care_circle(false)::text$q$);
  perform pg_temp.ck('with alerts left on, A still reads nothing', 'true', (pg_temp.view_as(v_sa, v_pat) like '%circle_not_found%')::text);
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  perform pg_temp.ck('with alerts left on, B and D are still asked to check in', '2',
    (select count(distinct recipient_id)::text from public.notifications where template = 'circle_check_in' and source_id = v_page));
  perform pg_temp.ck('and B can mark it', 'true', pg_temp.q_as(v_sb, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat)));
  -- a pause ends by itself and the patient is told once
  update public.care_circle_pauses set paused_until = now() - interval '1 minute' where patient_id = v_pat;
  perform private.expire_care_circle();
  perform private.expire_care_circle();
  perform pg_temp.ck('when the pause ends the patient is told, once', '1',
    (select count(*)::text from public.notifications where recipient_id = v_pat and template = 'circle_pause_ended'));
  perform pg_temp.ck('and A reads again', 'true', (pg_temp.view_as(v_sa, v_pat) like '%"adherence"%')::text);
  perform pg_temp.ck('and the supporters were told nothing about the pause', '0',
    (select count(*)::text from public.notifications where recipient_id in (v_sa, v_sb, v_sc, v_sd) and template = 'circle_pause_ended'));

  -- 5b. Several open requests, the default pause, and a request sent during a pause ----------------------------------------------
  declare v_p2 uuid; v_s2 uuid; v_pg uuid;
  begin
    v_p2 := pg_temp.mkuser(v_org, 'patient2', 'patient');
    v_s2 := pg_temp.mkuser(v_org, 'sup-z', 'patient', true);
    perform pg_temp.ck('Z joins for check-in requests only', 'true', (pg_temp.join_with(v_p2, v_s2, array['red_alerts'], 'z') like '%"ok": true%')::text);
    perform pg_temp.newpage(v_p2, pg_temp.newte(v_p2));
    perform pg_temp.newpage(v_p2, pg_temp.newte(v_p2));
    perform pg_temp.ck('two open requests for one person show as one card', '1', pg_temp.q_as(v_s2, $q$select jsonb_array_length(public.circle_open_alerts())::text$q$));
    perform pg_temp.ck('and it is not called yet', 'false', pg_temp.q_as(v_s2, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
    perform pg_temp.ck('one tap on "I called them"', 'true', pg_temp.q_as(v_s2, format($q$select public.circle_ack_alert(%L)::text$q$, v_p2)));
    perform pg_temp.ck('marks every open request, not just the newest', '2', (select count(*)::text from public.care_circle_alert_acks where supporter_id = v_s2));
    perform pg_temp.ck('and the card reads as called', 'true', pg_temp.q_as(v_s2, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
    -- the default pause keeps check-in requests on
    perform pg_temp.q_as(v_p2, $q$select public.pause_care_circle()::text$q$);
    perform pg_temp.ck('the default pause leaves check-in requests on', 'false', (select pause_alerts::text from public.care_circle_pauses where patient_id = v_p2));
    v_pg := pg_temp.newpage(v_p2, pg_temp.newte(v_p2));
    perform pg_temp.ck('so a request during a default pause still reaches Z', '2',
      (select count(*)::text from public.notifications where recipient_id = v_s2 and template = 'circle_check_in' and source_id = v_pg));
    perform pg_temp.ck('and Z still sees the person in their list with the check-in permission, nothing else', '["red_alerts"]',
      pg_temp.q_as(v_s2, $q$select (public.my_supported_people() -> 0 -> 'permissions')::text$q$));
    perform pg_temp.q_as(v_s2, format($q$select public.circle_ack_alert(%L)::text$q$, v_p2));
    -- a full pause: a request sent inside it never appears afterwards
    -- (one transaction has one clock, so the times are set by hand: earlier requests 30 minutes ago, the pause 10 minutes ago, the new request 5 minutes ago)
    perform set_config('tarragon.paging_write', 'on', true);
    update public.pages set sent_at = now() - interval '30 minutes' where patient_id = v_p2;
    perform set_config('tarragon.paging_write', 'off', true);
    perform pg_temp.q_as(v_p2, $q$select public.pause_care_circle(true)::text$q$);
    update public.care_circle_pauses set paused_from = now() - interval '10 minutes' where patient_id = v_p2;
    perform pg_temp.ck('with a full pause Z loses the person from the list', '0', pg_temp.q_as(v_s2, $q$select jsonb_array_length(public.my_supported_people())::text$q$));
    v_pg := pg_temp.newpage(v_p2, pg_temp.newte(v_p2));
    perform set_config('tarragon.paging_write', 'on', true);
    update public.pages set sent_at = now() - interval '5 minutes' where id = v_pg;
    perform set_config('tarragon.paging_write', 'off', true);
    perform pg_temp.q_as(v_p2, $q$select public.resume_care_circle()::text$q$);
    perform pg_temp.ck('a request sent during a full pause is not shown after it ends (the earlier ones still read as called)', 'true',
      pg_temp.q_as(v_s2, $q$select (public.circle_open_alerts() -> 0 ->> 'called')$q$));
    perform pg_temp.ck('and nobody was notified of it', '0', (select count(*)::text from public.notifications where source_id = v_pg and template = 'circle_check_in'));
  end;

  -- 6. Gifts: only the full yearly Membership ----------------------------------------------------------------------------------
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, uses, grants_lead, active)
  values (v_org, 's29c_consult', 'consultation', 'catalog.proof.name', 'catalog.proof.description', 1, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 500000, '{"partner_fee_kobo":300000,"tarragon_fee_kobo":200000}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 's29c_short', 'membership', 'catalog.proof.name', 'catalog.proof.description', 30, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 500000, '{"partner_fee_kobo":300000,"tarragon_fee_kobo":200000}', 'proof');
  insert into public.catalog_items (organisation_id, code, kind, name_key, description_key, duration_days, grants_lead, active)
  values (v_org, 's29c_year', 'membership', 'catalog.proof.name', 'catalog.proof.description', 365, false, true) returning id into v_item;
  insert into public.prices (organisation_id, catalog_item_id, amount_kobo, components, reason) values (v_org, v_item, 500000, '{"partner_fee_kobo":300000,"tarragon_fee_kobo":200000}', 'proof');
  update public.platform_modules set is_enabled = true, enabled_at = now(), enabled_by = v_admin, activation_note = 'S29c proof run' where key = 'v5_checkout';

  perform pg_temp.ck('C cannot pay for someone else''s single consultation', 'true',
    (pg_temp.q_as(v_sc, format($q$select public.create_order('s29c_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%gift_item_not_allowed%')::text);
  perform pg_temp.ck('nor a short membership', 'true',
    (pg_temp.q_as(v_sc, format($q$select public.create_order('s29c_short', gen_random_uuid(), %L)::text$q$, v_pat)) like '%gift_item_not_allowed%')::text);
  perform pg_temp.ck('C can pay for the full yearly Membership', 'true',
    (pg_temp.q_as(v_sc, format($q$select public.create_order('s29c_year', gen_random_uuid(), %L)::text$q$, v_pat)) like '%"reference"%')::text);
  insert into public.profile_access (profile_id, grantee_user_id, granted_by, permission_level) values (v_pat, v_other, v_pat, 'view');
  perform pg_temp.ck('the older family grant is held to the same rule', 'true',
    (pg_temp.q_as(v_other, format($q$select public.create_order('s29c_consult', gen_random_uuid(), %L)::text$q$, v_pat)) like '%gift_item_not_allowed%')::text);
  delete from public.profile_access where profile_id = v_pat and grantee_user_id = v_other;
  perform pg_temp.ck('a patient still buys a single consultation for themselves', 'true',
    (pg_temp.q_as(v_pat, $q$select public.create_order('s29c_consult', gen_random_uuid())::text$q$) like '%"reference"%')::text);
  perform pg_temp.ck('a stranger still gets the beneficiary refusal first', 'true',
    (pg_temp.q_as(v_other, format($q$select public.create_order('s29c_year', gen_random_uuid(), %L)::text$q$, v_pat)) like '%order_beneficiary_not_allowed%')::text);
  perform pg_temp.ck('paying is not sharing: C can still pay during a pause', 'true',
    (pg_temp.q_as(v_pat, $q$select public.pause_care_circle(true)::text$q$) like '%paused_until%')::text);
  perform pg_temp.ck('(C pays for the yearly Membership while the circle is paused)', 'true',
    (pg_temp.q_as(v_sc, format($q$select public.create_order('s29c_year', gen_random_uuid(), %L)::text$q$, v_pat)) like '%"reference"%')::text);
end $$;

-- ===========================================================================================================================
-- SABOTAGE: each gate removed in turn; the matching check must flip. The patient is paused (full) from the block above.
-- ===========================================================================================================================
do $$
declare
  v_pat uuid := pg_temp.f('pat'); v_sa uuid := pg_temp.f('sa'); v_sb uuid := pg_temp.f('sb'); v_sc uuid := pg_temp.f('sc');
  d text; r text; v_page uuid; n integer;
begin
  -- (a) the pause removed from the one gate
  select pg_get_functiondef('private.circle_member_for(uuid, text)'::regprocedure) into d;
  d := replace(d, 'else not private.circle_paused(m.patient_id)', 'else true');
  if d = pg_get_functiondef('private.circle_member_for(uuid, text)'::regprocedure) then raise exception 'sabotage (a) did not change the function'; end if;
  execute d;
  r := pg_temp.view_as(v_sa, v_pat);
  insert into results values ('sabotaged', 'a paused circle shows a supporter nothing', 'true', (r like '%circle_not_found%')::text);

  -- (b) the alert pause removed from the trigger
  select pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) into d;
  d := replace(d, 'if private.circle_alerts_paused(new.patient_id) then return new; end if;', '');
  if d = pg_get_functiondef('private.notify_circle_red_alert()'::regprocedure) then raise exception 'sabotage (b) did not change the function'; end if;
  execute d;
  v_page := pg_temp.newpage(v_pat, pg_temp.newte(v_pat));
  select count(*) into n from public.notifications where template = 'circle_check_in' and source_id = v_page;
  insert into results values ('sabotaged', 'a paused circle gets no check-in request', '0', n::text);

  -- (c) the gift rule removed from create_order
  select pg_get_functiondef('public.create_order(text, uuid, uuid)'::regprocedure) into d;
  d := replace(d, 'not private.gift_item_allowed(it.kind::text, it.duration_days)', 'false');
  if d = pg_get_functiondef('public.create_order(text, uuid, uuid)'::regprocedure) then raise exception 'sabotage (c) did not change the function'; end if;
  execute d;
  r := pg_temp.q_as(v_sc, format($q$select public.create_order('s29c_consult', gen_random_uuid(), %L)::text$q$, v_pat));
  insert into results values ('sabotaged', 'only the yearly Membership can be paid for someone else', 'true', (r like '%gift_item_not_allowed%')::text);

  -- (d) the red_alerts gate removed from the acknowledgement
  select pg_get_functiondef('public.circle_ack_alert(uuid)'::regprocedure) into d;
  d := replace(d, 'private.circle_member_for(p_patient, ''red_alerts'')', 'private.circle_member_for(p_patient)');
  if d = pg_get_functiondef('public.circle_ack_alert(uuid)'::regprocedure) then raise exception 'sabotage (d) did not change the function'; end if;
  perform pg_temp.q_as(v_pat, $q$select public.resume_care_circle()::text$q$);
  execute d;
  r := pg_temp.q_as(v_sa, format($q$select public.circle_ack_alert(%L)::text$q$, v_pat));
  insert into results values ('sabotaged', 'a member without red_alerts cannot mark a request', 'true', (r like '%circle_not_found%')::text);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S29c proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 4 then raise exception 'VACUOUS TEST: the sabotage flipped % of 4 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

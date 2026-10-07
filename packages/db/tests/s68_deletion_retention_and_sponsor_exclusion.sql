-- S68 proof 3: deletion and retention (decision B3 and C), and "sponsors, employers and the Care Circle never see cycle, pregnancy, postnatal,
-- contraception or child-growth data" (migration *_s68g and the S68 tables). One rolled-back transaction.
--   1. Sponsor: public.sponsor_care_report() for a sponsor at the FULL sharing level returns only its fixed keys, and none of the planted private
--      values; no sponsor, employer, corporate, HMO, NGO or Care Circle function or view anywhere in the schema references a cycle, pregnancy,
--      postnatal, contraception, lifecycle, feed or child-growth table; a sponsor (purchaser) and a Care Circle supporter read nothing from those tables.
--   2. Deletion: the person asks, the grace window must pass (7 days), completing early is refused, completing deletes patient-entered rows and keeps
--      clinician-recorded or acted-on rows, the receipt records both counts, an audit row is written, a second completion is refused, cancel works,
--      a stranger can neither ask for nor complete another person's deletion, a parent can ask for a child's growth data only, a receipt is permanent.
--   3. SABOTAGE: (a) the sealed rule removed (everything is deleted), (b) the grace check removed. The matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
-- run a statement as a user; 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a statement as a user and return the first column of the first row ('ERR:' + message on error)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
-- a profile (auth user first). p_dob / p_sex optional. Test accounts by default (INV-13).
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null, p_sex text default null, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's68-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S68 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '30 years')::date), p_test)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth;
  if p_sex is not null then update public.profiles set sex = p_sex::public.sex where id = v; end if;
  return v;
end $f$;
-- a dependent child managed by a parent
create function pg_temp.mkchild(p_org uuid, p_parent uuid, p_label text, p_dob date, p_sex text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_dob, p_sex, p_test);
begin
  update public.profiles set is_dependent_account = true where id = v;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v, p_parent, 'manage', p_parent);
  return v;
end $f$;
-- the guard, for the proof only: the real guard row can be switched by nobody but set_go_live_guard
create function pg_temp.guard_state(p_on boolean) returns void language plpgsql as
$f$ begin
  execute format('create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = '''' as ''select %s''', case when p_on then 'true' else 'false' end);
end $f$;

do $$
declare
  v_org uuid; v_mum uuid; v_spon uuid; v_sup uuid; v_clin uuid; v_child uuid; v_stranger uuid; v_voucher uuid; v_rep jsonb; v_keys text[]; v_txt text; v_n int; v_refs text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_mum := pg_temp.mkuser(v_org, 'mum', 'patient', (current_date - interval '28 years')::date, 'female');
  v_spon := pg_temp.mkuser(v_org, 'sponsor', 'patient'); v_sup := pg_temp.mkuser(v_org, 'supporter', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician'); v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient');
  v_child := pg_temp.mkchild(v_org, v_mum, 'baby', current_date - 300, 'female');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('mum', v_mum); perform pg_temp.setf('spon', v_spon); perform pg_temp.setf('sup', v_sup);
  perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('stranger', v_stranger); perform pg_temp.setf('child', v_child);

  -- the mother is sponsored; the sponsor sees at the most generous level
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status, activated_at)
  values (v_org, 'S68-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', v_mum, v_spon, (select id from public.service_products limit 1), 'x', 'A care item', 500000, 500000, 'active', now());
  insert into public.sponsor_sharing_preferences (organisation_id, patient_id, sponsor_id, level) values (v_org, v_mum, v_spon, 'full');
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, v_mum, v_sup, 'sister', array['adherence_summary','weekly_bp_trend','appointments','red_alerts','pay_for_care'], now() + interval '30 days', true);

  -- plant private rows with recognisable values
  insert into public.menstrual_cycles (organisation_id, patient_id, period_start_date, notes) values (v_org, v_mum, current_date - 20, 'PLANTED-CYCLE-NOTE');
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_mum, true);
  perform pg_temp.act(v_mum); perform public.record_lifecycle_event('pregnancy_loss_recorded', current_date - 1, null, 8, 'PLANTED-LOSS-NOTE'); perform pg_temp.back();
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, complications) values (v_org, v_mum, current_date - 5, 'PLANTED-COMPLICATION');
  update public.postnatal_baby_checks set concern_note = 'PLANTED-BABY-CONCERN', concerns_noted = true where patient_id = v_mum;
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, note) values (v_org, v_mum, 'formula', 'PLANTED-FEED-NOTE');
  insert into public.reproductive_health_profiles (organisation_id, patient_id, life_stage) values (v_org, v_mum, 'postpartum');
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, note) values (v_org, v_child, now(), 5.5, 'PLANTED-GROWTH-NOTE');
  insert into public.care_vouchers (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id, service_product_id, sku_code, sku_name, face_value_kobo, amount_paid_kobo, status, activated_at)
  values (v_org, 'S68-' || substr(gen_random_uuid()::text, 1, 8), 'prepaid_service', v_child, v_spon, (select id from public.service_products limit 1), 'x', 'A care item', 500000, 500000, 'active', now());
  insert into public.sponsor_sharing_preferences (organisation_id, patient_id, sponsor_id, level) values (v_org, v_child, v_spon, 'full');

  -- 1. the sponsor's report, for the mother and for the child
  perform pg_temp.act(v_spon);
  v_rep := public.sponsor_care_report(v_mum);
  v_txt := v_rep::text;
  perform pg_temp.back();
  select array_agg(k order by k) into v_keys from jsonb_object_keys(v_rep) k;
  perform pg_temp.ck('the sponsor report has only its fixed keys', 'last_clinical_review,monitoring_active_until,next_check_due,note,readings_logged,sharing_level,since,vouchers', array_to_string(v_keys, ','));
  perform pg_temp.ck('...and none of the planted private values', '0', (select count(*)::text from unnest(array['PLANTED-CYCLE-NOTE','PLANTED-COMPLICATION','PLANTED-BABY-CONCERN','PLANTED-FEED-NOTE','PLANTED-LOSS-NOTE','PLANTED-GROWTH-NOTE']) p where v_txt like '%' || p || '%'));
  perform pg_temp.act(v_spon);
  v_txt := public.sponsor_care_report(v_child)::text;
  perform pg_temp.back();
  perform pg_temp.ck('the child report holds no growth value either', 'false', (v_txt like '%PLANTED-GROWTH-NOTE%' or v_txt ~* 'z_score|muac|weight_for')::text);
  perform pg_temp.ck('...it counts no growth, feed, cycle or pregnancy row as a reading', '0', (v_rep ->> 'readings_logged'));

  -- every function or view that talks to a sponsor, employer, corporate, HMO, NGO, care circle or supporter: no reference to the private tables
  select string_agg(distinct p.proname, ', ') into v_refs
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname ~* '(sponsor|employer|corporate|hmo|ngo|care_circle|circle_supporter|payer|institution|cohort)'
     and p.prosrc ~* '(menstrual_|patient_pregnancy|postnatal_|pregnancy_loss|lifecycle_|contracept|reproductive_health_profiles|child_growth|breastfeeding_|antenatal_|growth_reference)';
  perform pg_temp.ck('no sponsor, employer, NGO, payer or Care Circle function references a private table', '', coalesce(v_refs, ''));
  select string_agg(distinct v.viewname, ', ') into v_refs
    from pg_views v where v.schemaname in ('public', 'private', 'analytics')
     and v.viewname ~* '(sponsor|employer|corporate|hmo|ngo|care_circle|circle_supporter|payer|institution|cohort)'
     and v.definition ~* '(menstrual_|patient_pregnancy|postnatal_|pregnancy_loss|lifecycle_|contracept|reproductive_health_profiles|child_growth|breastfeeding_|antenatal_)';
  perform pg_temp.ck('no sponsor, employer, NGO, payer or Care Circle view references a private table', '', coalesce(v_refs, ''));
  -- direct reads
  for v_n in 1..1 loop
    perform pg_temp.ck('a sponsor reads no feeds', '0', pg_temp.q_as(v_spon, 'select count(*)::text from public.breastfeeding_feed_log'));
    perform pg_temp.ck('a sponsor reads no growth rows (child or otherwise)', '0', pg_temp.q_as(v_spon, 'select count(*)::text from public.child_growth_measurements'));
    perform pg_temp.ck('a sponsor reads no baby checks', '0', pg_temp.q_as(v_spon, 'select count(*)::text from public.postnatal_baby_checks'));
    perform pg_temp.ck('a sponsor reads no lifecycle row, loss note or postnatal record', '0|0|0', pg_temp.q_as(v_spon, 'select (select count(*) from public.lifecycle_states) || ''|'' || (select count(*) from public.pregnancy_loss_records) || ''|'' || (select count(*) from public.postnatal_profiles)'));
    perform pg_temp.ck('a sponsor reads no cycle or reproductive profile', '0|0', pg_temp.q_as(v_spon, 'select (select count(*) from public.menstrual_cycles) || ''|'' || (select count(*) from public.reproductive_health_profiles)'));
    perform pg_temp.ck('a Care Circle supporter reads none of it', '0|0|0|0|0', pg_temp.q_as(v_sup, 'select (select count(*) from public.breastfeeding_feed_log) || ''|'' || (select count(*) from public.postnatal_baby_checks) || ''|'' || (select count(*) from public.pregnancy_loss_records) || ''|'' || (select count(*) from public.lifecycle_states) || ''|'' || (select count(*) from public.menstrual_cycles)'));
  end loop;
end $$;

-- 2. deletion
do $$
declare
  v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_clin uuid := pg_temp.f('clin'); v_stranger uuid := pg_temp.f('stranger'); v_child uuid := pg_temp.f('child');
  v_req uuid; v_req2 uuid; r jsonb; m1 uuid; m2 uuid; m3 uuid; v_al uuid; v_kid2 uuid;
begin
  delete from public.breastfeeding_feed_log where patient_id = v_mum;
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) select v_org, v_mum, 'formula' from generate_series(1, 3);
  -- a clinician-recorded feed row
  perform pg_temp.act(v_clin);
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, note) values (v_org, v_mum, 'formula', 'recorded at the visit');
  perform pg_temp.back();
  perform pg_temp.ck('setup: 3 patient-entered and 1 clinician-recorded feed', '3|1', (select count(*) filter (where source = 'patient_entered') || '|' || count(*) filter (where source = 'clinician_recorded') from public.breastfeeding_feed_log where patient_id = v_mum));

  v_req := (pg_temp.q_as(v_mum, $q$select public.request_tracker_deletion('feed_log')::text$q$))::uuid;
  perform pg_temp.setf('req', v_req);
  perform pg_temp.ck('the request starts a 7 day grace window', 'true', (select (execute_after between now() + interval '167 hours' and now() + interval '169 hours' and status = 'pending')::text from public.tracker_deletion_requests where id = v_req));
  perform pg_temp.ck('a second pending request for the same scope is refused', 'true', (pg_temp.try_as(v_mum, $q$select public.request_tracker_deletion('feed_log')$q$) like '%tracker_deletion_one_pending%')::text);
  perform pg_temp.ck('nothing is deleted yet', '4', (select count(*)::text from public.breastfeeding_feed_log where patient_id = v_mum));
  perform pg_temp.ck('completing inside the window is refused', 'the grace window has not ended', pg_temp.try_as(v_mum, format($q$select public.complete_tracker_deletion(%L)$q$, v_req)));
  perform pg_temp.ck('a stranger can not complete it', 'no request of yours', pg_temp.try_as(v_stranger, format($q$select public.complete_tracker_deletion(%L)$q$, v_req)));
  perform pg_temp.ck('a stranger can not cancel it', 'no pending request of yours', pg_temp.try_as(v_stranger, format($q$select public.cancel_tracker_deletion(%L)$q$, v_req)));
  perform pg_temp.ck('a stranger can not ask for the mother''s data', 'not allowed', pg_temp.try_as(v_stranger, format($q$select public.request_tracker_deletion('feed_log', %L)$q$, v_mum)));
  perform pg_temp.ck('a stranger reads no receipt', '0', pg_temp.q_as(v_stranger, 'select count(*)::text from public.tracker_deletion_requests'));
  perform pg_temp.ck('an unknown scope is refused', 'unknown scope', pg_temp.try_as(v_mum, $q$select public.request_tracker_deletion('everything')$q$));
  -- the window passes (the guard trigger forbids this edit for everyone but a superuser stepping outside it, as the proof does)
  alter table public.tracker_deletion_requests disable trigger tracker_deletion_requests_guard;
  update public.tracker_deletion_requests set execute_after = now() - interval '1 minute' where id = v_req;
  alter table public.tracker_deletion_requests enable trigger tracker_deletion_requests_guard;
  r := (pg_temp.q_as(v_mum, format($q$select public.complete_tracker_deletion(%L)::text$q$, v_req)))::jsonb;
  perform pg_temp.ck('after the window: 3 deleted, 1 sealed row kept', '3|1', (r ->> 'rows_deleted') || '|' || (r ->> 'rows_sealed_kept'));
  perform pg_temp.ck('the clinician-recorded row is still there, the patient-entered are gone', 'clinician_recorded|1', (select min(source) || '|' || count(*) from public.breastfeeding_feed_log where patient_id = v_mum));
  perform pg_temp.ck('the receipt is permanent and holds the counts', 'executed|3|1', (select status || '|' || rows_deleted || '|' || rows_sealed_kept from public.tracker_deletion_requests where id = v_req));
  perform pg_temp.ck('an audit row was written', '1', (select count(*)::text from public.audit_log where action = 'tracker_deletion_completed' and entity_id = v_req));
  perform pg_temp.ck('completing twice is refused', 'no pending request', pg_temp.try_as(v_mum, format($q$select public.complete_tracker_deletion(%L)$q$, v_req)));
  begin delete from public.tracker_deletion_requests where id = v_req; perform pg_temp.ck('a receipt can not be deleted', 'refused', 'deleted');
  exception when sqlstate '42501' then perform pg_temp.ck('a receipt can not be deleted', 'refused', 'refused'); end;
  perform pg_temp.ck('a mother can not write a receipt directly', 'permission denied for table tracker_deletion_requests', pg_temp.try_as(v_mum, format($q$insert into public.tracker_deletion_requests (organisation_id, patient_id, requested_by, scope, execute_after, config_version) values (%L, %L, %L, 'feed_log', now(), 1)$q$, v_org, v_mum, v_mum)));

  -- cancel
  v_req2 := (pg_temp.q_as(v_mum, $q$select public.request_tracker_deletion('baby_checks')::text$q$))::uuid;
  perform pg_temp.try_as(v_mum, format($q$select public.cancel_tracker_deletion(%L)$q$, v_req2));
  perform pg_temp.ck('cancel works and leaves the data', 'cancelled|true', (select status || '|' || (select count(*) > 0 from public.postnatal_baby_checks where patient_id = v_mum)::text from public.tracker_deletion_requests where id = v_req2));

  -- the child's growth: parent entered (deleted), clinician recorded (sealed), one that raised an alert (sealed)
  insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg) values (v_org, v_child, now() - interval '3 days', 5.0);
  perform pg_temp.act(v_mum); insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg) values (v_org, v_child, now() - interval '2 days', 5.4); perform pg_temp.back();
  perform pg_temp.act(v_clin); insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg) values (v_org, v_child, now() - interval '1 day', 5.6); perform pg_temp.back();
  perform pg_temp.act(v_mum); insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, muac_mm) values (v_org, v_child, now(), 100); perform pg_temp.back();
  perform pg_temp.ck('setup: the severe MUAC row raised an alert', '1', (select count(*)::text from public.child_growth_measurements where patient_id = v_child and nutrition_alert_id is not null));
  perform pg_temp.ck('a stranger can not ask for the child''s growth deletion', 'not allowed', pg_temp.try_as(v_stranger, format($q$select public.request_tracker_deletion('child_growth', %L)$q$, v_child)));
  perform pg_temp.ck('a parent can not ask for the CHILD''s feed log or loss note', 'not allowed', pg_temp.try_as(v_mum, format($q$select public.request_tracker_deletion('pregnancy_loss', %L)$q$, v_child)));
  v_req2 := (pg_temp.q_as(v_mum, format($q$select public.request_tracker_deletion('child_growth', %L)::text$q$, v_child)))::uuid;
  alter table public.tracker_deletion_requests disable trigger tracker_deletion_requests_guard;
  update public.tracker_deletion_requests set execute_after = now() - interval '1 minute' where id = v_req2;
  alter table public.tracker_deletion_requests enable trigger tracker_deletion_requests_guard;
  r := (pg_temp.q_as(v_mum, format($q$select public.complete_tracker_deletion(%L)::text$q$, v_req2)))::jsonb;
  perform pg_temp.ck('growth: the parent-entered rows go, the clinician row and the alert row are kept (the planted superuser row counts as patient entered)', '3|2', (r ->> 'rows_deleted') || '|' || (r ->> 'rows_sealed_kept'));
  perform pg_temp.ck('...the alert itself is untouched', '1', (select count(*)::text from public.clinician_alerts where patient_id = v_child and title like 'Child growth check%'));

  -- the loss note: patient entered goes, a clinician one is kept
  perform pg_temp.setf('lossreq', (pg_temp.q_as(v_mum, $q$select public.request_tracker_deletion('pregnancy_loss')::text$q$))::uuid);
  alter table public.tracker_deletion_requests disable trigger tracker_deletion_requests_guard;
  update public.tracker_deletion_requests set execute_after = now() - interval '1 minute' where id = pg_temp.f('lossreq');
  alter table public.tracker_deletion_requests enable trigger tracker_deletion_requests_guard;
  r := (pg_temp.q_as(v_mum, format($q$select public.complete_tracker_deletion(%L)::text$q$, pg_temp.f('lossreq'))))::jsonb;
  perform pg_temp.ck('the person''s own loss note is deleted', '1|0', (r ->> 'rows_deleted') || '|' || (r ->> 'rows_sealed_kept'));
  perform pg_temp.ck('...the fact of the confirmed event stays in the stage history, with no note', '1', (select count(*)::text from public.lifecycle_events where patient_id = v_mum and kind = 'pregnancy_loss_recorded'));
  perform pg_temp.ck('the sweep is service-role only', 'permission denied for function sweep_due_tracker_deletions', pg_temp.try_as(v_mum, 'select public.sweep_due_tracker_deletions()'));
end $$;

-- 3. SABOTAGE
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.execute_tracker_deletion(uuid)'::regprocedure);
  execute replace(replace(v_def, 'where patient_id = r.patient_id and source = ''patient_entered'' returning 1', 'where patient_id = r.patient_id returning 1'), 'if r.execute_after > now() then', 'if false then');
end $$;
do $$
declare v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_clin uuid := pg_temp.f('clin'); v_req uuid; r jsonb; v_early text;
begin
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (v_org, v_mum, 'formula');
  perform pg_temp.act(v_clin); insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (v_org, v_mum, 'formula'); perform pg_temp.back();
  v_req := (pg_temp.q_as(v_mum, $q$select public.request_tracker_deletion('feed_log')::text$q$))::uuid;
  v_early := pg_temp.try_as(v_mum, format($q$select public.complete_tracker_deletion(%L)$q$, v_req));
  insert into results values ('sabotaged', 'completing inside the window is refused', 'the grace window has not ended', v_early);
  insert into results values ('sabotaged', 'a clinician-recorded row survives a deletion', '2', (select count(*)::text from public.breastfeeding_feed_log where patient_id = v_mum and source = 'clinician_recorded'));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S68 deletion/sponsor proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

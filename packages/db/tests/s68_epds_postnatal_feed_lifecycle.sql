-- S68 proof 2: EPDS rules in the database, baby checks, the feed log and the life-stage state machine (migrations *_s68e and *_s68f). One rolled-back transaction.
--   1. EPDS: the database recomputes the total and item 10 from the stored answers. ANY non-zero item 10 is a crisis and opens the emergency event
--      whatever the total and whatever the client sent (a total of 3 with item 10 = 1 is a crisis; a client that says "no crisis" is overruled).
--      10 to 12 raises a clinician review due in 7 days, 13 or more in 48 hours; 9 or less raises nothing. Wrong shapes are refused. One alert per screen.
--   2. Postnatal: a delivery generates the week 1 and week 6 mother and baby checks from the configuration; a parent can only attach a child they manage.
--   3. Feed log: closed while maternal_enabled is off (real person), open for a test account; source/recorded_by derived; the person cannot delete or forge.
--   4. Lifecycle: stages move only on a confirmed event through the configured transitions; wrong-stage and future-date events are refused; a guard-off real
--      person is refused; a hook on the existing pregnancy and delivery records moves the stage without inference; loss hides baby content and its note is
--      visible to the person and staff only (never a caregiver, never a Care Circle supporter); events are append-only; outbox events are written.
--   5. Roles on every new table: patient, caregiver (with and without a reproductive grant, and an adolescent), Care Circle supporter, unrelated patient, anon.
--   6. SABOTAGE: (a) the item 10 override removed, (b) the lifecycle transition check removed, (c) the caregiver gate opened on the feed log. Checks must flip.
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
  v_org uuid; v_mum uuid; v_other uuid; v_cg uuid; v_cg_cat uuid; v_clin uuid; v_sup uuid; v_teen uuid; v_teen_cg uuid;
  s uuid; a int; n int;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_mum := pg_temp.mkuser(v_org, 'mum', 'patient', (current_date - interval '28 years')::date, 'female');
  v_other := pg_temp.mkuser(v_org, 'other', 'patient', (current_date - interval '30 years')::date, 'female');
  v_cg := pg_temp.mkuser(v_org, 'cg_plain', 'patient'); v_cg_cat := pg_temp.mkuser(v_org, 'cg_cat', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician'); v_sup := pg_temp.mkuser(v_org, 'supporter', 'patient');
  v_teen := pg_temp.mkuser(v_org, 'teen', 'patient', (current_date - interval '16 years')::date, 'female'); v_teen_cg := pg_temp.mkuser(v_org, 'teen_cg', 'patient');
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('mum', v_mum); perform pg_temp.setf('other', v_other); perform pg_temp.setf('cg', v_cg);
  perform pg_temp.setf('cgcat', v_cg_cat); perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('sup', v_sup); perform pg_temp.setf('teen', v_teen); perform pg_temp.setf('teencg', v_teen_cg);
  -- caregivers: plain 'view' grant with no category; a reproductive_health category grant; and one on an adolescent (with the category)
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_mum, v_cg, 'view', v_mum);
  perform pg_temp.act(v_mum);
  declare g uuid; begin
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_mum, v_cg_cat, 'view', v_mum) returning id into g;
    perform public.set_care_access_categories(g, array['reproductive_health']::public.care_access_category[]);
  end;
  perform pg_temp.back();
  perform pg_temp.act(v_teen);
  declare g uuid; begin
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_teen, v_teen_cg, 'view', v_teen) returning id into g;
    perform public.set_care_access_categories(g, array['reproductive_health']::public.care_access_category[]);
  end;
  perform pg_temp.back();
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, v_mum, v_sup, 'sister', array['adherence_summary','weekly_bp_trend','appointments','red_alerts','pay_for_care'], now() + interval '30 days', true);

  -- 1. EPDS, written the way the application writes it (no signed-in user; the table has no client insert)
  s := gen_random_uuid();
  -- low total, item 10 = 1, the client says crisis_flagged = false
  insert into public.mental_health_screens (id, organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
  values (s, v_org, v_mum, 'epds', 0, 'minimal', false, '{"items":[0,0,0,0,0,0,0,0,0,1]}');
  perform pg_temp.ck('EPDS: total 1 with item 10 = 1 is stored as a crisis', 'true|crisis|1', (select crisis_flagged::text || '|' || review_band || '|' || total_score from public.mental_health_screens where id = s));
  perform pg_temp.ck('EPDS: the crisis opens one active emergency event', '1', (select count(*)::text from public.emergency_events where patient_id = v_mum and status = 'active'));
  perform pg_temp.ck('EPDS: the crisis raises no second review alert', '0', (select count(*)::text from public.clinician_alerts where patient_id = v_mum and title like 'Postnatal wellbeing%'));
  perform pg_temp.ck('EPDS: the rule version is recorded', '1', (select epds_config_version::text from public.mental_health_screens where id = s));
  -- a high total with item 10 = 0 is NOT a crisis; client lies about the total
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses)
  values (v_org, v_other, 'epds', 0, 'minimal', false, '{"items":[3,3,3,3,0,0,0,0,0,0]}') returning id into s;
  perform pg_temp.ck('EPDS: a client total is overruled by the answers (12 = possible)', '12|possible|false', (select total_score || '|' || review_band || '|' || crisis_flagged::text from public.mental_health_screens where id = s));
  perform pg_temp.ck('EPDS 12: one review alert due in about 7 days', 'true', (select (count(*) = 1 and bool_and(sla_due_at between now() + interval '167 hours' and now() + interval '169 hours' and level = 'clinician_review'))::text from public.clinician_alerts where patient_id = v_other and title like 'Postnatal wellbeing%'));
  perform pg_temp.ck('EPDS: an alert is not a diagnosis', 'true', (select bool_and(detail like '%not a diagnosis%')::text from public.clinician_alerts where patient_id = v_other and title like 'Postnatal wellbeing%'));
  v_cg := pg_temp.mkuser(v_org, 'epds13', 'patient');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses) values (v_org, v_cg, 'epds', 0, 'minimal', '{"items":[3,3,3,3,1,0,0,0,0,0]}');
  perform pg_temp.ck('EPDS 13: one review alert due in about 48 hours', 'true', (select (count(*) = 1 and bool_and(sla_due_at between now() + interval '47 hours' and now() + interval '49 hours'))::text from public.clinician_alerts where patient_id = v_cg and title like 'Postnatal wellbeing%'));
  v_cg := pg_temp.mkuser(v_org, 'epds9', 'patient');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses) values (v_org, v_cg, 'epds', 0, 'minimal', '{"items":[3,3,3,0,0,0,0,0,0,0]}');
  perform pg_temp.ck('EPDS 9: nothing is raised', '0', (select count(*)::text from public.clinician_alerts where patient_id = v_cg));
  begin
    insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses) values (v_org, v_cg, 'epds', 0, 'minimal', '{"items":[1,1,1]}');
    perform pg_temp.ck('EPDS: a wrong number of answers is refused', 'refused', 'accepted');
  exception when sqlstate '22023' then perform pg_temp.ck('EPDS: a wrong number of answers is refused', 'refused', 'refused'); end;
  begin
    insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses) values (v_org, v_cg, 'epds', 0, 'minimal', '{"items":[0,0,0,0,0,0,0,0,0,7]}');
    perform pg_temp.ck('EPDS: an answer of 7 is refused', 'refused', 'accepted');
  exception when sqlstate '22023' then perform pg_temp.ck('EPDS: an answer of 7 is refused', 'refused', 'refused'); end;
  perform pg_temp.ck('PHQ-9 routing is unchanged (severe is still high)', 'high', private.classify_mental_health_screen_concern('phq9', 'severe', null));
  perform pg_temp.ck('EPDS has no second path in the old classifier', 'none', private.classify_mental_health_screen_concern('epds', 'severe', null));
end $$;

-- 2 and 3. postnatal checks and the feed log
do $$
declare
  v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_other uuid := pg_temp.f('other'); v_cg uuid := pg_temp.f('cg'); v_cgcat uuid := pg_temp.f('cgcat');
  v_clin uuid := pg_temp.f('clin'); v_sup uuid := pg_temp.f('sup'); v_pp uuid; v_child uuid; v_real uuid; r text;
begin
  insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date, delivery_mode) values (v_org, v_mum, current_date - 3, 'vaginal') returning id into v_pp;
  perform pg_temp.setf('pp', v_pp);
  perform pg_temp.ck('a delivery makes the week 1 and week 6 mother checks', 'week_1,week_6', (select string_agg(checkin_window, ',' order by checkin_window) from public.postnatal_checkins where postnatal_profile_id = v_pp));
  perform pg_temp.ck('...and the week 1 and week 6 baby checks', 'week_1,week_6', (select string_agg(check_window, ',' order by check_window) from public.postnatal_baby_checks where postnatal_profile_id = v_pp));
  perform pg_temp.ck('...dated from the delivery by the configured days', (current_date - 3 + 7)::text || ',' || (current_date - 3 + 42)::text,
    (select string_agg(scheduled_date::text, ',' order by scheduled_date) from public.postnatal_baby_checks where postnatal_profile_id = v_pp));
  perform pg_temp.ck('one baby check per window', '2', (select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = v_pp));
  -- the mother completes the week 1 baby check; a stranger and a caregiver cannot
  perform pg_temp.ck('the mother saves the week 1 baby check', 'ok', pg_temp.try_as(v_mum, format($q$update public.postnatal_baby_checks set completed_at = now(), baby_weight_kg = 3.4, feeding_method = 'breast_only' where postnatal_profile_id = %L and check_window = 'week_1'$q$, v_pp)));
  perform pg_temp.ck('...recorded by her, as patient entered', 'patient_entered|' || v_mum::text, (select source || '|' || recorded_by from public.postnatal_baby_checks where postnatal_profile_id = v_pp and check_window = 'week_1'));
  perform pg_temp.ck('an unrelated patient reads no baby check', '0', pg_temp.q_as(v_other, format('select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = %L', v_pp)));
  perform pg_temp.ck('a caregiver with a plain view grant reads no baby check', '0', pg_temp.q_as(v_cg, format('select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = %L', v_pp)));
  perform pg_temp.ck('a caregiver WITH the reproductive_health grant reads the baby checks (adult)', '2', pg_temp.q_as(v_cgcat, format('select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = %L', v_pp)));
  perform pg_temp.ck('a Care Circle supporter reads no baby check', '0', pg_temp.q_as(v_sup, format('select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = %L', v_pp)));
  perform pg_temp.ck('the care team (staff) reads the baby checks', '2', pg_temp.q_as(v_clin, format('select count(*)::text from public.postnatal_baby_checks where postnatal_profile_id = %L', v_pp)));
  perform pg_temp.ck('anon cannot read baby checks', 'permission denied for table postnatal_baby_checks', pg_temp.try_anon('select 1 from public.postnatal_baby_checks limit 1'));
  perform pg_temp.ck('a caregiver cannot write a baby check (0 rows changed)', '0', pg_temp.q_as(v_cgcat, format($q$with u as (update public.postnatal_baby_checks set concerns_noted = true where postnatal_profile_id = %L returning 1) select count(*)::text from u$q$, v_pp)));
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_other uuid := pg_temp.f('other'); v_cg uuid := pg_temp.f('cg'); v_cgcat uuid := pg_temp.f('cgcat');
  v_clin uuid := pg_temp.f('clin'); v_sup uuid := pg_temp.f('sup'); v_real uuid; v_realorg uuid; v_child uuid; r text; f uuid;
begin
  -- feed log: the test mother is open (S37 test rule); a REAL person is refused while the guard is off
  r := pg_temp.try_as(v_mum, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, duration_minutes) values (%L, %L, 'breast_left', 12)$q$, v_org, v_mum));
  perform pg_temp.ck('a test mother logs a feed', 'ok', r);
  perform pg_temp.ck('...as patient_entered, recorded by her', 'patient_entered|' || v_mum::text, (select source || '|' || recorded_by from public.breastfeeding_feed_log where patient_id = v_mum limit 1));
  v_real := pg_temp.mkuser(v_org, 'real_mum', 'patient', (current_date - interval '27 years')::date, 'female', false);
  perform pg_temp.ck('a REAL person is refused while maternal_enabled is off', 'The feed log is not open yet', pg_temp.try_as(v_real, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, v_org, v_real)));
  perform pg_temp.guard_state(true);
  perform pg_temp.ck('...and allowed once it is on', 'ok', pg_temp.try_as(v_real, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, v_org, v_real)));
  perform pg_temp.guard_state(false);
  perform pg_temp.ck('a forged clinician source is overwritten', 'patient_entered', (select source from (select source from public.breastfeeding_feed_log where patient_id = v_real) x));
  perform pg_temp.ck('a feed in the far future is refused', 'true', (pg_temp.try_as(v_mum, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, fed_at) values (%L, %L, 'formula', now() + interval '2 days')$q$, v_org, v_mum)) like '%feed_log_not_in_future%')::text);
  perform pg_temp.ck('nobody can write a feed for another person', 'true', (pg_temp.try_as(v_other, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, v_org, v_mum)) like '%row-level security%')::text);
  perform pg_temp.ck('a caregiver with the grant cannot write a feed', 'true', (pg_temp.try_as(v_cgcat, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (%L, %L, 'formula')$q$, v_org, v_mum)) like '%row-level security%')::text);
  perform pg_temp.ck('the mother cannot delete a feed directly', 'permission denied for table breastfeeding_feed_log', pg_temp.try_as(v_mum, 'delete from public.breastfeeding_feed_log'));
  perform pg_temp.ck('an unrelated patient reads no feeds', '0', pg_temp.q_as(v_other, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
  perform pg_temp.ck('a plain view caregiver reads no feeds', '0', pg_temp.q_as(v_cg, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
  perform pg_temp.ck('a Care Circle supporter reads no feeds', '0', pg_temp.q_as(v_sup, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
  perform pg_temp.ck('the care team reads the feeds', '1', pg_temp.q_as(v_clin, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
  perform pg_temp.ck('anon reads nothing', 'permission denied for table breastfeeding_feed_log', pg_temp.try_anon('select 1 from public.breastfeeding_feed_log limit 1'));
  -- a child that is not hers
  v_child := pg_temp.mkchild(v_org, v_other, 'someone_elses_child', current_date - 60, 'male');
  perform pg_temp.ck('a feed cannot be attached to a child she does not manage', 'The child profile is not one you manage',
    pg_temp.try_as(v_mum, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, child_profile_id, feed_type) values (%L, %L, %L, 'formula')$q$, v_org, v_mum, v_child)));
  -- content: placeholders are invisible to patients
  perform pg_temp.ck('placeholder support content is invisible to a patient', '0', pg_temp.q_as(v_mum, 'select count(*)::text from public.maternal_child_content'));
  perform pg_temp.ck('...five placeholders exist for the CMO to write', '5', (select count(*)::text from public.maternal_child_content));
end $$;

-- 4. lifecycle
do $$
declare
  v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_other uuid := pg_temp.f('other'); v_cg uuid := pg_temp.f('cg'); v_cgcat uuid := pg_temp.f('cgcat');
  v_clin uuid := pg_temp.f('clin'); v_sup uuid := pg_temp.f('sup'); v_real uuid; res jsonb; r text; v_new uuid;
begin
  v_new := pg_temp.mkuser(v_org, 'lc_mum', 'patient', (current_date - interval '29 years')::date, 'female');
  perform pg_temp.setf('lc', v_new);
  perform pg_temp.ck('nobody has a lifecycle row: the stage reads tracking', 'tracking|cycle', pg_temp.q_as(v_new, 'select stage || ''|'' || content_set from public.my_lifecycle()'));
  perform pg_temp.ck('the next stage is not inferred from a date: no row is created by reading', '0', (select count(*)::text from public.lifecycle_states where patient_id = v_new));
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_other uuid := pg_temp.f('other'); v_cgcat uuid := pg_temp.f('cgcat'); v_clin uuid := pg_temp.f('clin'); v_sup uuid := pg_temp.f('sup');
  v_a uuid := pg_temp.f('lc'); v_b uuid; v_c uuid; v_real uuid; r text; v_ev uuid;
begin
  -- A: pregnant -> postnatal -> parenting -> tracking, through the function
  perform pg_temp.ck('a confirmed pregnancy moves tracking to pregnant', 'pregnant', pg_temp.q_as(v_a, $q$select public.record_lifecycle_event('pregnancy_confirmed')->>'stage'$q$));
  perform pg_temp.ck('...and sets the pregnancy record', 'true', (select is_pregnant::text from public.patient_pregnancy where patient_id = v_a));
  perform pg_temp.ck('...with exactly one lifecycle event (the hook did not double it)', '1', (select count(*)::text from public.lifecycle_events where patient_id = v_a));
  perform pg_temp.ck('...and the stage change is in the outbox', '1', (select count(*)::text from public.domain_events where event_type = 'lifecycle.stage_changed' and patient_id = v_a));
  perform pg_temp.ck('pregnant again is refused from pregnant', 'That change is not available from this stage', pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('pregnancy_confirmed')$q$));
  perform pg_temp.ck('a future date is refused', 'The date must be today or earlier, and not too long ago', pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('delivery_recorded', current_date + 3)$q$));
  perform pg_temp.ck('a date over 400 days back is refused', 'The date must be today or earlier, and not too long ago', pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('delivery_recorded', current_date - 500)$q$));
  perform pg_temp.ck('an unknown event is refused', 'true', (pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('turned_eighteen')$q$) like '%unknown lifecycle event%')::text);
  perform pg_temp.ck('delivery moves pregnant to postnatal', 'postnatal', pg_temp.q_as(v_a, $q$select public.record_lifecycle_event('delivery_recorded', current_date - 2, null, null, null, 'caesarean')->>'stage'$q$));
  perform pg_temp.ck('...the postnatal record exists with the mode', 'caesarean', (select delivery_mode from public.postnatal_profiles where patient_id = v_a));
  perform pg_temp.ck('...the mother and baby checks were generated', '2|2', (select (select count(*) from public.postnatal_checkins where patient_id = v_a) || '|' || (select count(*) from public.postnatal_baby_checks where patient_id = v_a)));
  perform pg_temp.ck('...no longer pregnant in the pregnancy record', 'false', (select is_pregnant::text from public.patient_pregnancy where patient_id = v_a));
  perform pg_temp.ck('...and delivery.recorded is in the outbox once', '1', (select count(*)::text from public.domain_events where event_type = 'delivery.recorded' and patient_id = v_a));
  perform pg_temp.ck('the app reads content set and rule-set name for the stage', 'postnatal|postnatal|postpartum|false', pg_temp.q_as(v_a, $q$select stage || '|' || content_set || '|' || bp_rule_set || '|' || baby_content_hidden from public.my_lifecycle()$q$));
  perform pg_temp.ck('ending the postnatal period is a confirmed event', 'parenting', pg_temp.q_as(v_a, $q$select public.record_lifecycle_event('postnatal_period_ended')->>'stage'$q$));
  perform pg_temp.ck('...and parenting back to tracking', 'tracking', pg_temp.q_as(v_a, $q$select public.record_lifecycle_event('parenting_ended')->>'stage'$q$));
  begin update public.lifecycle_events set kind = 'start_trying' where patient_id = v_a; perform pg_temp.ck('the history can not be edited', 'refused', 'edited');
  exception when sqlstate '42501' then perform pg_temp.ck('the history can not be edited', 'refused', 'refused'); end;
  perform pg_temp.ck('a loss can not be recorded from tracking', 'That change is not available from this stage', pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('pregnancy_loss_recorded')$q$));
  perform pg_temp.ck('the history is complete and ordered', 'pregnancy_confirmed,delivery_recorded,postnatal_period_ended,parenting_ended', (select string_agg(kind, ',' order by created_at, id) from public.lifecycle_events where patient_id = v_a));
end $$;

do $$
declare
  v_org uuid := pg_temp.f('org'); v_other uuid := pg_temp.f('other'); v_cgcat uuid := pg_temp.f('cgcat'); v_clin uuid := pg_temp.f('clin'); v_sup uuid := pg_temp.f('sup');
  v_teen uuid := pg_temp.f('teen'); v_teencg uuid := pg_temp.f('teencg');
  v_b uuid; v_c uuid; v_real uuid; v_d uuid; v_bcg uuid; g uuid;
begin
  -- B: a loss
  v_b := pg_temp.mkuser(v_org, 'loss_mum', 'patient', (current_date - interval '31 years')::date, 'female');
  perform pg_temp.act(v_b);
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) select v_b, v_cgcat, 'view', v_b returning id into g;
  perform public.set_care_access_categories(g, array['reproductive_health']::public.care_access_category[]);
  perform pg_temp.back();
  insert into public.care_circle_members (organisation_id, patient_id, supporter_id, relationship, permissions, expires_at, is_test)
  values (v_org, v_b, v_sup, 'friend', array['adherence_summary','red_alerts'], now() + interval '30 days', true);
  perform pg_temp.q_as(v_b, $q$select public.record_lifecycle_event('pregnancy_confirmed')$q$);
  perform pg_temp.ck('a loss is recorded from pregnant', 'tracking', pg_temp.q_as(v_b, $q$select public.record_lifecycle_event('pregnancy_loss_recorded', current_date - 1, null, 9, 'a private note')->>'stage'$q$));
  perform pg_temp.ck('...baby and pregnancy content is held back', 'true', pg_temp.q_as(v_b, 'select baby_content_hidden::text from public.my_lifecycle()'));
  perform pg_temp.ck('...for the configured 90 days', (current_date + 90)::text, (select baby_content_hold_until::text from public.lifecycle_states where patient_id = v_b));
  perform pg_temp.ck('...no longer marked pregnant', 'false', (select is_pregnant::text from public.patient_pregnancy where patient_id = v_b));
  perform pg_temp.ck('...and pregnancy.loss_recorded is in the outbox without the note', 'true', (select (count(*) = 1 and bool_and(not (payload::text like '%private%')))::text from public.domain_events where event_type = 'pregnancy.loss_recorded' and patient_id = v_b));
  perform pg_temp.ck('the person reads her loss note', '1', pg_temp.q_as(v_b, 'select count(*)::text from public.pregnancy_loss_records'));
  perform pg_temp.ck('the care team reads it', '1', pg_temp.q_as(v_clin, format('select count(*)::text from public.pregnancy_loss_records where patient_id = %L', v_b)));
  perform pg_temp.ck('a caregiver WITH the reproductive grant does NOT read it', '0', pg_temp.q_as(v_cgcat, format('select count(*)::text from public.pregnancy_loss_records where patient_id = %L', v_b)));
  perform pg_temp.ck('a Care Circle supporter does NOT read it', '0', pg_temp.q_as(v_sup, format('select count(*)::text from public.pregnancy_loss_records where patient_id = %L', v_b)));
  perform pg_temp.ck('a Care Circle supporter does not read the lifecycle', '0', pg_temp.q_as(v_sup, format('select count(*)::text from public.lifecycle_states where patient_id = %L', v_b)));
  perform pg_temp.ck('an unrelated patient does not read it', '0', pg_temp.q_as(v_other, format('select count(*)::text from public.pregnancy_loss_records where patient_id = %L', v_b)));
  perform pg_temp.ck('anon reads neither', 'permission denied for table pregnancy_loss_records', pg_temp.try_anon('select 1 from public.pregnancy_loss_records limit 1'));
  perform pg_temp.ck('nobody inserts a lifecycle row directly', 'permission denied for table lifecycle_states', pg_temp.try_as(v_b, format($q$insert into public.lifecycle_states (patient_id, organisation_id, stage) values (%L, %L, 'postnatal')$q$, v_b, v_org)));
  perform pg_temp.ck('nobody updates a lifecycle row directly', 'permission denied for table lifecycle_states', pg_temp.try_as(v_b, $q$update public.lifecycle_states set stage = 'postnatal'$q$));
  perform pg_temp.ck('the person can not confirm a loss for someone else', 'you can only confirm this for yourself', pg_temp.try_as(v_other, format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, v_b)));
  perform pg_temp.ck('anon can not call the function', 'permission denied for function record_lifecycle_event', pg_temp.try_anon($q$select public.record_lifecycle_event('pregnancy_confirmed')$q$));

  -- a clinician records for a patient: clinician_recorded
  v_c := pg_temp.mkuser(v_org, 'clin_pat', 'patient', (current_date - interval '33 years')::date, 'female');
  perform pg_temp.q_as(v_clin, format($q$select public.record_lifecycle_event('pregnancy_confirmed', current_date, %L)$q$, v_c));
  perform pg_temp.q_as(v_clin, format($q$select public.record_lifecycle_event('pregnancy_loss_recorded', current_date, %L, 7, 'by the team')$q$, v_c));
  perform pg_temp.ck('a clinician-recorded event is marked so', 'clinician_recorded,clinician_recorded', (select string_agg(cause, ',') from public.lifecycle_events where patient_id = v_c));
  perform pg_temp.ck('...and its loss note is clinician_recorded (sealed, S68g)', 'clinician_recorded', (select source from public.pregnancy_loss_records where patient_id = v_c));

  -- C: hooks on the existing records. No inference.
  v_d := pg_temp.mkuser(v_org, 'hook_mum', 'patient', (current_date - interval '26 years')::date, 'female');
  perform pg_temp.act(v_d);
  insert into public.patient_pregnancy (organisation_id, patient_id, is_pregnant) values (v_org, v_d, true);
  perform pg_temp.back();
  perform pg_temp.ck('setting the pregnancy record moves the stage (a confirmation by the person)', 'pregnant', (select stage from public.lifecycle_states where patient_id = v_d));
  perform pg_temp.act(v_d); update public.patient_pregnancy set is_pregnant = false where patient_id = v_d; perform pg_temp.back();
  perform pg_temp.ck('switching the record OFF does not move the stage: no inference', 'pregnant', (select stage from public.lifecycle_states where patient_id = v_d));
  perform pg_temp.act(v_d); insert into public.postnatal_profiles (organisation_id, patient_id, delivery_date) values (v_org, v_d, current_date - 1); perform pg_temp.back();
  perform pg_temp.ck('a delivery record moves it to postnatal', 'postnatal', (select stage from public.lifecycle_states where patient_id = v_d));
  perform pg_temp.ck('...cause is the postnatal record', 'postnatal_record', (select cause from public.lifecycle_events where patient_id = v_d and kind = 'delivery_recorded'));

  -- D: guard off refuses a REAL person; on allows
  v_real := pg_temp.mkuser(v_org, 'real_lc', 'patient', (current_date - interval '25 years')::date, 'female', false);
  perform pg_temp.ck('a real person is refused while maternal_enabled is off', 'This is not open yet', pg_temp.try_as(v_real, $q$select public.record_lifecycle_event('pregnancy_confirmed')$q$));
  perform pg_temp.guard_state(true);
  perform pg_temp.ck('...and allowed once it is on', 'pregnant', pg_temp.q_as(v_real, $q$select public.record_lifecycle_event('pregnancy_confirmed')->>'stage'$q$));
  perform pg_temp.guard_state(false);

  -- E: adolescent: a caregiver with the grant still cannot read an adolescent's lifecycle (age gate)
  perform pg_temp.q_as(v_teen, $q$select public.record_lifecycle_event('pregnancy_confirmed')$q$);
  perform pg_temp.ck('the adolescent reads her own stage', 'pregnant', pg_temp.q_as(v_teen, 'select stage from public.my_lifecycle()'));
  perform pg_temp.ck('her caregiver, even with the reproductive grant, reads no lifecycle row (adolescent gate)', '0', pg_temp.q_as(v_teencg, format('select count(*)::text from public.lifecycle_states where patient_id = %L', v_teen)));
end $$;

-- 6. SABOTAGE
do $$
declare v_def text;
begin
  -- (a) the item 10 override removed
  v_def := pg_get_functiondef('private.enforce_epds_rules()'::regprocedure);
  execute replace(v_def, 'and (v_items ->> (v_n - 1))::integer > 0', 'and false');
  -- (b) the lifecycle transition check removed
  v_def := pg_get_functiondef('private.lifecycle_apply(uuid,text,date,text,uuid,boolean)'::regprocedure);
  execute replace(v_def, 'if not (v_state.stage in (select jsonb_array_elements_text(v_rule -> ''from''))) then', 'if false then');
end $$;
-- (c) the caregiver gate opened on the feed log
drop policy breastfeeding_feed_log_select on public.breastfeeding_feed_log;
create policy breastfeeding_feed_log_select on public.breastfeeding_feed_log for select to authenticated using (true);
do $$
declare v_org uuid := pg_temp.f('org'); v_p uuid; v_a uuid := pg_temp.f('lc'); v_other uuid := pg_temp.f('other'); v_mum uuid := pg_temp.f('mum');
begin
  v_p := pg_temp.mkuser(v_org, 'sab_epds', 'patient');
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, crisis_flagged, item_responses) values (v_org, v_p, 'epds', 0, 'minimal', false, '{"items":[0,0,0,0,0,0,0,0,0,1]}');
  insert into results values ('sabotaged', 'EPDS: total 1 with item 10 = 1 is stored as a crisis', 'true', (select crisis_flagged::text from public.mental_health_screens where patient_id = v_p));
  insert into results values ('sabotaged', 'a loss can not be recorded from tracking', 'That change is not available from this stage', coalesce(nullif(pg_temp.try_as(v_a, $q$select public.record_lifecycle_event('pregnancy_loss_recorded')$q$), 'ok'), 'accepted'));
  insert into results values ('sabotaged', 'an unrelated patient reads no feeds', '0', pg_temp.q_as(v_other, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S68 EPDS/postnatal/lifecycle proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

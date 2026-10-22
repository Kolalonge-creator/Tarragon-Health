-- S58b proof: pending credit, milestone celebrations, points returned on refund
-- (migration *_s58b_pending_credit_milestones_refund_restore).
--
--   1. DEFINITIONS: seven versioned milestones, none naming a body metric; a body-metric milestone is refused by the table.
--   2. EVENT DRIVEN + IDEMPOTENT: a first blood pressure / glucose check, lab, review, lesson, course celebrate once; a replay or a later
--      repeat writes nothing; one milestone.achieved event with ids only. Implausible readings and body-size readings never celebrate.
--      A dangerous but plausible first reading still celebrates the step (the result is never the point).
--   3. FOUR WEEKS OF CHECK-INS: 24 of the last 28 Lagos days (grace from streak_grace) celebrates; 23 does not.
--   4. SAFETY: nothing is shown while an emergency is open (and the card is returned again when there is none); never for another person.
--   5. APPEND-ONLY + RLS: own rows only, no write grant, no update of the facts, one dismissal sticks, anon refused.
--   6. PENDING CREDIT: an undecided point-earning event is listed with when it is expected and when to ask; decided or old events are not;
--      another person sees nothing; anon refused.
--   7. REFUND: a paid order that spent points returns them once (kind 'release', not earning, lifetime unchanged); an order that spent
--      nothing returns nothing; a cancelled order never touched the balance; the duplicate is blocked by the ledger key.
--   8. ISOLATION: a milestone failure is audited and never undoes or blocks the award.
--   9. NO SECOND REDEMPTION PATH: no reward_redemptions table and no apply_points_discount function.
--  SABOTAGE: body-metric constraint dropped; replay protection removed; emergency suppression removed; refund branch removed. Each must flip.
begin;

create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's58b-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S58b ' || p_label, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true;
  update public.profiles set date_of_birth = current_date - interval '35 years' where id = v;
  return v;
end $f$;
create function pg_temp.as_try(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.as_json(p_uid uuid, p_sql text) returns jsonb language plpgsql as $f$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := jsonb_build_object('error', sqlstate); end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.as_count(p_uid uuid, p_sql text) returns integer language plpgsql as $f$
declare n integer;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into n; exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
-- emit a synthetic event (optionally in the past) and run the awarder, which also evaluates milestones
create function pg_temp.fire(p_patient uuid, p_type text, p_key text, p_when timestamptz default null) returns uuid language plpgsql as $f$
declare v_org uuid; v_e uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  v_e := private.emit_domain_event(p_type, v_org,
    coalesce((select jsonb_object_agg(k, 'x') from public.event_type_versions v, unnest(v.required_keys) k where v.event_type = p_type and v.version = 1), '{}'::jsonb),
    p_key, p_patient, null, null, 'normal', null, null, p_when);
  perform pg_temp.setf('lastev', v_e);
  return v_e;
end $f$;
create function pg_temp.has_ms(p uuid, p_code text) returns boolean language sql as
$$ select exists (select 1 from public.milestones_achieved where patient_id = p and milestone_code = p_code) $$;
create function pg_temp.vit_event(p_vid uuid) returns uuid language sql as
$$ select id from public.domain_events where event_type = 'vitals.logged' and aggregate_id = p_vid $$;
create function pg_temp.mkorder(p_org uuid, p_buyer uuid, p_points integer, p_ref text) returns uuid language plpgsql as $f$
declare v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
begin
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, uses)
  values (v_item, p_org, 's58b_' || substr(replace(v_item::text, '-', ''), 1, 12), 'consultation', 'n', 'd', 1);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo) values (v_price, p_org, v_item, 475000);
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, list_amount_kobo,
                             points_applied, points_reduction_kobo, paystack_reference, is_test)
  values (v_o, p_org, p_buyer, p_buyer, v_item, v_price, 475000, 500000, p_points, case when p_points > 0 then 25000 else 0 end, p_ref, true);
  return v_o;
end $f$;
create function pg_temp.bal(p uuid) returns integer language sql as $$ select coalesce((select balance from public.wellness_points_balances where patient_id = p), 0) $$;

do $$
declare
  v_org uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_g uuid; v_h uuid; v_p uuid; v_r uuid; v_r2 uuid; v_r3 uuid;
  v_vid uuid; v_ev uuid; v_t1 timestamptz; v_iso_award integer; v_iso_audit boolean; v_iso_inc boolean; v_minor uuid; v_hist uuid; v_pl uuid; v_nb uuid; v_i integer; v_j jsonb; v_m uuid; v_o uuid; v_life integer;
begin
  select organisation_id into v_org from public.profiles where role = 'admin' limit 1;
  v_a := pg_temp.mkuser(v_org, 'a', 'patient'); v_b := pg_temp.mkuser(v_org, 'b', 'patient');
  v_c := pg_temp.mkuser(v_org, 'c', 'patient'); v_d := pg_temp.mkuser(v_org, 'd', 'patient');
  v_g := pg_temp.mkuser(v_org, 'g', 'patient'); v_h := pg_temp.mkuser(v_org, 'h', 'patient');
  v_p := pg_temp.mkuser(v_org, 'p', 'patient'); v_r := pg_temp.mkuser(v_org, 'r', 'patient');
  v_r2 := pg_temp.mkuser(v_org, 'r2', 'patient'); v_r3 := pg_temp.mkuser(v_org, 'r3', 'patient');

  -- ================= 1. definitions =================
  perform pg_temp.ck('1a seven milestones are seeded and active', (select count(*) from public.milestone_definitions where is_active) >= 7);
  perform pg_temp.ck('1b none names a body metric', not exists (select 1 from public.milestone_definitions
    where private.reward_text_mentions_body_metric(code) or private.reward_text_mentions_body_metric(trigger_event) or private.reward_text_mentions_body_metric(params::text)));
  begin
    insert into public.milestone_definitions (code, version, kind, trigger_event) values ('first_weight_check', 1, 'first_event', 'vitals.logged');
    perform pg_temp.ck('1c a body-metric milestone is refused', false);
  exception when check_violation then perform pg_temp.ck('1c a body-metric milestone is refused', true); end;
  perform pg_temp.ck('1d the celebrations are only the care steps in the brief',
    (select array_agg(code order by code) from public.milestone_definitions where is_active and version = 1) @>
      array['adherence_4_weeks','first_bp_logged','first_course_completed','first_glucose_logged','first_lab_done','first_lesson_completed','first_review_attended']);

  -- ================= 2. event driven, idempotent =================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_a, 'blood_pressure', 118, 76, 'manual') returning id into v_vid;
  update public.vitals_readings set created_at = now() - interval '10 days' where id = v_vid;
  v_ev := pg_temp.vit_event(v_vid);
  perform public.points_award(v_ev);
  perform pg_temp.ck('2a the first blood pressure check celebrates', pg_temp.has_ms(v_a, 'first_bp_logged'));
  perform pg_temp.ck('2b and does not celebrate glucose', not pg_temp.has_ms(v_a, 'first_glucose_logged'));
  perform public.points_award(v_ev);
  perform pg_temp.ck('2c a replay of the same event writes nothing more', (select count(*) from public.milestones_achieved where patient_id = v_a) = 1
    and (select count(*) from public.domain_events where event_type = 'milestone.achieved' and patient_id = v_a) = 1);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_a, 'blood_pressure', 122, 80, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2d a later blood pressure check does not celebrate again', (select count(*) from public.milestones_achieved where patient_id = v_a and milestone_code = 'first_bp_logged') = 1);
  perform pg_temp.ck('2e the event carries ids only', (select payload from public.domain_events where event_type = 'milestone.achieved' and patient_id = v_a) ?& array['milestone_id']
    and (select count(*) from jsonb_object_keys((select payload from public.domain_events where event_type = 'milestone.achieved' and patient_id = v_a))) = 1);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, source) values (v_org, v_a, 'glucose', 6.1, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2f the first glucose check celebrates on its own', pg_temp.has_ms(v_a, 'first_glucose_logged'));
  -- implausible and body-size readings
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_b, 'blood_pressure', 400, 20, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2g an implausible reading does not celebrate', not pg_temp.has_ms(v_b, 'first_bp_logged'));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source) values (v_org, v_b, 'weight', 70, 'manual');
  perform pg_temp.ck('2h a weight reading emits nothing and celebrates nothing', not exists (select 1 from public.milestones_achieved where patient_id = v_b)
    and not exists (select 1 from public.domain_events e where e.event_type = 'vitals.logged' and e.patient_id = v_b
      and (e.payload ->> 'vitals_id')::uuid in (select id from public.vitals_readings where patient_id = v_b and vital_type::text = 'weight')));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_d, 'blood_pressure', 190, 120, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2i a dangerous but plausible first reading still celebrates the step (the result is never the point)', pg_temp.has_ms(v_d, 'first_bp_logged'));
  -- other care steps
  perform public.points_award(pg_temp.fire(v_c, 'lab_result.released', 'ms-lab', now() - interval '5 days'));
  perform public.points_award(pg_temp.fire(v_c, 'encounter.completed', 'ms-enc', now() - interval '5 days'));
  perform public.points_award(pg_temp.fire(v_c, 'lesson.completed', 'ms-les', now() - interval '5 days'));
  perform public.points_award(pg_temp.fire(v_c, 'course.completed', 'ms-crs', now() - interval '5 days'));
  perform pg_temp.ck('2j lab, review, lesson and course each celebrate once',
    pg_temp.has_ms(v_c, 'first_lab_done') and pg_temp.has_ms(v_c, 'first_review_attended')
    and pg_temp.has_ms(v_c, 'first_lesson_completed') and pg_temp.has_ms(v_c, 'first_course_completed'));
  perform public.points_award(pg_temp.fire(v_c, 'lab_result.released', 'ms-lab2'));
  perform pg_temp.ck('2k a second lab does not celebrate again', (select count(*) from public.milestones_achieved where patient_id = v_c and milestone_code = 'first_lab_done') = 1);

  -- ================= 2b. an existing member is not told their next reading is a first =================
  v_hist := pg_temp.mkuser(v_org, 'hist', 'patient'); v_pl := pg_temp.mkuser(v_org, 'pulse', 'patient'); v_nb := pg_temp.mkuser(v_org, 'newbie', 'patient');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, created_at)
  select v_org, v_hist, 'blood_pressure', 120 + (i % 10), 80, 'wearable', now() - interval '60 days' + make_interval(mins => i) from generate_series(1, 500) i;
  perform pg_temp.ck('2b1 the history rows exist and emitted no events', (select count(*) from public.vitals_readings where patient_id = v_hist) = 500
    and not exists (select 1 from public.domain_events where patient_id = v_hist));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_hist, 'blood_pressure', 124, 82, 'manual') returning id into v_vid;
  v_ev := pg_temp.vit_event(v_vid);
  perform public.points_award(v_ev);
  perform pg_temp.ck('2b2 a person with 500 earlier readings gets no first blood pressure card', not pg_temp.has_ms(v_hist, 'first_bp_logged'));
  perform public.points_award(v_ev); perform public.points_award(v_ev);
  perform pg_temp.ck('2b3 replays leave it that way', not pg_temp.has_ms(v_hist, 'first_bp_logged'));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_nb, 'blood_pressure', 124, 82, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2b4 a brand-new person still gets the card', pg_temp.has_ms(v_nb, 'first_bp_logged'));
  -- a lab released earlier (an earlier event; the lab_results source-table branch needs the full schema fixture and is covered by the real-schema run) means the next one is not a first
  perform pg_temp.fire(v_hist, 'lab_result.released', 'hist-lab-old', now() - interval '90 days');
  perform public.points_award(pg_temp.fire(v_hist, 'lab_result.released', 'hist-lab'));
  perform pg_temp.ck('2b5 an earlier released lab stops a first-lab card', not pg_temp.has_ms(v_hist, 'first_lab_done'));
  -- the same rule as points: any implausible measured field earns nothing and is no milestone
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, pulse_bpm, source) values (v_org, v_pl, 'blood_pressure', 120, 80, 300, 'manual') returning id into v_vid;
  perform public.points_award(pg_temp.vit_event(v_vid));
  perform pg_temp.ck('2b6 a blood pressure reading with an implausible pulse is no milestone', not pg_temp.has_ms(v_pl, 'first_bp_logged'));
  -- a silent backfill row: born dismissed, no event, stops a card; a non-backfilled row without an event is refused
  insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id, backfilled, seen_at, dismissed_at)
  values (v_org, v_pl, 'first_lesson_completed', 1, null, true, now(), now());
  perform public.points_award(pg_temp.fire(v_pl, 'lesson.completed', 'bf-les'));
  perform pg_temp.ck('2b7 a backfilled row stands, is dismissed and a later lesson adds nothing',
    (select count(*) from public.milestones_achieved where patient_id = v_pl and milestone_code = 'first_lesson_completed') = 1
    and pg_temp.as_json(v_pl, $q$select public.my_pending_milestone()$q$) is null);
  begin
    insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id) values (v_org, v_pl, 'first_lab_done', 1, null);
    perform pg_temp.ck('2b8 an ordinary row must carry its event', false);
  exception when check_violation then perform pg_temp.ck('2b8 an ordinary row must carry its event', true); end;

  -- ================= 3. four weeks of check-ins (24 of 28 Lagos days with the proposed grace) =================
  for v_i in 0 .. 27 loop
    if v_i not in (3, 10, 17, 24) then perform pg_temp.fire(v_g, 'adherence.checkin_answered', 'ms-adh-g-' || v_i, now() - make_interval(days => v_i)); end if;
  end loop;
  perform public.points_award(pg_temp.fire(v_g, 'adherence.checkin_answered', 'ms-adh-g-last', now()));
  perform pg_temp.ck('3a 24 of the last 28 days celebrates four weeks', pg_temp.has_ms(v_g, 'adherence_4_weeks'));
  for v_i in 0 .. 27 loop
    if v_i not in (3, 8, 13, 18, 24) then perform pg_temp.fire(v_h, 'adherence.checkin_answered', 'ms-adh-h-' || v_i, now() - make_interval(days => v_i)); end if;
  end loop;
  perform public.points_award(pg_temp.fire(v_h, 'adherence.checkin_answered', 'ms-adh-h-last', now()));
  perform pg_temp.ck('3b 23 of the last 28 days does not (and nothing says it fell short)', not pg_temp.has_ms(v_h, 'adherence_4_weeks'));

  -- ================= 4. safety: nothing while an emergency is open =================
  v_j := pg_temp.as_json(v_a, $q$select public.my_pending_milestone()$q$);
  perform pg_temp.ck('4a a person with no emergency is shown the oldest card', v_j ->> 'code' = 'first_bp_logged');
  if not exists (select 1 from public.emergency_events where patient_id = v_d and status in ('active', 'acknowledged')) then
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status) values (v_org, v_d, 'bp_reading', 'proof reading', 'active');
  end if;
  perform pg_temp.ck('4b a person with an open emergency is shown nothing',
    exists (select 1 from public.emergency_events where patient_id = v_d and status in ('active', 'acknowledged'))
    and pg_temp.as_json(v_d, $q$select public.my_pending_milestone()$q$) is null);
  perform pg_temp.ck('4c the card was not stamped as seen while suppressed', (select seen_at from public.milestones_achieved where patient_id = v_d and milestone_code = 'first_bp_logged') is null);
  perform pg_temp.ck('4d another person never sees someone else''s card', pg_temp.as_json(v_b, $q$select public.my_pending_milestone()$q$) is null);

  -- ================= 5. append-only and RLS =================
  perform pg_temp.ck('5a a person reads only their own milestone rows', pg_temp.as_count(v_a, 'select count(*)::int from public.milestones_achieved') = 2
    and pg_temp.as_count(v_b, 'select count(*)::int from public.milestones_achieved') = 0);
  perform pg_temp.ck('5b no write grant for patients', pg_temp.as_try(v_a, format($q$insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id) values (%L, %L, 'x', 1, %L)$q$, v_org, v_a, v_ev)) = '42501'
    and pg_temp.as_try(v_a, $q$update public.milestones_achieved set dismissed_at = now()$q$) = '42501'
    and pg_temp.as_try(v_a, $q$delete from public.milestones_achieved$q$) = '42501');
  perform pg_temp.ck('5c anon is refused', pg_temp.as_try(null, 'select * from public.milestones_achieved') = '42501'
    and pg_temp.as_try(null, 'select public.my_pending_milestone()') = '42501' and pg_temp.as_try(null, 'select public.my_points_pending()') = '42501');
  v_m := (select id from public.milestones_achieved where patient_id = v_a and milestone_code = 'first_bp_logged');
  begin update public.milestones_achieved set milestone_code = 'first_lab_done' where id = v_m; perform pg_temp.ck('5d the stored fact cannot be rewritten', false);
  exception when sqlstate 'P0001' then perform pg_temp.ck('5d the stored fact cannot be rewritten', true); end;
  begin delete from public.milestones_achieved where id = v_m; perform pg_temp.ck('5e a row cannot be deleted', false);
  exception when sqlstate 'P0001' then perform pg_temp.ck('5e a row cannot be deleted', true); end;
  perform pg_temp.ck('5f dismissing another person''s card does nothing', pg_temp.as_json(v_b, format($q$select to_jsonb(public.dismiss_milestone(%L))$q$, v_m)) = 'false'::jsonb);
  perform pg_temp.ck('5g the owner dismisses it, then it is not shown again',
    pg_temp.as_json(v_a, format($q$select to_jsonb(public.dismiss_milestone(%L))$q$, v_m)) = 'true'::jsonb
    and pg_temp.as_json(v_a, $q$select public.my_pending_milestone()$q$) ->> 'code' = 'first_glucose_logged');
  v_t1 := (select dismissed_at from public.milestones_achieved where id = v_m);
  perform pg_temp.as_json(v_a, format($q$select to_jsonb(public.dismiss_milestone(%L))$q$, v_m));
  perform pg_temp.ck('5h one dismissal sticks (the first time stays)', v_t1 is not null and (select dismissed_at from public.milestones_achieved where id = v_m) = v_t1);
  -- shown card older than the display window is not returned
  insert into public.milestones_achieved (organisation_id, patient_id, milestone_code, milestone_version, event_id, seen_at)
  values (v_org, v_b, 'first_lab_done', 1, v_ev, now() - interval '100 hours');
  perform pg_temp.ck('5i a card first shown over 72 hours ago is no longer returned', pg_temp.as_json(v_b, $q$select public.my_pending_milestone()$q$) is null);

  -- ================= 6. pending credit =================
  perform pg_temp.fire(v_p, 'meal.logged', 'pend-1');
  v_j := pg_temp.as_json(v_p, $q$select public.my_points_pending()$q$);
  perform pg_temp.ck('6a an undecided point-earning event is listed', jsonb_array_length(v_j) = 1 and v_j -> 0 -> 'rule_codes' ? 'meal_logged');
  perform pg_temp.ck('6b it says when it is expected and is not yet asking for support', (v_j -> 0 ->> 'expected_by')::timestamptz > now() and (v_j -> 0 ->> 'ask_support') = 'false');
  perform pg_temp.ck('6c another person sees nothing', jsonb_array_length(pg_temp.as_json(v_b, $q$select public.my_points_pending()$q$)) = 0);
  perform pg_temp.fire(v_p, 'meal.logged', 'pend-old', now() - interval '3 hours');
  perform pg_temp.ck('6d an action older than the ask window offers the support route', exists (
    select 1 from jsonb_array_elements(pg_temp.as_json(v_p, $q$select public.my_points_pending()$q$)) x where (x ->> 'ask_support') = 'true'));
  perform pg_temp.fire(v_p, 'meal.logged', 'pend-ancient', now() - interval '5 days');
  perform pg_temp.ck('6e an action older than the look-back is not listed', jsonb_array_length(pg_temp.as_json(v_p, $q$select public.my_points_pending()$q$)) = 2);
  v_ev := (select id from public.domain_events where event_type = 'meal.logged' and idempotency_key = 'pend-1');
  perform public.points_award(v_ev);
  perform pg_temp.ck('6f once decided (awarded, capped or not eligible) it is no longer pending', not exists (
    select 1 from jsonb_array_elements(pg_temp.as_json(v_p, $q$select public.my_points_pending()$q$)) x where (x ->> 'event_id')::uuid = v_ev));
  perform pg_temp.ck('6g the pending list carries only ids, codes and times',
    (select array_agg(k order by k) from jsonb_object_keys(v_j -> 0) k) = array['ask_support', 'event_id', 'expected_by', 'rule_codes', 'since']);

  -- pending credit ignores anything older than the rollout date in config (a new proposed version, rolled back with the transaction)
  insert into public.reward_config (key, version, value) values ('pending_credit', 2, jsonb_build_object('expected_within_minutes', 15, 'ask_after_minutes', 120, 'look_back_hours', 72, 'ignore_before', (current_date + 1)::text));
  perform pg_temp.fire(v_p, 'meal.logged', 'pend-pre-rollout');
  perform pg_temp.ck('6h an undecided event from before the rollout date is not listed as pending', jsonb_array_length(pg_temp.as_json(v_p, $q$select public.my_points_pending()$q$)) = 0);
  update public.reward_config set is_active = false where key = 'pending_credit' and version = 2;

  -- ================= 6b. age gate: not shown to under 18 by default =================
  v_minor := pg_temp.mkuser(v_org, 'minor', 'patient');
  update public.profiles set date_of_birth = current_date - interval '12 years' where id = v_minor;
  perform public.points_award(pg_temp.fire(v_minor, 'lab_result.released', 'ms-minor-lab'));
  perform pg_temp.ck('6b1 a minor''s milestone is still recorded', pg_temp.has_ms(v_minor, 'first_lab_done'));
  perform pg_temp.ck('6b2 but no card is shown to a minor by default', pg_temp.as_json(v_minor, $q$select public.my_pending_milestone()$q$) is null);
  insert into public.reward_config (key, version, value) values ('milestone_display', 2, '{"show_for_hours":72,"show_to_minors":true}');
  perform pg_temp.ck('6b3 turning the versioned switch on shows it', pg_temp.as_json(v_minor, $q$select public.my_pending_milestone()$q$) ->> 'code' = 'first_lab_done');
  update public.reward_config set is_active = false where key = 'milestone_display' and version = 2;

  -- ================= 7. refund returns spent points =================
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned) values (v_r, v_org, 700, 700)
  on conflict (patient_id) do update set balance = 700, lifetime_earned = 700;
  v_o := pg_temp.mkorder(v_org, v_r, 500, 'S58B-REF-1');
  update public.orders set state = 'paid' where id = v_o;
  perform pg_temp.ck('7a payment spends the points once', pg_temp.bal(v_r) = 200);
  update public.orders set state = 'refunded' where id = v_o;
  perform pg_temp.ck('7b a refund returns exactly what was spent', pg_temp.bal(v_r) = 700);
  perform pg_temp.ck('7c the return is a release row tied to the order, not earning',
    (select count(*) from public.wellness_points_ledger where patient_id = v_r and source_id = v_o and reason = 'order_refunded' and kind = 'release' and points = 500) = 1);
  perform pg_temp.ck('7d lifetime earned is unchanged by the return', (select lifetime_earned from public.wellness_points_balances where patient_id = v_r) = 700);
  perform pg_temp.ck('7e the return is not counted as earning in the yearly status',
    (private.points_status_for(v_r) ->> 'year_points')::integer = (select coalesce(sum(points), 0) from public.wellness_points_ledger where patient_id = v_r and kind = 'earn' and points > 0));
  begin
    insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, source_table, source_id, kind)
    values (v_org, v_r, 500, 1200, 'order_refunded', 'orders', v_o, 'release');
    perform pg_temp.ck('7f a second return for the same order is blocked by the ledger key', false);
  exception when unique_violation then perform pg_temp.ck('7f a second return for the same order is blocked by the ledger key', true); end;
  -- nothing spent (no balance at payment): nothing to return
  v_o := pg_temp.mkorder(v_org, v_r2, 500, 'S58B-REF-2');
  update public.orders set state = 'paid' where id = v_o;
  update public.orders set state = 'refunded' where id = v_o;
  perform pg_temp.ck('7g an order that spent nothing returns nothing', not exists (select 1 from public.wellness_points_ledger where patient_id = v_r2) and pg_temp.bal(v_r2) = 0);
  -- cancelled order never touched the balance
  insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned) values (v_r3, v_org, 300, 300)
  on conflict (patient_id) do update set balance = 300, lifetime_earned = 300;
  v_o := pg_temp.mkorder(v_org, v_r3, 200, 'S58B-REF-3');
  update public.orders set state = 'cancelled' where id = v_o;
  perform pg_temp.ck('7h a cancelled order spends and returns nothing', pg_temp.bal(v_r3) = 300 and not exists (select 1 from public.wellness_points_ledger where patient_id = v_r3));

  -- ================= 8. isolation: a milestone failure never blocks the award =================
  begin
    create or replace function private.milestones_evaluate_event(p_event uuid) returns integer language plpgsql as $x$ begin raise exception 'boom'; end $x$;
    v_ev := pg_temp.fire(v_p, 'lesson.completed', 'iso-1');
    v_iso_award := public.points_award(v_ev);
    v_iso_audit := exists (select 1 from public.audit_log where action = 'milestone_event.error' and entity_id = v_ev);
    v_iso_inc := exists (select 1 from public.ops_incidents where external_reference = 'milestone_event_failed' and status not in ('resolved', 'closed'));
    raise exception 'rollback_iso';
  exception when others then if sqlerrm <> 'rollback_iso' then raise; end if; end;
  perform pg_temp.ck('8a the award is returned although milestones fail', v_iso_award = 20);
  perform pg_temp.ck('8b the failure is audited, not silent', v_iso_audit);
  perform pg_temp.ck('8c and loud: one open sev3 incident is raised', v_iso_inc);

  -- ================= 9. no second redemption path =================
  perform pg_temp.ck('9a no reward_redemptions table, no apply_points_discount function',
    to_regclass('public.reward_redemptions') is null and to_regprocedure('public.apply_points_discount(uuid,integer)') is null
    and to_regprocedure('public.release_points_discount(uuid)') is null);
  perform pg_temp.ck('9b the checkout switch stays where S73 put it and is off',
    coalesce((select (rules -> 'points' ->> 'enabled')::boolean from public.pricing_config where is_active limit 1), false) = false);
end $$;

-- ================= SABOTAGE (each must flip a check; sub-blocks roll back) =================
do $$
declare v_flip boolean; v_def text; v_org uuid; v_p uuid := gen_random_uuid(); v_e uuid; v_n integer; v_o uuid; v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_vid2 uuid;
begin
  select organisation_id into v_org from public.profiles where role = 'admin' limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 's58b-sab@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test, date_of_birth) values (v_p, v_org, 'patient', 'S58b sab', true, current_date - interval '35 years')
  on conflict (id) do update set is_test = true;

  -- A. body-metric constraint dropped => a weight milestone would be accepted
  begin
    alter table public.milestone_definitions drop constraint milestone_definitions_no_body_metric;
    insert into public.milestone_definitions (code, version, kind, trigger_event) values ('first_weight_check', 1, 'first_event', 'vitals.logged');
    v_flip := true;
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE A: without the constraint a body-metric milestone is accepted (so check 1c really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: body-metric milestone test'; end if;

  -- B. replay protection removed => a second lab celebrates twice
  begin
    v_def := pg_get_functiondef('private.milestones_evaluate_event(uuid)'::regprocedure);
    v_def := replace(v_def, 'if exists (select 1 from public.milestones_achieved a where a.patient_id = e.patient_id and a.milestone_code = d.code) then', 'if false then');
    v_def := replace(v_def, 'on conflict (patient_id, milestone_code) do nothing', '');
    v_def := replace(v_def, 'and not private.milestone_has_earlier(e, d.code, d.params ->> ''requires'')', '');
    execute v_def;
    alter table public.milestones_achieved drop constraint milestones_achieved_patient_id_milestone_code_key;
    v_e := private.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"x"}', 'sab-lab-1', v_p);
    perform private.milestones_evaluate_event(v_e);
    v_e := private.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"x"}', 'sab-lab-2', v_p);
    perform private.milestones_evaluate_event(v_e);
    select count(*) into v_n from public.milestones_achieved where patient_id = v_p and milestone_code = 'first_lab_done';
    v_flip := v_n = 2;
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE B: without the existence check and the unique key a repeat celebrates again (so checks 2c, 2k really guard it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: replay milestone test'; end if;

  -- C. emergency suppression removed => the card is returned during an emergency
  begin
    v_e := private.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"x"}', 'sab-lab-3', v_p);
    perform private.milestones_evaluate_event(v_e);
    insert into public.emergency_events (organisation_id, patient_id, source, trigger_detail, status) values (v_org, v_p, 'bp_reading', 'proof', 'active');
    v_def := pg_get_functiondef('public.my_pending_milestone()'::regprocedure);
    v_def := replace(v_def, 'if exists (select 1 from public.emergency_events x where x.patient_id = v_uid and x.status in (''active'', ''acknowledged'')) then', 'if false then');
    execute v_def;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    v_flip := public.my_pending_milestone() is not null;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE C: without the guard a card appears during an open emergency (so check 4b really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: emergency suppression test'; end if;

  -- E. age gate removed => a minor is shown a card
  begin
    update public.profiles set date_of_birth = current_date - interval '12 years' where id = v_p;
    v_e := private.emit_domain_event('lab_result.released', v_org, '{"lab_result_id":"x"}', 'sab-lab-4', v_p);
    perform private.milestones_evaluate_event(v_e);
    v_def := pg_get_functiondef('public.my_pending_milestone()'::regprocedure);
    v_def := replace(v_def, 'if not coalesce((v_cfg ->> ''show_to_minors'')::boolean, false)', 'if false');
    execute v_def;
    perform set_config('request.jwt.claims', json_build_object('sub', v_p, 'role', 'authenticated')::text, true);
    v_flip := public.my_pending_milestone() is not null;
    perform set_config('request.jwt.claims', '', true);
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE E: without the age gate a minor is shown a card (so check 6b2 really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: age gate test'; end if;

  -- F. earlier-history check removed => an existing member's next reading is called a first
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source, created_at) values (v_org, v_p, 'blood_pressure', 120, 80, 'wearable', now() - interval '3 days');
    v_def := pg_get_functiondef('private.milestones_evaluate_event(uuid)'::regprocedure);
    v_def := replace(v_def, 'and not private.milestone_has_earlier(e, d.code, d.params ->> ''requires'')', '');
    execute v_def;
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_p, 'blood_pressure', 124, 82, 'manual') returning id into v_vid2;
    perform private.milestones_evaluate_event(pg_temp.vit_event(v_vid2));
    v_flip := pg_temp.has_ms(v_p, 'first_bp_logged');
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE F: without the earlier-history check an existing member gets a first card (so check 2b2 really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: earlier history test'; end if;

  -- D. refund branch removed => points are not returned
  begin
    insert into public.wellness_points_balances (patient_id, organisation_id, balance, lifetime_earned) values (v_p, v_org, 700, 700)
    on conflict (patient_id) do update set balance = 700, lifetime_earned = 700;
    v_def := pg_get_functiondef('private.orders_pricing_effects()'::regprocedure);
    v_def := replace(v_def, 'elsif new.state = ''refunded'' and new.points_applied > 0 then', 'elsif false then');
    execute v_def;
    insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, uses)
    values (v_item, v_org, 's58b_sab_' || substr(replace(v_item::text, '-', ''), 1, 8), 'consultation', 'n', 'd', 1);
    insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo) values (v_price, v_org, v_item, 475000);
    v_o := gen_random_uuid();
    insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, list_amount_kobo, points_applied, points_reduction_kobo, paystack_reference, is_test)
    values (v_o, v_org, v_p, v_p, v_item, v_price, 475000, 500000, 500, 25000, 'S58B-SAB', true);
    update public.orders set state = 'paid' where id = v_o;
    update public.orders set state = 'refunded' where id = v_o;
    v_flip := (select balance from public.wellness_points_balances where patient_id = v_p) = 200;
    raise exception 'rollback_sab';
  exception when others then if sqlerrm <> 'rollback_sab' then v_flip := false; end if; end;
  insert into results(check_name, ok) values ('SABOTAGE D: without the refund branch the points stay spent (so check 7b really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: refund test'; end if;
end $$;

select check_name, ok from results order by n;
select count(*) filter (where not ok) as failures from results;
rollback;

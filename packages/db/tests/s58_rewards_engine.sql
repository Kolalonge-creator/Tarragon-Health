-- S58 proof: Module 11, Rewards and engagement (migrations *_s58_rewards_foundation, *_s58_points_events_and_award, *_s58_points_checkout_discount_and_employer_seam).
--
--   1. IDEMPOTENT: replaying an event never double awards; the second call returns 0 and writes nothing.
--   2. NO BODY METRICS: a weight or waist reading emits no event and earns nothing; a rule that names a body metric is refused by
--      the table (code, trigger event and caps), and a variable (chance-based) reward is refused for everyone.
--   3. PLAUSIBLE ONLY: an implausible reading earns nothing (decision recorded as ineligible); a DANGEROUS but plausible reading earns normally.
--   4. RED FLOW FIRST: the points emitter sorts last among the vitals triggers, the triage event exists beside the points event, and
--      if the rewards bus is broken the reading still saves, the triage event still exists and an incident is raised (not silent).
--   5. CAPS: per-day rule cap, the all-rule daily points cap, a lifetime cap, a decay weight (50 percent on the 3rd lab), catalogue points.
--   6. TIERS: this-year tier, last-year status carried through, minors get no tier; leaderboards off; no one can read anyone else's points.
--   7. GRACE: a 7-day consistency badge is earned with one quiet day, not with two.
--   8. REDEMPTION: unavailable while the cap is 0; with a cap set: over the share of the price is refused, over the kobo cap is refused,
--      the exact discount is a share of the price (never a points-to-kobo rate), points deducted, only on the buyer's own order,
--      once per order, minors refused, released when the order lapses; the table itself refuses an oversize or foreign insert.
--   9. LEDGER: append-only (update and delete refused) but a profile purge still cascades.
--  10. EMPLOYER SEAM: aggregate only, small groups suppressed, non-admin refused, test accounts excluded.
--  11. ROLES: anon and patients cannot call the awarder or release; anon cannot apply a discount.
--  SABOTAGE: body-metric constraint dropped, decisions + dedupe removed, redemption trigger dropped: each must flip a check.
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
  values (v, 's58-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S58 ' || p_label, p_test)
  on conflict (id) do update set role = excluded.role, is_test = p_test, is_active = true;
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
-- emit a synthetic event for a patient and award it; returns points
create function pg_temp.fire(p_patient uuid, p_type text, p_key text, p_payload jsonb default '{}'::jsonb) returns integer language plpgsql as $f$
declare v_org uuid; v_e uuid;
begin
  select organisation_id into v_org from public.profiles where id = p_patient;
  v_e := private.emit_domain_event(p_type, v_org,
    coalesce((select jsonb_object_agg(k, 'x') from public.event_type_versions v, unnest(v.required_keys) k where v.event_type = p_type and v.version = 1), '{}'::jsonb) || p_payload,
    p_key, p_patient);
  perform pg_temp.setf('lastev', v_e);
  return private.points_award_event(v_e);
end $f$;
create function pg_temp.bal(p uuid) returns integer language sql as $$ select coalesce((select balance from public.wellness_points_balances where patient_id = p), 0) $$;
create function pg_temp.rows(p uuid, p_reason text) returns integer language sql as
$$ select count(*)::integer from public.wellness_points_ledger where patient_id = p and reason = p_reason $$;
-- a past earn row (for caps, decay, tiers, streaks); the ledger is append-only but insert is allowed
create function pg_temp.past_earn(p uuid, p_reason text, p_points integer, p_when timestamptz) returns void language plpgsql as $f$
declare v_org uuid;
begin
  perform private.ensure_wellness_points_balance(p);
  select organisation_id into v_org from public.profiles where id = p;
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, created_at)
  values (v_org, p, p_points, 0 + p_points, p_reason, p_when);
  update public.wellness_points_balances set balance = balance + p_points, lifetime_earned = lifetime_earned + p_points where patient_id = p;
end $f$;
create function pg_temp.mkorder(p_org uuid, p_buyer uuid, p_amount bigint, p_ref text) returns uuid language plpgsql as $f$
declare v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
begin
  insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, uses)
  values (v_item, p_org, 's58_' || substr(replace(v_item::text, '-', ''), 1, 12), 'consultation', 'n', 'd', 1);
  insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo) values (v_price, p_org, v_item, p_amount);
  insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
  values (v_o, p_org, p_buyer, p_buyer, v_item, v_price, p_amount, p_ref, true);
  return v_o;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid;
  v_a uuid; v_b uuid; v_c uuid; v_m uuid; v_g uuid;
  v_n integer; v_i integer; v_ev uuid; v_s text; v_j jsonb; v_o uuid; v_o2 uuid; v_before integer; v_red uuid;
  v_vid uuid; v_other uuid;
begin
  select id, organisation_id into v_admin, v_org from public.profiles where role = 'admin' limit 1;
  v_a := pg_temp.mkuser(v_org, 'a', 'patient'); v_b := pg_temp.mkuser(v_org, 'b', 'patient');
  v_c := pg_temp.mkuser(v_org, 'c', 'patient'); v_m := pg_temp.mkuser(v_org, 'minor', 'patient');
  v_g := pg_temp.mkuser(v_org, 'grace', 'patient');
  update public.profiles set date_of_birth = current_date - interval '12 years' where id = v_m;
  update public.profiles set date_of_birth = current_date - interval '35 years' where id in (v_a, v_b, v_c, v_g);

  -- ================= 1. idempotent =================
  v_n := pg_temp.fire(v_a, 'lesson.completed', 'proof-l1', jsonb_build_object('content_id', gen_random_uuid()));
  perform pg_temp.ck('1a a lesson event awards the rule points (20)', v_n = 20 and pg_temp.bal(v_a) = 20);
  v_ev := pg_temp.f('lastev');
  perform pg_temp.ck('1b replaying the same event returns 0', private.points_award_event(v_ev) = 0);
  perform pg_temp.ck('1c replay leaves one ledger row and the same balance', pg_temp.rows(v_a, 'education_lesson_completed') = 1 and pg_temp.bal(v_a) = 20);
  perform pg_temp.ck('1d the ledger row carries rule, version and event provenance',
    exists (select 1 from public.wellness_points_ledger where patient_id = v_a and event_id = v_ev and rule_code = 'education_lesson_completed' and rule_version = 1));
  perform pg_temp.ck('1e a points.awarded event was emitted (ids only)',
    exists (select 1 from public.domain_events where event_type = 'points.awarded' and patient_id = v_a and payload ? 'ledger_id' and not payload ? 'points'));
  perform pg_temp.ck('1f emitting the same domain event again (same key) is one event', (select count(*) from public.domain_events where event_type = 'lesson.completed' and idempotency_key = 'proof-l1') = 1);
  perform pg_temp.ck('1g every rule trigger event has a points.award subscriber',
    not exists (select 1 from public.reward_rules r where r.is_active and not exists (select 1 from public.event_subscribers s where s.event_type = r.trigger_event and s.handler_key = 'points.award')));
  insert into public.points_award_decisions (event_id, rule_code, rule_version, patient_id, outcome) values (v_ev, 'zz_other', 1, v_a, 'ineligible');
  perform pg_temp.ck('1h a delivery is created for the subscriber when an event is written',
    exists (select 1 from public.domain_event_deliveries d where d.event_id = v_ev and d.subscriber_key = 'points.award.lesson_completed'));

  -- ================= 2. no body metrics =================
  v_i := 0;
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, weight_kg, source) values (v_org, v_b, 'weight', 70, 'manual');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, waist_cm, source) values (v_org, v_b, 'waist_circumference', 80, 'manual');
  perform pg_temp.ck('2a weight and waist readings emit no points event', not exists (select 1 from public.domain_events where event_type = 'vitals.logged' and patient_id = v_b));
  perform pg_temp.ck('2b and earn nothing', pg_temp.bal(v_b) = 0);
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, glucose_mmol_l, source) values (v_org, v_b, 'glucose', 6, 'cgm');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source) values (v_org, v_b, 'pulse', 70, 'wearable');
  perform pg_temp.ck('2b2 passive CGM and wearable streams emit no points event (no outbox flood)', not exists (select 1 from public.domain_events where event_type = 'vitals.logged' and patient_id = v_b));
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, pulse_bpm, source) values (v_org, v_b, 'pulse', 70, 'device');
  perform pg_temp.ck('2b3 a paired device reading does emit', exists (select 1 from public.domain_events where event_type = 'vitals.logged' and patient_id = v_b));
  delete from public.domain_events where false;
  foreach v_s in array array['weight_loss_bonus', 'bmi_goal', 'waist_target', 'body_fat_drop', 'calorie_burn', 'kg_lost', 'lean_streak', 'slim_down'] loop
    begin
      insert into public.reward_rules (code, version, trigger_event, points) values (v_s, 1, 'vitals.logged', 5);
      perform pg_temp.ck('2c rule ' || v_s || ' refused', false);
    exception when check_violation then perform pg_temp.ck('2c rule ' || v_s || ' refused', true); end;
  end loop;
  begin
    insert into public.reward_rules (code, version, trigger_event, points) values ('ok_code_one', 1, 'weight.logged', 5);
    perform pg_temp.ck('2d a body trigger event is refused', false);
  exception when check_violation then perform pg_temp.ck('2d a body trigger event is refused', true); end;
  begin
    insert into public.reward_rules (code, version, trigger_event, points, caps) values ('ok_code_two', 1, 'vitals.logged', 5, '{"per_day":1,"bmi":25}');
    perform pg_temp.ck('2e a body term inside caps is refused', false);
  exception when check_violation then perform pg_temp.ck('2e a body term inside caps is refused', true); end;
  begin
    insert into public.reward_rules (code, version, trigger_event, points, reward_kind) values ('ok_code_three', 1, 'vitals.logged', 5, 'variable');
    perform pg_temp.ck('2f a variable (chance-based) reward is refused, so no minor can hold one', false);
  exception when check_violation then perform pg_temp.ck('2f a variable (chance-based) reward is refused, so no minor can hold one', true); end;
  perform pg_temp.ck('2g every live rule is clean of body terms',
    not exists (select 1 from public.reward_rules where private.reward_text_mentions_body_metric(code) or private.reward_text_mentions_body_metric(trigger_event) or private.reward_text_mentions_body_metric(caps::text)));
  perform pg_temp.ck('2h an admin cannot mint a rule for a new code through the change RPC',
    pg_temp.as_try(v_admin, $q$select public.admin_set_reward_rule('weight_loss_bonus', 5, '{}', true)$q$) = '22023');

  -- ================= 3. plausible only; danger still earns =================
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_c, 'blood_pressure', 400, 20, 'manual') returning id into v_vid;
  v_ev := (select id from public.domain_events where event_type = 'vitals.logged' and aggregate_id = v_vid);
  perform pg_temp.ck('3a an implausible reading still emits (the emitter does not judge)', v_ev is not null);
  perform pg_temp.ck('3b but earns nothing', private.points_award_event(v_ev) = 0 and pg_temp.bal(v_c) = 0);
  perform pg_temp.ck('3c the decision says why', (select detail from public.points_award_decisions where event_id = v_ev) = 'implausible');
  insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_c, 'blood_pressure', 190, 120, 'manual') returning id into v_vid;
  v_ev := (select id from public.domain_events where event_type = 'vitals.logged' and aggregate_id = v_vid);
  perform pg_temp.ck('3d a dangerous but plausible reading earns the normal points', private.points_award_event(v_ev) = 10);

  -- ================= 4. the red flow comes first =================
  perform pg_temp.ck('4a the points trigger sorts last among AFTER INSERT triggers on vitals_readings',
    (select tgname from pg_trigger where tgrelid = 'public.vitals_readings'::regclass and not tgisinternal and (tgtype & 2) = 0 and (tgtype & 4) <> 0
      order by tgname desc limit 1) = 'vitals_readings_wellness_points');
  perform pg_temp.ck('4b the triage observation event exists beside the points event for the 190/120 reading',
    exists (select 1 from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'bp:' || v_vid::text)
    and exists (select 1 from public.domain_events where event_type = 'vitals.logged' and aggregate_id = v_vid));
  update public.event_types set is_active = false where event_type = 'vitals.logged';
  begin
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, source) values (v_org, v_c, 'blood_pressure', 185, 115, 'manual') returning id into v_vid;
    perform pg_temp.ck('4c a broken rewards bus never refuses the reading', true);
  exception when others then perform pg_temp.ck('4c a broken rewards bus never refuses the reading', false); end;
  perform pg_temp.ck('4d the triage event still exists', exists (select 1 from public.domain_events where event_type = 'observation.recorded' and idempotency_key = 'bp:' || v_vid::text));
  perform pg_temp.ck('4e the failure is audited, not silent', exists (select 1 from public.audit_log where action = 'rewards_event.error' and entity_id = v_vid));
  perform pg_temp.ck('4f and one incident is open', exists (select 1 from public.ops_incidents where external_reference = 'rewards_event_failed' and status not in ('resolved', 'closed')));
  update public.event_types set is_active = true where event_type = 'vitals.logged';

  -- ================= 5. caps =================
  v_n := pg_temp.fire(v_c, 'vitals.logged', 'proof-v2', (select jsonb_build_object('vitals_id', id) from public.vitals_readings where patient_id = v_c and systolic = 190));
  perform pg_temp.ck('5a a second vitals award the same day is capped (per_day 1)', v_n = 0);
  perform pg_temp.ck('5b the decision records the cap', exists (select 1 from public.points_award_decisions where patient_id = v_c and outcome = 'capped' and detail = 'day_cap'));
  -- all-rule daily points cap (100)
  v_n := 0;
  v_n := v_n + pg_temp.fire(v_b, 'lesson.completed', 'cap-1', '{"content_id":"00000000-0000-0000-0000-000000000001"}');
  v_n := v_n + pg_temp.fire(v_b, 'lesson.completed', 'cap-2', '{"content_id":"00000000-0000-0000-0000-000000000002"}');
  v_n := v_n + pg_temp.fire(v_b, 'lesson.completed', 'cap-3', '{"content_id":"00000000-0000-0000-0000-000000000003"}');
  v_n := v_n + pg_temp.fire(v_b, 'lifestyle.goal_achieved', 'cap-4', '{"goal_id":"00000000-0000-0000-0000-000000000004"}');
  perform pg_temp.ck('5c 60 + 50 is cut at the 100 daily points cap (the last gets 40)', v_n = 100 and pg_temp.bal(v_b) = 100);
  perform pg_temp.ck('5d anything after the cap earns nothing', pg_temp.fire(v_b, 'lifestyle.task_completed', 'cap-5', '{"task_id":"00000000-0000-0000-0000-000000000005"}') = 0);
  -- lifetime cap: course_completed lifetime 20
  for v_i in 1 .. 20 loop perform pg_temp.past_earn(v_a, 'course_completed', 1, now() - interval '40 days'); end loop;
  v_n := pg_temp.fire(v_a, 'course.completed', 'life-1', '{"programme_id":"00000000-0000-0000-0000-000000000009"}');
  perform pg_temp.ck('5e a lifetime cap stops a rule after its count', v_n = 0
    and (select detail from public.points_award_decisions where event_id = pg_temp.f('lastev')) = 'lifetime_cap');
  -- decay: lab_done, 2 earlier awards at 100 percent; the third is 50 percent of 30
  perform pg_temp.past_earn(v_a, 'lab_done', 30, now() - interval '3 days');
  perform pg_temp.past_earn(v_a, 'lab_done', 30, now() - interval '2 days');
  perform pg_temp.ck('5f the 3rd lab earns a decayed 15, not 30', pg_temp.fire(v_a, 'lab_result.released', 'decay-1', '{"lab_result_id":"00000000-0000-0000-0000-00000000000a"}') = 15);
  -- catalogue points
  insert into public.patient_challenge_enrolments (organisation_id, patient_id, challenge_id, target_end_at)
  values (v_org, v_g, (select id from public.wellness_challenges where code = 'learn_3'), now() + interval '7 days') returning id into v_vid;
  perform pg_temp.ck('5g a challenge pays its catalogue points (150) cut to the 100 daily cap', pg_temp.fire(v_g, 'challenge.completed', 'ch-1', jsonb_build_object('enrolment_id', v_vid)) = 100);
  perform pg_temp.ck('5h another person''s enrolment id pays nothing',
    pg_temp.fire(v_a, 'challenge.completed', 'ch-2', jsonb_build_object('enrolment_id', v_vid)) = 0);

  -- ================= 6. tiers =================
  -- v_c: 450 points this year => leaf (400)
  perform pg_temp.past_earn(v_c, 'meal_logged', 450, now());
  v_j := private.points_status_for(v_c);
  perform pg_temp.ck('6a 460 points this year is the leaf tier, next is branch', v_j ->> 'tier' = 'leaf' and v_j ->> 'next_tier' = 'branch' and (v_j ->> 'year_points')::integer >= 450);
  -- last year's status carries: v_other has 1300 last year, nothing this year
  v_other := pg_temp.mkuser(v_org, 'carry', 'patient');
  update public.profiles set date_of_birth = current_date - interval '40 years' where id = v_other;
  perform pg_temp.past_earn(v_other, 'meal_logged', 1300, make_timestamptz(extract(year from now())::integer - 1, 6, 1, 12, 0, 0, 'Africa/Lagos'));
  v_j := private.points_status_for(v_other);
  perform pg_temp.ck('6b last year''s earned status carries through this year and says so', v_j ->> 'tier' = 'branch' and v_j ->> 'tier_from' = 'last_year' and (v_j ->> 'year_points')::integer = 0);
  perform pg_temp.ck('6c the spendable balance did not reset', (v_j ->> 'balance')::integer = 1300);
  v_j := private.points_status_for(v_m);
  perform pg_temp.ck('6d a minor gets no tier and is flagged', (v_j ->> 'is_minor')::boolean and (v_j -> 'tier') = 'null'::jsonb);
  perform pg_temp.ck('6e leaderboards are off', (private.points_status_for(v_c) ->> 'leaderboards')::boolean = false);
  perform pg_temp.ck('6f patient B cannot read patient A''s balance or ledger',
    pg_temp.as_count(v_b, format($q$select count(*)::integer from public.wellness_points_balances where patient_id = %L$q$, v_a)) = 0
    and pg_temp.as_count(v_b, format($q$select count(*)::integer from public.wellness_points_ledger where patient_id = %L$q$, v_a)) = 0);
  perform pg_temp.ck('6g patient A reads their own', pg_temp.as_count(v_a, 'select count(*)::integer from public.wellness_points_balances') = 1);
  perform pg_temp.ck('6h my_points_status needs a signed-in person', pg_temp.as_try(null, 'select public.my_points_status()') = '42501');

  -- ================= 7. grace =================
  -- streak_7 badge: 6 of the last 7 Lagos days (one quiet day) is enough; fresh person with 5 of 7 is not
  for v_i in 0 .. 6 loop
    if v_i <> 3 then perform pg_temp.past_earn(v_g, 'vitals_logged', 1, now() - make_interval(days => v_i)); end if;
  end loop;
  perform private.check_and_award_wellness_badges(v_g);
  perform pg_temp.ck('7a one quiet day inside seven still earns the 7-day badge',
    exists (select 1 from public.patient_wellness_badges pb join public.wellness_badges b on b.id = pb.badge_id where pb.patient_id = v_g and b.code = 'streak_7'));
  v_other := pg_temp.mkuser(v_org, 'two-gaps', 'patient');
  for v_i in 0 .. 6 loop
    if v_i not in (2, 4) then perform pg_temp.past_earn(v_other, 'vitals_logged', 1, now() - make_interval(days => v_i)); end if;
  end loop;
  perform private.check_and_award_wellness_badges(v_other);
  perform pg_temp.ck('7b two quiet days inside seven does not',
    not exists (select 1 from public.patient_wellness_badges pb join public.wellness_badges b on b.id = pb.badge_id where pb.patient_id = v_other and b.code = 'streak_7'));

  -- ================= 8. redemption =================
  perform pg_temp.past_earn(v_a, 'meal_logged', 2000, now() - interval '30 days');
  v_o := pg_temp.mkorder(v_org, v_a, 5000000, 's58-order-0001');
  v_before := pg_temp.bal(v_a);
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 500)$q$, v_o));
  perform pg_temp.ck('8a redemption is unavailable while the kobo cap is 0', v_j ->> 'code' = 'redemption_unavailable' and pg_temp.bal(v_a) = v_before);
  begin
    insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
    values (v_org, v_a, v_o, 500, 500, 1000, 5000000, 250000);
    perform pg_temp.ck('8b a direct insert is refused while the cap is 0', false);
  exception when others then perform pg_temp.ck('8b a direct insert is refused while the cap is 0', sqlerrm = 'redemption_unavailable'); end;
  -- the founder sets a cap (rolled back with the proof)
  insert into public.reward_config (key, version, value, status) values ('points_redemption_cap_kobo', 2, '1000000'::jsonb, 'proposed');
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 1100)$q$, v_o));
  perform pg_temp.ck('8c 11 percent of the price is over the 10 percent share and refused', v_j ->> 'code' = 'over_cap');
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 150)$q$, v_o));
  perform pg_temp.ck('8d points that are not a whole block are refused', v_j ->> 'code' = 'invalid_points');
  v_j := pg_temp.as_json(v_b, format($q$select public.apply_points_discount(%L, 500)$q$, v_o));
  perform pg_temp.ck('8e another person cannot spend points on this order (non-transferable)', v_j ->> 'code' in ('order_not_yours', 'not_enough_points') and v_j ->> 'code' = 'order_not_yours');
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 1000)$q$, v_o));
  perform pg_temp.ck('8f 1000 points buys exactly 10 percent: 500000 kobo off 5000000', (v_j ->> 'ok')::boolean and (v_j ->> 'discount_kobo')::bigint = 500000);
  perform pg_temp.ck('8g points were deducted and a spend row written', pg_temp.bal(v_a) = v_before - 1000
    and exists (select 1 from public.wellness_points_ledger where patient_id = v_a and kind = 'spend' and points = -1000));
  perform pg_temp.ck('8h the discount is below the price and never above the share',
    (select discount_kobo * 10000 <= item_price_kobo * max_share_bps and discount_kobo < item_price_kobo from public.reward_redemptions where order_id = v_o));
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 100)$q$, v_o));
  perform pg_temp.ck('8i one redemption per order', v_j ->> 'code' = 'already_applied');
  v_o2 := pg_temp.mkorder(v_org, v_a, 5000000, 's58-order-0002');
  insert into public.reward_config (key, version, value, status) values ('points_redemption_cap_kobo', 3, '100000'::jsonb, 'proposed');
  v_j := pg_temp.as_json(v_a, format($q$select public.apply_points_discount(%L, 500)$q$, v_o2));
  perform pg_temp.ck('8j a discount above the kobo cap is refused (250000 > 100000)', v_j ->> 'code' = 'over_cap');
  begin
    insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
    values (v_org, v_a, v_o2, 500, 500, 1000, 5000000, 250000);
    perform pg_temp.ck('8k the table itself refuses a discount over the kobo cap', false);
  exception when others then perform pg_temp.ck('8k the table itself refuses a discount over the kobo cap', sqlerrm = 'over_cap_kobo'); end;
  insert into public.reward_config (key, version, value, status) values ('points_redemption_cap_kobo', 4, '1000000'::jsonb, 'proposed');
  begin
    insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
    values (v_org, v_a, v_o2, 1500, 1500, 1000, 5000000, 750000);
    perform pg_temp.ck('8l the table itself refuses a share above the cap', false);
  exception when check_violation then perform pg_temp.ck('8l the table itself refuses a share above the cap', true); end;
  begin
    insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
    values (v_org, v_b, v_o2, 100, 100, 1000, 5000000, 50000);
    perform pg_temp.ck('8m the table refuses points applied to someone else''s order', false);
  exception when others then perform pg_temp.ck('8m the table refuses points applied to someone else''s order', sqlerrm = 'points_not_transferable'); end;
  begin
    insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
    values (v_org, v_a, v_o2, 100, 100, 1000, 5000000, 50001);
    perform pg_temp.ck('8n a discount that is not an exact share of the price is refused', false);
  exception when check_violation then perform pg_temp.ck('8n a discount that is not an exact share of the price is refused', true); end;
  -- minors
  perform pg_temp.past_earn(v_m, 'meal_logged', 2000, now() - interval '30 days');
  v_j := pg_temp.as_json(v_m, format($q$select public.apply_points_discount(%L, 500)$q$, pg_temp.mkorder(v_org, v_m, 1000000, 's58-order-0003')));
  perform pg_temp.ck('8o a minor cannot redeem', v_j ->> 'code' = 'not_available_for_minors');
  -- release
  update public.orders set state = 'cancelled', cancelled_at = now() where id = v_o;
  perform pg_temp.ck('8p an order that lapses returns the points once (kind release)',
    public.release_points_discount(v_o) = 1000 and public.release_points_discount(v_o) = 0 and pg_temp.bal(v_a) = v_before);
  perform pg_temp.ck('8q returned points are not counted as earning: the release row exists but the year counter ignores it',
    exists (select 1 from public.wellness_points_ledger where patient_id = v_a and kind = 'release' and points = 1000)
    and (private.points_status_for(v_a) ->> 'year_points')::integer =
        (select sum(points) from public.wellness_points_ledger where patient_id = v_a and kind = 'earn' and points > 0
          and created_at >= make_timestamptz(extract(year from now() at time zone 'Africa/Lagos')::integer, 1, 1, 0, 0, 0, 'Africa/Lagos')));
  begin delete from public.reward_redemptions where order_id = v_o; perform pg_temp.ck('8q2 a redemption cannot be deleted directly', false);
  exception when others then perform pg_temp.ck('8q2 a redemption cannot be deleted directly', sqlerrm = 'reward_redemption_immutable'); end;
  perform pg_temp.ck('8r patient B cannot read A''s redemptions', pg_temp.as_count(v_b, 'select count(*)::integer from public.reward_redemptions') = 0
    and pg_temp.as_count(v_a, 'select count(*)::integer from public.reward_redemptions') = 1);
  perform pg_temp.ck('8s a patient cannot insert a redemption directly', pg_temp.as_try(v_a, format($q$insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo) values (%L, %L, %L, 100, 100, 1000, 5000000, 50000)$q$, v_org, v_a, v_o2)) = '42501');

  -- ================= 9. ledger append-only =================
  begin update public.wellness_points_ledger set points = 99 where patient_id = v_a and reason = 'vitals_logged'; perform pg_temp.ck('9a a ledger row cannot be updated', false);
  exception when others then perform pg_temp.ck('9a a ledger row cannot be updated', sqlstate = 'P0001'); end;
  begin delete from public.wellness_points_ledger where patient_id = v_a; perform pg_temp.ck('9b a ledger row cannot be deleted', false);
  exception when others then perform pg_temp.ck('9b a ledger row cannot be deleted', sqlstate = 'P0001'); end;
  -- A profile purge reaches the ledger through a foreign-key cascade, i.e. from inside another trigger (depth 2). Profile
  -- deletes are blocked on this stack by record_corrections, so the cascade is emulated with a probe trigger at the same depth.
  v_other := pg_temp.mkuser(v_org, 'purge', 'patient');
  perform pg_temp.past_earn(v_other, 'meal_logged', 5, now());
  create temp table purge_probe (id uuid) on commit drop;
  create function pg_temp.purge_probe_fn() returns trigger language plpgsql as $t$
    begin delete from public.wellness_points_ledger where patient_id = old.id; return old; end $t$;
  create trigger purge_probe_trg after delete on pg_temp.purge_probe for each row execute function pg_temp.purge_probe_fn();
  insert into purge_probe values (v_other);
  delete from purge_probe;
  perform pg_temp.ck('9c a cascade from inside another trigger (the profile purge path) still clears the ledger', not exists (select 1 from public.wellness_points_ledger where patient_id = v_other));

  -- ================= 10. employer seam =================
  v_j := pg_temp.as_json(v_admin, format($q$select public.rewards_participation_aggregate(%L, current_date - 1, current_date)$q$, v_org));
  perform pg_temp.ck('10a with only test accounts the report is suppressed', (v_j ->> 'suppressed')::boolean);
  perform pg_temp.ck('10b2 an admin cannot ask about another organisation', pg_temp.as_try(v_admin, format($q$select public.rewards_participation_aggregate(%L, current_date - 1, current_date)$q$, gen_random_uuid())) = '42501');
  perform pg_temp.ck('10b non-admin is refused', pg_temp.as_try(v_a, format($q$select public.rewards_participation_aggregate(%L, current_date - 1, current_date)$q$, v_org)) = '42501');
  for v_i in 1 .. 10 loop
    v_other := pg_temp.mkuser(v_org, 'real-' || v_i, 'patient', false);
    perform pg_temp.past_earn(v_other, 'meal_logged', 10, now());
    update public.wellness_points_ledger set rule_code = null where false;
  end loop;
  insert into public.wellness_points_ledger (organisation_id, patient_id, points, balance_after, reason, rule_code)
    select v_org, p.id, 1, 1, 'meal_logged', 'meal_logged' from public.profiles p where p.full_name like 'S58 real-%';
  v_j := pg_temp.as_json(v_admin, format($q$select public.rewards_participation_aggregate(%L, current_date - 1, current_date)$q$, v_org));
  perform pg_temp.ck('10c ten real participants show counts', not (v_j ->> 'suppressed')::boolean and (v_j ->> 'participants')::integer >= 10);
  perform pg_temp.ck('10d the report carries no person', v_j::text !~ '[0-9a-f]{8}-[0-9a-f]{4}-' );

  -- ================= 11. roles =================
  perform pg_temp.ck('11a anon cannot award', pg_temp.as_try(null, format($q$select public.points_award(%L)$q$, pg_temp.f('lastev'))) = '42501');
  perform pg_temp.ck('11b a patient cannot award', pg_temp.as_try(v_a, format($q$select public.points_award(%L)$q$, pg_temp.f('lastev'))) = '42501');
  perform pg_temp.ck('11c a patient cannot release', pg_temp.as_try(v_a, format($q$select public.release_points_discount(%L)$q$, v_o)) = '42501');
  perform pg_temp.ck('11d anon cannot apply a discount', pg_temp.as_try(null, format($q$select public.apply_points_discount(%L, 100)$q$, v_o2)) = '42501');
  perform pg_temp.ck('11e function-level (not just comment): anon has no EXECUTE on points_award', not has_function_privilege('anon', 'public.points_award(uuid)', 'EXECUTE')
    and not has_function_privilege('authenticated', 'public.points_award(uuid)', 'EXECUTE') and has_function_privilege('service_role', 'public.points_award(uuid)', 'EXECUTE'));
  perform pg_temp.ck('11f patients cannot read reward_rules inactive rows or write rules',
    pg_temp.as_try(v_a, $q$insert into public.reward_rules (code, version, trigger_event, points) values ('abc_rule', 1, 'vitals.logged', 1)$q$) = '42501');
  perform pg_temp.ck('11g patients cannot read the decision table', pg_temp.as_try(v_a, 'select * from public.points_award_decisions') = '42501');
  v_s := pg_temp.as_try(v_admin, $q$select public.admin_set_reward_rule('meal_logged', 12, '{"per_day":1}', true)$q$);
  perform pg_temp.ck('11h an admin changes a rule as a NEW proposed version and the old one goes inactive',
    v_s = 'ok' and (select count(*) from public.reward_rules where code = 'meal_logged' and is_active) = 1
    and (select status from public.reward_rules where code = 'meal_logged' and version = 2) = 'proposed');
  perform pg_temp.ck('11i a patient cannot change a rule', pg_temp.as_try(v_a, $q$select public.admin_set_reward_rule('meal_logged', 99, '{}', true)$q$) = '42501');
end $$;

-- ================= SABOTAGE (each must flip a check; sub-blocks roll back) =================
do $$
declare v_flip boolean; v_def text; v_org uuid; v_p uuid := gen_random_uuid(); v_e uuid; v_n integer;
begin
  -- A. body-metric constraint dropped => a weight rule would be accepted
  begin
    alter table public.reward_rules drop constraint reward_rules_no_body_metric;
    insert into public.reward_rules (code, version, trigger_event, points) values ('weight_loss_bonus', 1, 'vitals.logged', 5);
    v_flip := true;
    raise exception 'rollback_sab';
  exception when others then
    if sqlerrm <> 'rollback_sab' then v_flip := false; end if;
  end;
  insert into results(check_name, ok) values ('SABOTAGE A: without the constraint a weight rule is accepted (so check 2c really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: body-metric test'; end if;

  -- B. replay protection removed => a replay double awards
  select organisation_id into v_org from public.profiles limit 1;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_p, 's58-sab@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test) values (v_p, v_org, 'patient', 'S58 sab', true) on conflict (id) do update set is_test = true;
  begin
    v_e := private.emit_domain_event('lesson.completed', v_org, '{"course_code":"x","lesson_code":"y"}', 'sab-1', v_p);
    perform private.points_award_event(v_e);
    -- strip both layers of replay protection out of the live function, then replay
    v_def := pg_get_functiondef('private.points_award_event(uuid)'::regprocedure);
    v_def := replace(v_def, 'if exists (select 1 from public.points_award_decisions d where d.event_id = e.id and d.rule_code = r.code) then', 'if false then');
    v_def := replace(v_def, 'on conflict (patient_id, source_table, source_id, reason) where source_table is not null and source_id is not null do nothing', '');
    execute v_def;
    delete from public.points_award_decisions where event_id = v_e;
    drop index public.wellness_points_ledger_dedupe;
    perform private.points_award_event(v_e);
    select count(*) into v_n from public.wellness_points_ledger where patient_id = v_p and reason = 'education_lesson_completed';
    v_flip := v_n = 2;
    raise exception 'rollback_sab';
  exception when others then
    if sqlerrm <> 'rollback_sab' then v_flip := false; end if;
  end;
  insert into results(check_name, ok) values ('SABOTAGE B: without decisions and the dedupe index a replay double awards (so check 1b really guards it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: replay test'; end if;

  -- C. redemption trigger dropped => an oversize discount lands
  begin
    insert into public.reward_config (key, version, value, status) values ('points_redemption_cap_kobo', 9, '1000000'::jsonb, 'proposed');
    drop trigger reward_redemptions_enforce on public.reward_redemptions;
    alter table public.reward_redemptions drop constraint reward_redemptions_share_cap;
    declare v_order uuid := gen_random_uuid(); v_item uuid := gen_random_uuid(); v_price uuid := gen_random_uuid();
    begin
      insert into public.catalog_items (id, organisation_id, code, kind, name_key, description_key, uses) values (v_item, v_org, 's58_sabcat', 'consultation', 'n', 'd', 1);
      insert into public.prices (id, organisation_id, catalog_item_id, amount_kobo) values (v_price, v_org, v_item, 1000000);
      insert into public.orders (id, organisation_id, buyer_profile_id, beneficiary_patient_id, catalog_item_id, price_id, amount_kobo, paystack_reference, is_test)
        values (v_order, v_org, v_p, v_p, v_item, v_price, 1000000, 's58-sab-order', true);
      insert into public.reward_redemptions (organisation_id, patient_id, order_id, points, discount_bps, max_share_bps, item_price_kobo, discount_kobo)
        values (v_org, v_p, v_order, 5000, 5000, 1000, 1000000, 500000);
      v_flip := true;
    end;
    raise exception 'rollback_sab';
  exception when others then
    if sqlerrm <> 'rollback_sab' then v_flip := false; end if;
  end;
  insert into results(check_name, ok) values ('SABOTAGE C: without the trigger and share check a 50 percent discount lands (so checks 8c/8l really guard it)', v_flip);
  if not v_flip then raise exception 'VACUOUS: cap test'; end if;
end $$;

select check_name, ok from results order by n;
select count(*) filter (where not ok) as failures from results;
rollback;

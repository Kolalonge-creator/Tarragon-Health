-- S58b proof: creator fixed fee through the S30/S31 ledger, published-item integrity, draft content seed, event-failure severities,
-- and "points never expire / class points capped 2 a day".
-- One rolled-back transaction. Migrations: *_s58b_creator_fixed_fee_and_incident_severity.sql, *_s58b_published_learning_integrity.sql,
-- *_s58b_seed_draft_learning_content.sql.
--   1. FEE: no schedule -> the line waits; first approved schedule -> the sweep posts exactly the schedule's amount (retroactively);
--      a rerun, a new item version and a republish never pay twice; a schedule without the key gives a zero line flagged needs_review;
--      amounts are integer kobo (a fractional fee is refused by the schedule check).
--   2. NO FEE when: employed creator (salary), reviewer is the creator, creator suspended, item draft / withdrawn / past its review date.
--   3. ACCESS: a creator reads only their own line; another creator, a patient and anon read none; an admin reads the organisation's.
--   4. INTEGRITY (S55-06b): reviewer, review date, reviewed mark and source cannot be cleared on a published or review_due item;
--      a re-review to other real values is allowed; a draft is free to edit; a micro-lesson without two options cannot publish.
--   5. SEED: 20 draft rows exist, closed (draft, inactive, placeholder, no reviewer/author); one cannot be published, and the
--      placeholder flag cannot be cleared without a named clinical author.
--   6. SEVERITY: a lesson-event failure opens sev2, a rewards-event failure sev3, neither sev1.
--   7. POINTS: no expiry column, setting or function exists on the points tables; the class rule keeps its 2 per day cap.
--   SABOTAGE: integrity trigger dropped and creator-earnings trigger dropped; both must flip a check.
begin;

create temp table results(n serial, check_name text, ok boolean) on commit drop;
grant all on results to public;
grant all on results_n_seq to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create temp table sab(name text, expected text, actual text) on commit drop;
grant all on sab to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_ok boolean) returns void language plpgsql as
$f$ begin
  insert into results(check_name, ok) values (p_name, coalesce(p_ok, false));
  if not coalesce(p_ok, false) then raise exception 'FAIL: %', p_name; end if;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's58b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S58b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_emp text, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S58b ' || p_label, 'MDCN', 'S58B-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      'senior_medical_officer'::public.doctor_tier, p_emp::public.staff_employment_type, 2,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, true);
  return v;
end $f$;
create function pg_temp.mkcreator(p_org uuid, p_uid uuid, p_name text, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.learning_creators (organisation_id, profile_id, display_name, mdcn_number, credential_evidence, indemnity_confirmed,
      status, invited_by, verified_by, verified_at)
  values (p_org, p_uid, p_name, 'MDCN-12345', 'Proof evidence on file', true, 'verified', p_admin, p_admin, now())
  returning id into v;
  return v;
end $f$;
-- a complete published item credited to a creator (every S55 gate field present)
create function pg_temp.mkitem(p_code text, p_creator uuid, p_reviewer text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content (code, title, body, category, content_status, clinician_reviewed, next_review_due,
      reviewed_by_name, reviewed_at, source_reference, self_care_action, creator_id)
  values (p_code, 'S58b ' || p_code, 'Proof body.', 'getting_started', 'published', true, ((now() at time zone 'Africa/Lagos')::date) + 90,
      p_reviewer, now(), 'Proof source', 'Take one proof step today.', p_creator)
  returning id into v;
  return v;
end $f$;
create function pg_temp.as_try(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text := 'ok';
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql; exception when others then r := sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.as_val(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return r;
end $f$;
create function pg_temp.anon_val(p_sql text) returns text language plpgsql as $f$
declare r text;
begin
  set local role anon;
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.lines(p_uid uuid) returns bigint language sql as
$$ select count(*) from public.earnings_ledger where clinician_id = p_uid and kind = 'creator_item' $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_ca uuid; v_cb uuid; v_ce uuid; v_pat uuid;
  v_cra uuid; v_crb uuid; v_cre uuid;
  v_i1 uuid; v_i2 uuid; v_i3 uuid; v_i4 uuid; v_i5 uuid; v_i6 uuid; v_i7 uuid;
  d1 uuid; d2 uuid; v_items jsonb; v_line public.earnings_ledger%rowtype; v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_err text;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_ca := pg_temp.mkdoc(v_org, 'creatorA', 'contracted', v_admin);
  v_cb := pg_temp.mkdoc(v_org, 'creatorB', 'contracted', v_admin);
  v_ce := pg_temp.mkdoc(v_org, 'creatorEmployed', 'employed', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_cra := pg_temp.mkcreator(v_org, v_ca, 'Dr Alpha Creator', v_admin);
  v_crb := pg_temp.mkcreator(v_org, v_cb, 'Dr Beta Creator', v_admin);
  v_cre := pg_temp.mkcreator(v_org, v_ce, 'Dr Employed Creator', v_admin);
  perform pg_temp.setf('org', v_org);

  perform pg_temp.ck('0 no fee schedule exists before the test (nothing is seeded)', not exists (select 1 from public.fee_schedules));

  -- 1. NO SCHEDULE: the item publishes, the line waits ------------------------------------------------------------------------
  v_i1 := pg_temp.mkitem('s58b-item-1', v_cra, 'Dr Reviewer One');
  perform pg_temp.ck('1a with no approved schedule no line is written and nothing is invented', pg_temp.lines(v_ca) = 0);
  perform pg_temp.ck('1b the sweep reports it deferred, not failed', (private.creator_item_earnings_sweep() ->> 'deferred')::integer >= 1 and pg_temp.lines(v_ca) = 0);

  -- schedule WITH the creator fee, approved by the admin
  v_items := '{"task_types":{},"on_call_shift_fee_kobo":0,"lead_fee_per_patient_month_kobo":0,"consultation_share_pct":{"video":0,"audio":0,"phone":0},"pilot_minimum_per_declared_hour_kobo":0,"creator_item_published_fee_kobo":250000}'::jsonb;
  perform pg_temp.ck('1c a fractional creator fee is refused by the schedule check',
    not private.fee_items_valid(jsonb_set(v_items, '{creator_item_published_fee_kobo}', '1.5'::jsonb)));
  perform pg_temp.ck('1d a negative creator fee is refused', not private.fee_items_valid(jsonb_set(v_items, '{creator_item_published_fee_kobo}', '-1'::jsonb)));
  perform pg_temp.ck('1e an unknown key is still refused', not private.fee_items_valid(v_items || '{"made_up":1}'::jsonb));
  perform pg_temp.ck('1f only an admin can draft a schedule',
    pg_temp.as_try(v_ca, format('select public.create_fee_schedule_draft(%L::jsonb)', v_items::text)) = '42501');
  d1 := pg_temp.as_val(v_admin, format('select public.create_fee_schedule_draft(%L::jsonb)::text', v_items::text))::uuid;
  perform pg_temp.as_val(v_admin, format('select public.approve_fee_schedule(%L)::text', d1));

  perform private.creator_item_earnings_sweep();
  select * into v_line from public.earnings_ledger where clinician_id = v_ca and kind = 'creator_item';
  perform pg_temp.ck('1g the first approved schedule pays the waiting item exactly the schedule amount, integer kobo',
    v_line.amount_kobo = 250000 and v_line.fee_schedule_version_id = d1 and v_line.payout_id is null);
  perform pg_temp.ck('1h the line records the item, its version and the schedule version',
    v_line.calculation ->> 'content_code' = 's58b-item-1' and (v_line.calculation ->> 'schedule_version') is not null and v_line.reference_type = 'health_education_content');
  perform pg_temp.ck('1i a sweep rerun does not pay twice', (private.creator_item_earnings_sweep() is not null) and pg_temp.lines(v_ca) = 1);
  update public.health_education_content set body = 'Proof body, edited.', title = 'S58b edited' where id = v_i1;
  update public.health_education_content set reviewed_by_name = 'Dr Reviewer Two', reviewed_at = now() where id = v_i1;
  perform pg_temp.ck('1j a new version and a re-review of the same item never pay twice',
    pg_temp.lines(v_ca) = 1 and (select version from public.health_education_content where id = v_i1) > 1);
  update public.health_education_content set content_status = 'review_due' where id = v_i1;
  update public.health_education_content set content_status = 'published' where id = v_i1;
  perform pg_temp.ck('1k a republish of the same item never pays twice', pg_temp.lines(v_ca) = 1);
  perform pg_temp.ck('1l the line is the creator test account (is_test), so a real payout skips it', (select is_test from public.earnings_ledger where clinician_id = v_ca and kind = 'creator_item'));

  -- a second item posts at once (trigger), from the approved schedule
  v_i2 := pg_temp.mkitem('s58b-item-2', v_cra, 'Dr Reviewer One');
  perform pg_temp.ck('1m a new item publishes and posts immediately', pg_temp.lines(v_ca) = 2);

  -- 2. NO FEE -----------------------------------------------------------------------------------------------------------------
  v_i3 := pg_temp.mkitem('s58b-item-employed', v_cre, 'Dr Reviewer One');
  perform pg_temp.ck('2a an employed creator (paid by salary) earns no line', pg_temp.lines(v_ce) = 0 and (private.creator_item_earnings_sweep() is not null) and pg_temp.lines(v_ce) = 0);
  v_i4 := pg_temp.mkitem('s58b-item-self', v_crb, 'dr beta creator');
  perform pg_temp.ck('2b the creator cannot be the named reviewer of their own paid item', pg_temp.lines(v_cb) = 0 and (private.creator_item_earnings_sweep() is not null) and pg_temp.lines(v_cb) = 0);
  -- withdrawn before posting: build the item with the earnings trigger off, take it down, nothing posts
  alter table public.health_education_content disable trigger health_education_content_creator_earnings;
  v_i5 := pg_temp.mkitem('s58b-item-withdrawn', v_crb, 'Dr Reviewer One');
  v_i6 := pg_temp.mkitem('s58b-item-expired', v_crb, 'Dr Reviewer One');
  alter table public.health_education_content enable trigger health_education_content_creator_earnings;
  update public.health_education_content set content_status = 'draft', is_active = false where id = v_i5;
  update public.health_education_content set next_review_due = v_today where id = v_i6;
  perform private.creator_item_earnings_sweep();
  perform pg_temp.ck('2c a withdrawn item and an item past its review date pay nothing', pg_temp.lines(v_cb) = 0);
  -- a suspended creator earns nothing on a new item
  update public.learning_creators set status = 'suspended', status_note = 'proof' where id = v_crb;
  perform pg_temp.ck('2d a suspended creator earns nothing (item credited to them stops being servable and posts no line)',
    (private.creator_item_earnings_sweep() is not null) and pg_temp.lines(v_cb) = 0);
  update public.learning_creators set status = 'verified' where id = v_crb;
  -- a draft with a creator
  insert into public.health_education_content (code, title, body, category, content_status, creator_id)
  values ('s58b-item-draft', 'S58b draft', 'Draft body.', 'getting_started', 'draft', v_cra);
  perform pg_temp.ck('2e a draft earns nothing', pg_temp.lines(v_ca) = 2);

  -- schedule without the key: zero line, flagged
  d2 := pg_temp.as_val(v_admin, format('select public.create_fee_schedule_draft(%L::jsonb)::text', (v_items - 'creator_item_published_fee_kobo')::text))::uuid;
  perform pg_temp.as_val(v_admin, format('select public.approve_fee_schedule(%L)::text', d2));
  v_i7 := pg_temp.mkitem('s58b-item-nofee', v_cra, 'Dr Reviewer One');
  select * into v_line from public.earnings_ledger where clinician_id = v_ca and reference_id = private.earnings_ref('creator_item:' || v_i7::text);
  perform pg_temp.ck('2f with no creator fee in the schedule the line is a zero line flagged needs_review, never a guess',
    v_line.amount_kobo = 0 and v_line.calculation ->> 'needs_review' = 'no_fee_for_creator_item');
  perform pg_temp.ck('2g the flagged line appears in the admin review list',
    pg_temp.as_val(v_admin, format($q$select count(*)::text from public.earnings_needing_review(true) where id = %L$q$, v_line.id)) = '1');

  -- 3. ACCESS --------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('3a the creator reads exactly their own creator lines', pg_temp.as_val(v_ca, $q$select count(*)::text from public.earnings_ledger where kind = 'creator_item'$q$) = '3');
  perform pg_temp.ck('3b another creator reads none of them', pg_temp.as_val(v_cb, $q$select count(*)::text from public.earnings_ledger where kind = 'creator_item'$q$) = '0');
  perform pg_temp.ck('3c a patient reads none', pg_temp.as_val(v_pat, $q$select count(*)::text from public.earnings_ledger where kind = 'creator_item'$q$) = '0');
  perform pg_temp.ck('3d anon is refused', pg_temp.anon_val($q$select count(*)::text from public.earnings_ledger$q$) like 'ERR:%');
  perform pg_temp.ck('3e an admin reads the organisation''s creator lines', pg_temp.as_val(v_admin, $q$select count(*)::text from public.earnings_ledger where kind = 'creator_item'$q$) = '3');
  perform pg_temp.ck('3f the creator''s own summary counts the lines under their kind',
    (pg_temp.as_val(v_ca, 'select public.my_earnings_summary()::text')::jsonb -> 'by_kind' ->> 'creator_item')::bigint = 250000 * 2);
  perform pg_temp.ck('3g a creator cannot write the ledger, a schedule, or post a line',
    pg_temp.as_try(v_ca, $q$insert into public.earnings_ledger (organisation_id, clinician_id, kind, reference_type, reference_id, amount_kobo, calculation, earned_at, employment_type) values (gen_random_uuid(), gen_random_uuid(), 'creator_item', 'x', gen_random_uuid(), 1, '{}', now(), 'contracted')$q$) <> 'ok'
    and pg_temp.as_try(v_ca, $q$select private.post_creator_item_earning(gen_random_uuid())$q$) <> 'ok'
    and pg_temp.as_try(v_ca, $q$update public.earnings_ledger set amount_kobo = 99999999$q$) <> 'ok');
  perform pg_temp.ck('3h money is integer kobo (the column is bigint)', (select data_type from information_schema.columns where table_name = 'earnings_ledger' and column_name = 'amount_kobo') = 'bigint');

  -- 4. INTEGRITY (S55-06b) ---------------------------------------------------------------------------------------------------
  perform pg_temp.ck('4a reviewer cannot be cleared on a published item', pg_temp.try_sql(format('update public.health_education_content set reviewed_by_name = null where id = %L', v_i2)) = '23514');
  perform pg_temp.ck('4b ...nor blanked', pg_temp.try_sql(format($q$update public.health_education_content set reviewed_by_name = '  ' where id = %L$q$, v_i2)) = '23514');
  perform pg_temp.ck('4c review date cannot be cleared', pg_temp.try_sql(format('update public.health_education_content set reviewed_at = null where id = %L', v_i2)) = '23514');
  perform pg_temp.ck('4d the reviewed mark cannot be cleared', pg_temp.try_sql(format('update public.health_education_content set clinician_reviewed = false where id = %L', v_i2)) = '23514');
  perform pg_temp.ck('4e the source cannot be cleared', pg_temp.try_sql(format('update public.health_education_content set source_reference = null where id = %L', v_i2)) = '23514');
  perform pg_temp.ck('4f ...nor on a review_due item that is still served',
    pg_temp.try_sql(format($q$update public.health_education_content set content_status = 'review_due' where id = %L$q$, v_i2)) = 'ok'
    and pg_temp.try_sql(format('update public.health_education_content set source_reference = null where id = %L', v_i2)) = '23514');
  update public.health_education_content set content_status = 'published' where id = v_i2;
  perform pg_temp.ck('4g a re-review to other real values is allowed',
    pg_temp.try_sql(format($q$update public.health_education_content set reviewed_by_name = 'Dr Someone Else', source_reference = 'A newer source' where id = %L$q$, v_i2)) = 'ok');
  perform pg_temp.ck('4h a draft is free to edit and clear', pg_temp.try_sql($q$update public.health_education_content set reviewed_by_name = null, source_reference = null where code = 's58b-item-draft'$q$) = 'ok');
  perform pg_temp.ck('4i a micro-lesson check with no options cannot be published',
    pg_temp.try_sql($q$insert into public.health_education_content (code, title, body, category, content_status, clinician_reviewed, next_review_due, reviewed_by_name, reviewed_at, source_reference, self_care_action, is_micro_lesson, lesson_action, estimated_minutes, knowledge_check)
      values ('s58b-micro-bad', 't', 'b', 'getting_started', 'published', true, current_date + 90, 'Dr Reviewer One', now(), 'src', 'Take one step today.', true, 'Do one thing now', 2,
              '[{"question":"q","options":[],"answer_index":null,"answer_text":"a"}]'::jsonb)$q$) = '23514');
  perform pg_temp.ck('4j ...but publishes once it has two options and a valid answer',
    pg_temp.try_sql($q$insert into public.health_education_content (code, title, body, category, content_status, clinician_reviewed, next_review_due, reviewed_by_name, reviewed_at, source_reference, self_care_action, is_micro_lesson, lesson_action, estimated_minutes, knowledge_check)
      values ('s58b-micro-ok', 't', 'b', 'getting_started', 'published', true, current_date + 90, 'Dr Reviewer One', now(), 'src', 'Take one step today.', true, 'Do one thing now', 2,
              '[{"question":"q","options":["a","b"],"answer_index":1}]'::jsonb)$q$) = 'ok');

  -- 5. SEED ------------------------------------------------------------------------------------------------------------------
  perform pg_temp.ck('5a twenty draft rows exist', (select count(*) from public.health_education_content where code ~ '^(myth-(0[1-9]|10)|bp-lesson-(0[1-9]|10))$') = 20);
  perform pg_temp.ck('5b every one is closed: draft, inactive, placeholder, no reviewer, no author',
    not exists (select 1 from public.health_education_content where code ~ '^(myth-(0[1-9]|10)|bp-lesson-(0[1-9]|10))$'
                 and (content_status <> 'draft' or is_active or not is_placeholder or clinician_reviewed or reviewed_by_name is not null or clinical_author_name is not null)));
  perform pg_temp.ck('5c ten lessons are micro-lessons with an action, the check stored without invented options',
    (select count(*) from public.health_education_content where code like 'bp-lesson-%' and is_micro_lesson and lesson_action is not null
        and knowledge_check -> 0 ->> 'answer_text' is not null and jsonb_array_length(knowledge_check -> 0 -> 'options') = 0) = 10);
  perform pg_temp.ck('5d a draft cannot be published even with every other field filled',
    pg_temp.try_sql($q$update public.health_education_content set content_status = 'published', clinician_reviewed = true, reviewed_by_name = 'Dr Reviewer One', reviewed_at = now(),
       next_review_due = current_date + 90, source_reference = 'src', self_care_action = 'Take one step today.' where code = 'myth-01'$q$) = '23514');
  perform pg_temp.ck('5e the placeholder flag cannot be cleared without a named clinical author',
    pg_temp.try_sql($q$update public.health_education_content set is_placeholder = false where code = 'myth-01'$q$) = '23514');
  perform pg_temp.ck('5f the seeded drafts are not visible to a patient',
    pg_temp.as_val(v_pat, $q$select count(*)::text from public.health_education_content where code ~ '^(myth-(0[1-9]|10)|bp-lesson-(0[1-9]|10))$'$q$) = '0');
  perform pg_temp.ck('5g the new course and the myth series stay inactive',
    not exists (select 1 from public.health_education_programmes where code in ('bp_care_course', 'myth_busting') and is_active));
  perform pg_temp.ck('5h the myth series holds the 6 older placeholders plus 10 drafts, the course holds 10',
    (select count(*) from public.health_education_programme_modules m join public.health_education_programmes p on p.id = m.programme_id where p.code = 'myth_busting') = 16
    and (select count(*) from public.health_education_programme_modules m join public.health_education_programmes p on p.id = m.programme_id where p.code = 'bp_care_course') = 10);

  -- 6. SEVERITY --------------------------------------------------------------------------------------------------------------
  update public.event_types set is_active = false where event_type in ('lesson.completed', 'vitals.logged');
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pat, v_i2, 'understood');
  perform pg_temp.ck('6a a lesson-event failure opens a SEV2 incident', exists (select 1 from public.ops_incidents where external_reference = 'learning_event_failed' and severity = 'sev2' and status not in ('resolved', 'closed')));
  perform pg_temp.ck('6b ...and not a sev1', not exists (select 1 from public.ops_incidents where external_reference = 'learning_event_failed' and severity = 'sev1'));
  perform private.rewards_emit('vitals.logged', v_pat, '{"vitals_id":"x"}'::jsonb, gen_random_uuid()::text, 'vitals_readings', gen_random_uuid());
  perform pg_temp.ck('6c a rewards-event failure opens a SEV3 incident', exists (select 1 from public.ops_incidents where external_reference = 'rewards_event_failed' and severity = 'sev3' and status not in ('resolved', 'closed')));
  perform pg_temp.ck('6d ...and not a sev1 or sev2', not exists (select 1 from public.ops_incidents where external_reference = 'rewards_event_failed' and severity in ('sev1', 'sev2')));
  perform pg_temp.ck('6e the patient''s own progress was saved', exists (select 1 from public.health_education_progress where patient_id = v_pat and content_id = v_i2 and status = 'understood'));
  update public.event_types set is_active = true where event_type in ('lesson.completed', 'vitals.logged');

  -- 7. POINTS NEVER EXPIRE; CLASS CAP -----------------------------------------------------------------------------------------
  perform pg_temp.ck('7a no points table has an expiry-like column',
    not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and (table_name like 'wellness_points%' or table_name like 'reward%' or table_name like 'points%')
                 and column_name ~* '(expir|lapse|valid_until|valid_to|expires|decay|forfeit)'));
  perform pg_temp.ck('7b no function acts on points and mentions expiry',
    not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                 where n.nspname in ('public', 'private') and p.prosrc ~* 'wellness_points_(balances|ledger)'
                   -- the checkout order's own expires_at (apply_points_discount) is an order timeout, not a points expiry
                   and regexp_replace(p.prosrc, 'v_order\.expires_at', '', 'g') ~* '(expire|expiry|expired|lapse|forfeit)'));
  perform pg_temp.ck('7c no scheduled job mentions points expiry',
    not exists (select 1 from cron.job where command ~* '(points|reward)' and command ~* '(expire|expiry|lapse|forfeit)'));
  perform pg_temp.ck('7d no reward setting is called expiry or decay', not exists (select 1 from public.reward_config where key ~* '(expir|decay|lapse)' or value::text ~* '"(expires|expiry|expire_after|decay)'));
  perform pg_temp.ck('7e the class attendance rule keeps its cap of 2 a day',
    exists (select 1 from public.reward_rules where trigger_event = 'class.attended' and (caps ->> 'per_day')::integer = 2));
end $$;

-- SABOTAGE ---------------------------------------------------------------------------------------------------------------------
do $$
declare v_id uuid; v_org uuid := pg_temp.f('org'); v_before bigint; v_creator uuid;
begin
  -- 1. integrity trigger dropped: clearing the reviewer on a published item must become possible
  select id into v_id from public.health_education_content where code = 's58b-item-2';
  drop trigger health_education_published_integrity on public.health_education_content;
  insert into sab values ('integrity trigger removed: clearing a published reviewer', 'refused',
    case when pg_temp.try_sql(format('update public.health_education_content set reviewed_by_name = null where id = %L', v_id)) = 'ok' then 'allowed' else 'refused' end);
  -- 2. creator-earnings trigger dropped: a fresh publish no longer posts at once
  select id into v_creator from public.learning_creators where display_name = 'Dr Alpha Creator';
  select count(*) into v_before from public.earnings_ledger where kind = 'creator_item';
  drop trigger health_education_content_creator_earnings on public.health_education_content;
  perform pg_temp.mkitem('s58b-item-sab', v_creator, 'Dr Reviewer One');
  insert into sab values ('creator-earnings trigger removed: a publish posts immediately', 'posted',
    case when (select count(*) from public.earnings_ledger where kind = 'creator_item') > v_before then 'posted' else 'not posted' end);
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where not ok;
  if v_bad > 0 then raise exception 'S58b proof FAILED on the real migrations'; end if;
  select count(*) into v_caught from sab where expected <> actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: the sabotage flipped % of 2 checks', v_caught; end if;
end $$;

select n, check_name, 'PASS' as result from results order by n;
select name as sabotage, expected, actual, case when expected <> actual then 'FLIPPED (good)' else 'NOT FLIPPED' end as verdict from sab;

rollback;

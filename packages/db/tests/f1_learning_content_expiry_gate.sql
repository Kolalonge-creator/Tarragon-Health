-- Proof (F1 fix 1): learning content past its review date is NOT served.
--
-- Covers the whole read surface a patient reaches: direct table read (RLS), the library, detail and
-- category-count RPCs, the AI-coach text/vector retrieval RPC, and programme detail. The key case is the
-- one the old design missed: status is still 'published' and is_active is still true (the daily job has not
-- run yet) but next_review_due has passed. It must already be invisible. Also proves one authoritative
-- column (a write to the legacy review_due_at is translated), the flag job, the republish guard, and that an
-- admin still sees everything. Sabotage: the rule is neutered and the expired row must become visible again.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

do $$
declare
  v_admin   uuid;
  v_patient uuid;
  v_id      uuid;
  v_today   date := (now() at time zone 'Africa/Lagos')::date;
  v_n       integer;
  v_flagged integer;
  v_status  public.health_education_content_status;
  v_caught  boolean;
  v_cat_live integer;
begin
  select id into v_admin   from public.profiles where role = 'admin'   limit 1;
  select id into v_patient from public.profiles where role = 'patient' limit 1;
  if v_admin is null or v_patient is null then
    raise exception 'fixtures unavailable: need an admin and a patient profile';
  end if;

  -- A published item with a FUTURE review date (owner insert; the status trigger sets is_active).
  -- (S55: the publish gate now also needs a named reviewer, a source, a self-care action and, for a micro-lesson,
  -- its one action and one check question; this item is a shared-article micro-lesson so every S55 reader is covered.)
  insert into public.health_education_content
    (code, title, body, category, content_status, clinician_reviewed, next_review_due,
     reviewed_by_name, reviewed_at, source_reference, self_care_action,
     is_micro_lesson, lesson_action, estimated_minutes, knowledge_check)
  values ('f1-proof-expiry', 'F1 proof item', 'Body text for the F1 expiry proof.', 'getting_started',
          'published', true, v_today + 30,
          'Dr Proof Reviewer', now(), 'F1 proof source', 'Take one proof step today.',
          true, 'Do the one proof action', 3,
          '[{"question":"Proof question?","options":["a","b"],"answer_index":0}]'::jsonb)
  returning id into v_id;
  if not (select is_active from public.health_education_content where id = v_id) then
    raise exception 'FAIL setup: published item should be is_active';
  end if;

  -- ---------------- 1. Not yet due: every reader serves it -----------------------------------------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_content where id = v_id;
  if v_n <> 1 then raise exception 'FAIL 1a: patient cannot read a servable item directly'; end if;
  select count(*) into v_n from public.health_education_library(null) where content_id = v_id;
  if v_n <> 1 then raise exception 'FAIL 1b: library does not list a servable item'; end if;
  select count(*) into v_n from public.health_education_content_detail('f1-proof-expiry');
  if v_n <> 1 then raise exception 'FAIL 1c: detail does not return a servable item'; end if;
  select coalesce(sum(item_count), 0) into v_cat_live from public.health_education_category_counts() where category = 'getting_started';
  -- S55 readers serve it while it is in date (the gate must OPEN as well as close)
  select count(*) into v_n from public.search_health_education('F1 proof item') where code = 'f1-proof-expiry';
  if v_n <> 1 then raise exception 'FAIL 1d: search does not find a servable item'; end if;
  select count(*) into v_n from public.health_education_item_trust(array['f1-proof-expiry']);
  if v_n <> 1 then raise exception 'FAIL 1e: trust lookup does not return a servable item'; end if;
  select count(*) into v_n from public.daily_micro_lesson() where code = 'f1-proof-expiry';
  if v_n <> 1 then raise exception 'FAIL 1f: the daily lesson card does not offer a servable micro-lesson'; end if;
  select count(*) into v_n from public.learning_offline_pack() where code = 'f1-proof-expiry';
  if v_n <> 1 then raise exception 'FAIL 1g: the offline pack omits a servable item'; end if;
  reset role;
  set local role anon;
  select count(*) into v_n from public.learn_shared_article('f1-proof-expiry');
  reset role;
  if v_n <> 1 then raise exception 'FAIL 1h: a shared link does not open a servable article'; end if;

  -- ---------------- 2. Date passes, cron has NOT run: status published, is_active still true --------------
  update public.health_education_content set next_review_due = v_today - 1 where id = v_id;
  if not (select is_active from public.health_education_content where id = v_id)
     or (select content_status from public.health_education_content where id = v_id) <> 'published' then
    raise exception 'FAIL setup 2: expected the stale-flag state (published + is_active) before the job runs';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_content where id = v_id;
  if v_n <> 0 then raise exception 'FAIL 2a: patient can still read an expired item directly'; end if;
  select count(*) into v_n from public.health_education_library(null) where content_id = v_id;
  if v_n <> 0 then raise exception 'FAIL 2b: library still lists an expired item'; end if;
  select count(*) into v_n from public.health_education_content_detail('f1-proof-expiry');
  if v_n <> 0 then raise exception 'FAIL 2c: detail still returns an expired item'; end if;
  reset role;

  -- category count drops by exactly the one expired item
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(sum(item_count), 0) into v_n from public.health_education_category_counts() where category = 'getting_started';
  reset role;
  if v_n <> v_cat_live - 1 then
    raise exception 'FAIL 2f: category count did not drop by one when the item expired (% -> %)', v_cat_live, v_n;
  end if;

  -- AI coach retrieval (invoker, clinician_reviewed + servable)
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n
    from public.search_health_education_content_text('F1 proof item expiry', 10, null) r
    where r.id = v_id;
  if v_n <> 0 then raise exception 'FAIL 2d: coach text retrieval still returns an expired item'; end if;
  reset role;

  -- an admin still sees it (editing/re-review must stay possible)
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_content where id = v_id;
  if v_n <> 1 then raise exception 'FAIL 2e: admin lost sight of an expired item'; end if;
  reset role;

  -- ---------------- 2g. S55 readers: the same expired item is invisible on every new reader ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.search_health_education('F1 proof item') where code = 'f1-proof-expiry';
  if v_n <> 0 then raise exception 'FAIL 2g-1: search still returns an expired item'; end if;
  select count(*) into v_n from public.health_education_item_trust(array['f1-proof-expiry']);
  if v_n <> 0 then raise exception 'FAIL 2g-2: trust lookup still returns an expired item'; end if;
  select count(*) into v_n from public.daily_micro_lesson() where code = 'f1-proof-expiry';
  if v_n <> 0 then raise exception 'FAIL 2g-3: the daily lesson card still offers an expired lesson'; end if;
  select count(*) into v_n from public.learning_offline_pack() where code = 'f1-proof-expiry';
  if v_n <> 0 then raise exception 'FAIL 2g-4: the offline pack still includes an expired item'; end if;
  select count(*) into v_n from public.learning_pack_status(array['f1-proof-expiry']) where servable;
  if v_n <> 0 then raise exception 'FAIL 2g-5: pack status still says an expired item is servable'; end if;
  if public.save_lesson_for_consultation('f1-proof-expiry') then
    raise exception 'FAIL 2g-6: an expired lesson could be saved for a consultation';
  end if;
  reset role;
  set local role anon;
  select count(*) into v_n from public.learn_shared_article('f1-proof-expiry');
  reset role;
  if v_n <> 0 then raise exception 'FAIL 2g-7: a shared link still opens an expired article'; end if;

  -- ---------------- 3. Flag job moves it to review_due; no longer is_active --------------------------------
  v_flagged := private.health_education_flag_overdue_reviews();
  if v_flagged < 1 then raise exception 'FAIL 3a: flag job did not flag the expired item (%)', v_flagged; end if;
  select content_status into v_status from public.health_education_content where id = v_id;
  if v_status <> 'review_due' then
    raise exception 'FAIL 3b: flagged item should be review_due (got %)', v_status;
  end if;
  if not exists (select 1 from public.health_education_content where id = v_id and review_flagged_at is not null and review_flag_reason is not null) then
    raise exception 'FAIL 3c: the flag job did not record why the item was flagged';
  end if;
  -- review_due is still is_active (a flag is not an outage), but this item is past ITS OWN date so it stays hidden
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_content where id = v_id;
  reset role;
  if v_n <> 0 then raise exception 'FAIL 3d: a review_due item past its own date is still readable'; end if;

  -- ---------------- 4. Republish guard: cannot publish while the date is still in the past ----------------
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_caught := false;
  begin
    perform public.set_health_education_content_status(v_id, 'published', 'should be refused');
  exception when others then v_caught := true;
  end;
  if not v_caught then raise exception 'FAIL 4a: republished an item whose review date is still past'; end if;

  update public.health_education_content set next_review_due = v_today + 90 where id = v_id;
  perform public.set_health_education_content_status(v_id, 'published', 'reviewed again');
  reset role;
  if not (select is_active from public.health_education_content where id = v_id) then
    raise exception 'FAIL 4b: republish with a future date should be active';
  end if;

  -- ---------------- 5. One authoritative column: legacy review_due_at write is translated -----------------
  update public.health_education_content
     set review_due_at = ((v_today - 3)::timestamp at time zone 'Africa/Lagos') where id = v_id;
  if (select next_review_due from public.health_education_content where id = v_id) <> v_today - 3 then
    raise exception 'FAIL 5a: a write to legacy review_due_at did not move next_review_due';
  end if;
  update public.health_education_content set next_review_due = v_today + 10 where id = v_id;
  if (select review_due_at from public.health_education_content where id = v_id)
       is distinct from ((v_today + 10)::timestamp at time zone 'Africa/Lagos') then
    raise exception 'FAIL 5b: review_due_at is not the mirror of next_review_due';
  end if;

  -- ---------------- 7. OQ-F1-04: a protocol bump flags for review but takes NOTHING offline ---------------------
  -- Two items on the bumped condition: one with a future date, one with no date at all. A third is already past
  -- its own date and must stay hidden. A protocol_versions row (version > 1) is inserted as the owner.
  declare
    v_staff uuid;
    v_cmo uuid;
    v_org uuid;
    v_future uuid;
    v_undated uuid;
    v_pastdue uuid;
    v_other uuid;
    v_ver integer;
  begin
    -- a protocol version can only be signed by the org's active Chief Medical Officer: make one (fixture) and act as them
    select organisation_id into v_org from public.profiles where id = v_admin;
    v_cmo := gen_random_uuid();
    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_cmo, 'f1-bump-cmo-' || v_cmo || '@example.invalid', 'x', now(), '{}', '{}');
    insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
    values (v_cmo, v_org, 'clinician', 'F1 bump cmo', '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
    on conflict (id) do nothing;
    insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
        license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
    values (v_org, v_cmo, 'F1 bump cmo', 'MDCN', 'F1-BUMP-' || substr(v_cmo::text, 1, 8), true, 'active', now(), v_admin,
        'chief_medical_officer', 'contracted', 2, true, v_admin, true)
    returning id into v_staff;
    -- (S55: the publish gate needs a named reviewer, a source, a self-care action and a future review date to publish, so the
    -- undated fixtures are inserted complete and the date is cleared afterwards, as the 235 grandfathered items have none.)
    insert into public.health_education_content (code, title, body, category, condition, content_status, clinician_reviewed, next_review_due,
      reviewed_by_name, reviewed_at, source_reference, self_care_action)
    values ('f1-bump-future', 'F1 bump future', 'Body.', 'getting_started', 'hypertension', 'published', true, v_today + 40,
      'Dr Proof Reviewer', now(), 'F1 proof source', 'Take one proof step today.') returning id into v_future;
    insert into public.health_education_content (code, title, body, category, condition, content_status, clinician_reviewed, next_review_due,
      reviewed_by_name, reviewed_at, source_reference, self_care_action)
    values ('f1-bump-undated', 'F1 bump undated', 'Body.', 'getting_started', 'hypertension', 'published', true, v_today + 40,
      'Dr Proof Reviewer', now(), 'F1 proof source', 'Take one proof step today.') returning id into v_undated;
    update public.health_education_content set next_review_due = null where id = v_undated;
    insert into public.health_education_content (code, title, body, category, condition, content_status, clinician_reviewed, next_review_due,
      reviewed_by_name, reviewed_at, source_reference, self_care_action)
    values ('f1-bump-pastdue', 'F1 bump past due', 'Body.', 'getting_started', 'hypertension', 'published', true, v_today + 5,
      'Dr Proof Reviewer', now(), 'F1 proof source', 'Take one proof step today.') returning id into v_pastdue;
    update public.health_education_content set next_review_due = v_today - 2 where id = v_pastdue;
    insert into public.health_education_content (code, title, body, category, condition, content_status, clinician_reviewed, next_review_due,
      reviewed_by_name, reviewed_at, source_reference, self_care_action)
    values ('f1-bump-other', 'F1 bump other condition', 'Body.', 'getting_started', 'diabetes', 'published', true, v_today + 40,
      'Dr Proof Reviewer', now(), 'F1 proof source', 'Take one proof step today.') returning id into v_other;

    select coalesce(max(version_number), 0) + 2 into v_ver from public.protocol_versions where protocol_id = 'hypertension' and organisation_id = v_org;
    perform set_config('request.jwt.claims', json_build_object('sub', v_cmo, 'role', 'authenticated')::text, true);
    insert into public.protocol_versions (organisation_id, protocol_id, version_number, title, change_summary, content, approved_by)
    values (v_org, 'hypertension', v_ver, 'F1 proof bump', 'F1 proof', '{}'::jsonb, v_staff);
    perform set_config('request.jwt.claims', '', true);

    if (select count(*) from public.health_education_content where id in (v_future, v_undated) and content_status = 'review_due' and is_active
          and review_flagged_at is not null and review_flag_reason like 'Protocol hypertension moved to version %') <> 2 then
      raise exception 'FAIL 7a: the bump did not flag the dated and undated items review_due with a visible reason, still active';
    end if;
    if (select content_status from public.health_education_content where id = v_other) <> 'published'
       or (select review_flagged_at from public.health_education_content where id = v_other) is not null then
      raise exception 'FAIL 7b: an unrelated condition was flagged';
    end if;

    -- patients keep reading both flagged items (no silent outage); the past-due one stays hidden
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.health_education_content where id in (v_future, v_undated);
    reset role;
    if v_n <> 2 then raise exception 'FAIL 7c: a protocol bump took flagged education offline (% of 2 readable)', v_n; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.health_education_library(null) where content_id in (v_future, v_undated);
    reset role;
    if v_n <> 2 then raise exception 'FAIL 7d: the library dropped flagged items after a bump (%)', v_n; end if;
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.health_education_content where id = v_pastdue;
    reset role;
    if v_n <> 0 then raise exception 'FAIL 7e: an item past its own date became readable'; end if;

    -- the flag clears when the item leaves review_due
    perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
    set local role authenticated;
    perform public.set_health_education_content_status(v_future, 'updated', 're-reviewed');
    reset role;
    if exists (select 1 from public.health_education_content where id = v_future and (review_flagged_at is not null or review_flag_reason is not null)) then
      raise exception 'FAIL 7f: the review flag was not cleared when the item left review_due';
    end if;

    -- the flag job's revoke is real: nobody outside the database owner may run it
    if has_function_privilege('authenticated', 'private.health_education_flag_overdue_reviews()', 'EXECUTE')
       or has_function_privilege('anon', 'private.health_education_flag_overdue_reviews()', 'EXECUTE') then
      raise exception 'FAIL 7g: the flag job is callable by anon or authenticated';
    end if;

    -- SABOTAGE (OQ-F1-04): make the status itself expire items, as the first F1 draft did; the bump must then hide them.
    create or replace function private.health_education_content_expired(
      p_status public.health_education_content_status, p_next_review_due date)
    returns boolean language sql stable set search_path = '' as $f$
      select p_status = 'review_due' or (p_next_review_due is not null and p_next_review_due <= (now() at time zone 'Africa/Lagos')::date) $f$;
    perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.health_education_content where id = v_undated;
    reset role;
    if v_n <> 0 then
      raise exception 'VACUOUS TEST (7): with status-based expiry a flagged item is still readable, so 7c proves nothing';
    end if;
  end;

  -- ---------------- 6. SABOTAGE: neuter the rule; the expired item must be served again --------------------
  update public.health_education_content set next_review_due = v_today - 1 where id = v_id;
  create or replace function private.health_education_content_expired(
    p_status public.health_education_content_status, p_next_review_due date)
  returns boolean language sql stable set search_path = '' as $f$ select false $f$;
  perform set_config('request.jwt.claims', json_build_object('sub', v_patient, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from public.health_education_content where id = v_id;
  reset role;
  if v_n <> 1 then
    raise exception 'FAIL (sabotage): with the expiry rule neutered the expired item should be readable; the gate is not what hides it (vacuous test)';
  end if;

  raise notice 'PASS: expired learning content is hidden at read time on every patient reader, flagged by the job, republish guarded, one authoritative review column';
end $$;

rollback;

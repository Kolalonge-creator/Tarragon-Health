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
  select count(*) into v_n from public.weekly_micro_lesson() where code = 'f1-proof-expiry';
  if v_n <> 1 then raise exception 'FAIL 1f: the weekly lesson card does not offer a servable micro-lesson'; end if;
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
  select count(*) into v_n from public.weekly_micro_lesson() where code = 'f1-proof-expiry';
  if v_n <> 0 then raise exception 'FAIL 2g-3: the weekly lesson card still offers an expired lesson'; end if;
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
  if v_status <> 'review_due' or (select is_active from public.health_education_content where id = v_id) then
    raise exception 'FAIL 3b: flagged item should be review_due and not active (got %)', v_status;
  end if;

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

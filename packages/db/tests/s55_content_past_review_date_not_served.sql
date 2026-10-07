-- S55 D4 proof: content past its review date is not served (migration *_s55_d4_never_serve_content_past_review_date.sql).
--
-- Proves in one rolled-back transaction, for a real library row:
--   1. A review date in the future, and no review date at all, are both served (control: the gate opens).
--   2. A review date that has passed (even though the cron has not flipped the status, is_active is still true) is NOT
--      returned to a patient by the library, the feed, the detail RPC, the category counts, a direct table read (RLS),
--      or the AI coach's lexical retrieval. The due date itself is also hidden (same boundary as the overdue cron).
--   3. An admin still sees the expired row (detail RPC and direct read), so the admin queue is unaffected.
--   4. The overdue cron still flips the status to review_due and is_active stays true (existing rule unchanged).
--   5. Anon cannot execute the helper or the library RPC.
--   6. SABOTAGE: with the helper replaced by one that always returns true, the expired row is served again, so the
--      matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin
  reset role;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's55-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S55 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, language = excluded.language;
  return v;
end $f$;
-- Does the library (all categories) return this code?  Counted through the public RPCs a patient actually uses.
create function pg_temp.in_library(p_code text) returns text language sql as
$$ select count(*)::text from public.health_education_library(null) where code = p_code $$;
create function pg_temp.in_feed(p_code text) returns text language sql as
$$ select count(*)::text from public.health_education_feed() where code = p_code $$;
create function pg_temp.in_detail(p_code text) returns text language sql as
$$ select count(*)::text from public.health_education_content_detail(p_code) $$;
create function pg_temp.in_table(p_code text) returns text language sql as
$$ select count(*)::text from public.health_education_content where code = p_code $$;
create function pg_temp.in_lexical(p_title text, p_code text) returns text language sql as
$$ select count(*)::text from public.search_health_education_content_text(p_title, 50, null) where code = p_code $$;

do $$
declare
  v_org uuid; v_pat uuid; v_admin uuid; v_id uuid; v_code text; v_title text;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_cat public.health_education_category; v_before integer; v_after integer; v_flipped integer;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');

  -- A generic (no condition), drip-free, always-visible published item with a distinctive title the lexical search can find.
  select id, code, category into v_id, v_code, v_cat from public.health_education_content
    where is_active and condition is null and drip_week is null and min_risk_level is null and min_age is null and max_age is null
    order by sort_order limit 1;
  if v_id is null then raise exception 'need one generic published library item to run this proof'; end if;
  v_title := 'Zzzquartzmarker review expiry proof';
  update public.health_education_content
    set title = v_title, summary = v_title, body = v_title || ' text', clinician_reviewed = true, next_review_due = null
    where id = v_id;

  -- 1. Controls: no date, and a future date, are served --------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('no review date: library serves it', '1', pg_temp.in_library(v_code));
  perform pg_temp.rec('no review date: feed serves it', '1', pg_temp.in_feed(v_code));
  perform pg_temp.rec('no review date: detail serves it', '1', pg_temp.in_detail(v_code));
  perform pg_temp.rec('no review date: lexical retrieval finds it', '1', pg_temp.in_lexical('zzzquartzmarker', v_code));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today + 1 where id = v_id;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('review date tomorrow: library serves it', '1', pg_temp.in_library(v_code));
  perform pg_temp.rec('review date tomorrow: table read serves it', '1', pg_temp.in_table(v_code));
  select coalesce(sum(item_count), 0) into v_before from public.health_education_category_counts() where category = v_cat;
  perform pg_temp.back();

  -- 2. The gate: due today and past dates are not served; the cron has not run, is_active is still true ---------
  update public.health_education_content set next_review_due = v_today where id = v_id;
  perform pg_temp.rec('setup: row is still active (cron has not flipped it)', 'true', (select is_active::text from public.health_education_content where id = v_id));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('due today: library hides it', '0', pg_temp.in_library(v_code));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today - 30 where id = v_id;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('past date: library hides it', '0', pg_temp.in_library(v_code));
  perform pg_temp.rec('past date: feed hides it', '0', pg_temp.in_feed(v_code));
  perform pg_temp.rec('past date: detail hides it', '0', pg_temp.in_detail(v_code));
  perform pg_temp.rec('past date: a direct table read (RLS) hides it', '0', pg_temp.in_table(v_code));
  perform pg_temp.rec('past date: AI coach lexical retrieval does not find it', '0', pg_temp.in_lexical('zzzquartzmarker', v_code));
  select coalesce(sum(item_count), 0) into v_after from public.health_education_category_counts() where category = v_cat;
  perform pg_temp.rec('past date: the category count drops by exactly one', (v_before - 1)::text, v_after::text);
  perform pg_temp.back();

  -- 3. Admin still sees it ------------------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('past date: an admin still reads the row (admin queue unaffected)', '1', pg_temp.in_table(v_code));
  perform pg_temp.rec('past date: an admin still gets the detail', '1', pg_temp.in_detail(v_code));
  perform pg_temp.back();

  -- 4. The existing cron still works and is_active semantics are unchanged ------------------------------------
  update public.health_education_content set content_status = 'published' where id = v_id;
  v_flipped := private.health_education_flag_overdue_reviews();
  perform pg_temp.rec('the overdue cron still flags the row review_due', 'review_due', (select content_status::text from public.health_education_content where id = v_id));
  perform pg_temp.rec('review_due keeps is_active (existing rule)', 'true', (select is_active::text from public.health_education_content where id = v_id));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('...and it is still not served', '0', pg_temp.in_library(v_code));
  perform pg_temp.back();

  -- 5. Anon ---------------------------------------------------------------------------------------------------
  perform pg_temp.rec('anon cannot execute the review-date helper', 'false', has_function_privilege('anon', 'private.health_education_review_in_date(date)', 'EXECUTE')::text);
  perform pg_temp.rec('anon cannot execute the library RPC', 'false', has_function_privilege('anon', 'public.health_education_library(public.health_education_category)', 'EXECUTE')::text);

  -- 6. SABOTAGE: the helper always returns true: the expired row is served again ---------------------------------
  create or replace function private.health_education_review_in_date(p_next_review_due date) returns boolean
    language sql stable set search_path = '' as 'select true';
  perform pg_temp.act(v_pat);
  insert into results values ('sabotaged', 'past date: library hides it', '0', pg_temp.in_library(v_code));
  insert into results values ('sabotaged', 'past date: AI coach lexical retrieval does not find it', '0', pg_temp.in_lexical('zzzquartzmarker', v_code));
  insert into results values ('sabotaged', 'past date: a direct table read (RLS) hides it', '0', pg_temp.in_table(v_code));
  perform pg_temp.back();
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S55 D4 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 3 then
    raise exception 'VACUOUS TEST: only % of 3 sabotage steps changed the matching check', v_caught;
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

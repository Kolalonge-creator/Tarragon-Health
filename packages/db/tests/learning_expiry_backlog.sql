-- Learning content expiry backlog proof (migration *_learning_expiry_backlog.sql).
--
--   A. ACCESS: the admin and the active Chief Medical Officer can read the backlog, the summary and the owner list and assign an owner;
--      a patient, an ordinary clinician and a signed-out visitor are refused every one of them; a patient cannot be made an owner;
--      clients cannot run the daily job (service role only).
--   B. THE LIST: items 30 / 14 / 7 days out land in the d30 / d14 / d7 buckets, an item 8 days out is d14, an item 31 days out and an item with
--      no review date are not listed, a draft placeholder is never listed, an item on or past its review date is listed as hidden with its days,
--      a review_due flag is shown, and the owner name comes through. The S55 expiry rule is not changed: the hidden items are hidden from a patient.
--   C. THE DAILY JOB: on a day an owned item is exactly at a threshold the owner gets ONE in-app notice carrying a count and no item title,
--      the CMO gets ONE digest, nobody else is notified, a second run the same day adds nothing, an inactive owner is not notified, and an
--      unowned item is counted in the digest but notifies no one.
--   D. THE CHANGE NOTE: a first publish needs no note; publishing a previously published item again after editing needs a new note of at least
--      10 characters (the old note is cleared when editing starts); a plain "reviewed again" move from review_due needs none; the note then comes through the patient reader (health_education_item_trust).
--   SABOTAGE: with the access check neutered a patient reads the backlog; with the note gate dropped a re-publish without a note passes; with
--   the once-a-day index dropped a second run notifies twice (so each check above can fail).
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
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'lxb-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'LXB ' || p_label, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, full_name = excluded.full_name, is_test = true, is_active = true;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as $f$
declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'LXB ' || p_label, 'MDCN', 'LXB-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', 2, true, p_admin, true);
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
-- run a scalar integer query as a user (anon when null); -1 on any error (a refusal)
create function pg_temp.as_count(p_uid uuid, p_sql text) returns integer language plpgsql as $f$
declare n integer;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql into n; exception when others then n := -1; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return n;
end $f$;
create function pg_temp.as_text(p_uid uuid, p_sql text) returns text language plpgsql as $f$
declare t text;
begin
  if p_uid is null then
    perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
    set local role anon;
  else
    perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
    set local role authenticated;
  end if;
  begin execute p_sql into t; exception when others then t := 'ERR'; end;
  reset role; perform set_config('request.jwt.claims', '', true);
  return t;
end $f$;
-- the Lagos calendar day, as the expiry rule counts it
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;
-- a published item (placed through the real publish gate as a draft first), then moved to a review date p_days from today
create function pg_temp.mkitem(p_code text, p_days integer, p_owner uuid default null) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content
    (code, title, summary, body, category, content_status, clinician_reviewed, reviewed_by_name, reviewed_at, source_reference,
     self_care_action, next_review_due)
  values (p_code, 'Title ' || p_code, 'Teaser ' || p_code, 'BODY-' || p_code, 'getting_started', 'draft', true, 'Dr Reviewer', now(),
          'Proof source', 'SELFCARE-' || p_code, current_date + 90)
  returning id into v;
  update public.health_education_content set content_status = 'published' where id = v;
  update public.health_education_content set next_review_due = pg_temp.today() + p_days, owner_profile_id = p_owner where id = v;
  return v;
end $f$;
-- the summary count for one metric, read as the admin
create function pg_temp.sm(p_admin uuid, p_metric text) returns integer language sql as
$$ select pg_temp.as_count(p_admin, format('select coalesce((select n::integer from public.learning_expiry_summary() where metric = %L), 0)', p_metric)) $$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid; v_doc uuid; v_own uuid; v_pat uuid; v_off uuid;
  v_i uuid; v_cl uuid; v_n integer; v_t text; v_res jsonb; v_before integer;
  b_hidden integer; b_d7 integer; b_d14 integer; b_d30 integer; b_noowner integer;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin);
  v_doc := pg_temp.mkdoc(v_org, 'doc', 'senior_medical_officer', v_admin);
  v_own := pg_temp.mkdoc(v_org, 'owner', 'senior_medical_officer', v_admin);
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  perform pg_temp.setf('admin', v_admin); perform pg_temp.setf('cmo', v_cmo); perform pg_temp.setf('doc', v_doc);
  perform pg_temp.setf('own', v_own); perform pg_temp.setf('pat', v_pat);

  -- summary counts before the fixtures, so the checks below are about the delta (a fresh replay may carry seeded content)
  b_hidden := pg_temp.sm(v_admin, 'hidden'); b_d7 := pg_temp.sm(v_admin, 'd7'); b_d14 := pg_temp.sm(v_admin, 'd14');
  b_d30 := pg_temp.sm(v_admin, 'd30'); b_noowner := pg_temp.sm(v_admin, 'no_owner');

  perform pg_temp.mkitem('lx-30', 30, v_own);
  perform pg_temp.mkitem('lx-14', 14, v_own);
  perform pg_temp.mkitem('lx-7', 7, null);
  perform pg_temp.mkitem('lx-8', 8, null);
  perform pg_temp.mkitem('lx-31', 31, null);
  perform pg_temp.mkitem('lx-h0', 0, v_own);
  v_i := pg_temp.mkitem('lx-h5', -5, null);
  update public.health_education_content set content_status = 'review_due' where id = v_i;
  v_i := pg_temp.mkitem('lx-nd', 90, null);
  update public.health_education_content set next_review_due = null where id = v_i;
  -- a draft placeholder with a date is never listed
  insert into public.health_education_content (code, title, summary, body, category, content_status, is_placeholder, next_review_due)
  values ('lx-ph', 'PH', 'x', 'DRAFT PLACEHOLDER', 'getting_started', 'draft', true, pg_temp.today() + 7);

  -- ================= A. access =================
  perform pg_temp.ck('A1 the admin reads the backlog: 6 of the fixtures listed (30, 14, 8, 7, hidden 0 and -5)',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where code like 'lx-%'$q$) = 6);
  perform pg_temp.ck('A2 the Chief Medical Officer reads the same list',
    pg_temp.as_count(v_cmo, $q$select count(*) from public.learning_expiry_backlog() where code like 'lx-%'$q$) = 6);
  perform pg_temp.ck('A3 a patient, an ordinary clinician and a signed-out visitor are refused the backlog',
    pg_temp.as_try(v_pat, 'select * from public.learning_expiry_backlog()') = '42501'
    and pg_temp.as_try(v_doc, 'select * from public.learning_expiry_backlog()') = '42501'
    and pg_temp.as_try(null, 'select * from public.learning_expiry_backlog()') in ('42501', '42883'));
  perform pg_temp.ck('A4 the same three are refused the summary and the owner list',
    pg_temp.as_try(v_pat, 'select * from public.learning_expiry_summary()') = '42501'
    and pg_temp.as_try(v_doc, 'select * from public.learning_expiry_summary()') = '42501'
    and pg_temp.as_try(v_pat, 'select * from public.learning_expiry_owner_candidates()') = '42501'
    and pg_temp.as_try(v_doc, 'select * from public.learning_expiry_owner_candidates()') = '42501');
  v_i := (select id from public.health_education_content where code = 'lx-7');
  perform pg_temp.ck('A5 a patient and an ordinary clinician cannot assign an owner',
    pg_temp.as_try(v_pat, format('select public.set_learning_content_owner(%L, %L)', v_i, v_own)) = '42501'
    and pg_temp.as_try(v_doc, format('select public.set_learning_content_owner(%L, %L)', v_i, v_own)) = '42501');
  -- Steps run one statement at a time: a volatile call and a table read inside one AND expression can be evaluated in any order.
  v_t := pg_temp.as_try(v_admin, format('select public.set_learning_content_owner(%L, %L)', v_i, v_own));
  v_before := (select count(*) from public.health_education_content where id = v_i and owner_profile_id = v_own);
  perform pg_temp.ck('A6a the admin assigns an owner', v_t = 'ok' and v_before = 1);
  v_t := pg_temp.as_try(v_cmo, format('select public.set_learning_content_owner(%L, null)', v_i));
  v_before := (select count(*) from public.health_education_content where id = v_i and owner_profile_id is null);
  perform pg_temp.ck('A6b the CMO clears the owner', v_t = 'ok' and v_before = 1);
  perform pg_temp.ck('A7 a patient cannot be made an owner, and the owner list leaves patients out',
    pg_temp.as_try(v_admin, format('select public.set_learning_content_owner(%L, %L)', v_i, v_pat)) = '23514'
    and pg_temp.as_count(v_admin, format('select count(*) from public.learning_expiry_owner_candidates() where profile_id = %L', v_pat)) = 0
    and pg_temp.as_count(v_admin, format('select count(*) from public.learning_expiry_owner_candidates() where profile_id = %L', v_own)) = 1);
  perform pg_temp.ck('A8 clients (admin and CMO included) cannot run the daily job',
    pg_temp.as_try(v_admin, 'select public.learning_expiry_run_alerts()') = '42501'
    and pg_temp.as_try(v_cmo, 'select public.learning_expiry_run_alerts()') = '42501'
    and pg_temp.as_try(v_pat, 'select public.learning_expiry_run_alerts()') = '42501');

  -- ================= B. the list =================
  perform pg_temp.ck('B1 buckets: 30 -> d30, 14 -> d14, 8 -> d14, 7 -> d7, 0 and -5 -> hidden',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where
      (code = 'lx-30' and bucket = 'd30') or (code = 'lx-14' and bucket = 'd14') or (code = 'lx-8' and bucket = 'd14') or (code = 'lx-7' and bucket = 'd7')
      or (code = 'lx-h0' and bucket = 'hidden') or (code = 'lx-h5' and bucket = 'hidden')$q$) = 6);
  perform pg_temp.ck('B2 the 31-day item, the undated item and the placeholder are not listed',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where code in ('lx-31', 'lx-nd', 'lx-ph')$q$) = 0);
  perform pg_temp.ck('B3 hidden items carry days <= 0, the review_due flag shows, and the owner name comes through',
    pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where code in ('lx-h0', 'lx-h5') and hidden and days_until_due <= 0$q$) = 2
    and pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where code = 'lx-h5' and review_flagged$q$) = 1
    and pg_temp.as_count(v_admin, $q$select count(*) from public.learning_expiry_backlog() where code = 'lx-30' and owner_name = 'LXB owner'$q$) = 1);
  perform pg_temp.ck('B4 the summary moved by exactly the fixtures: hidden +2, d7 +1, d14 +2, d30 +1, no owner +3 (lx-7, lx-8, lx-h5)',
    pg_temp.sm(v_admin, 'hidden') - b_hidden = 2 and pg_temp.sm(v_admin, 'd7') - b_d7 = 1 and pg_temp.sm(v_admin, 'd14') - b_d14 = 2
    and pg_temp.sm(v_admin, 'd30') - b_d30 = 1 and pg_temp.sm(v_admin, 'no_owner') - b_noowner = 3);
  perform pg_temp.ck('B5 the S55 rule is unchanged: a patient does not get the hidden item from the reader, but does get the in-date one',
    pg_temp.as_count(v_pat, $q$select count(*) from public.health_education_item_trust(array['lx-h0', 'lx-h5'])$q$) = 0
    and pg_temp.as_count(v_pat, $q$select count(*) from public.health_education_item_trust(array['lx-30', 'lx-7'])$q$) = 2);

  -- ================= C. the daily job =================
  -- lx-30 and lx-14 are owned by v_own and sit exactly on a threshold; lx-7 is unowned and sits on one too; lx-8 and lx-31 do not
  set local role service_role;
  v_res := public.learning_expiry_run_alerts();
  reset role;
  perform pg_temp.ck('C1 the job reports the items at a threshold (at least the 3 fixtures)', (v_res ->> 'items_at_threshold')::integer >= 3);
  perform pg_temp.ck('C2 the owner gets exactly one notice, with a count of 2 and no item title',
    (select count(*) from public.notifications where recipient_id = v_own and template = 'learning_expiry_owner') = 1
    and (select (payload ->> 'count') = '2' and payload::text not ilike '%Title lx%' and payload ->> 'area' = 'clinician'
           from public.notifications where recipient_id = v_own and template = 'learning_expiry_owner'));
  perform pg_temp.ck('C3 the CMO gets exactly one digest, and neither the admin, the ordinary clinician nor the patient is notified',
    (select count(*) from public.notifications where recipient_id = v_cmo and template = 'learning_expiry_cmo_digest') = 1
    and (select count(*) from public.notifications where recipient_id in (v_admin, v_doc, v_pat) and template like 'learning_expiry%') = 0);
  set local role service_role;
  v_res := public.learning_expiry_run_alerts();
  reset role;
  perform pg_temp.ck('C4 a second run the same day adds nothing',
    (v_res ->> 'owner_notices')::integer = 0 and (v_res ->> 'cmo_digests')::integer = 0
    and (select count(*) from public.notifications where recipient_id in (v_own, v_cmo) and template like 'learning_expiry%') = 2);
  delete from public.notifications where recipient_id in (v_own, v_cmo) and template like 'learning_expiry%';
  update public.profiles set is_active = false where id = v_own;
  set local role service_role;
  perform public.learning_expiry_run_alerts();
  reset role;
  perform pg_temp.ck('C5 an inactive owner is not notified',
    (select count(*) from public.notifications where recipient_id = v_own and template like 'learning_expiry%') = 0);
  update public.profiles set is_active = true where id = v_own;
  delete from public.notifications where recipient_id in (v_own, v_cmo) and template like 'learning_expiry%';

  -- ================= D. the change note =================
  v_i := pg_temp.mkitem('lx-note', 90, null);
  perform pg_temp.ck('D1 a first publish needed no note (the item above published without one)',
    (select content_status = 'published' and review_change_note is null from public.health_education_content where id = v_i));
  insert into public.health_education_content_status_history (content_id, from_status, to_status) values (v_i, 'draft', 'published');
  update public.health_education_content set content_status = 'updated' where id = v_i;
  v_t := 'ok';
  begin update public.health_education_content set content_status = 'published' where id = v_i; exception when others then v_t := sqlstate; end;
  perform pg_temp.ck('D2 publishing the item again without a note is refused (23514)', v_t = '23514');
  v_t := 'ok';
  begin update public.health_education_content set content_status = 'published', review_change_note = 'short' where id = v_i; exception when others then v_t := sqlstate; end;
  perform pg_temp.ck('D3 a note under 10 characters is refused', v_t = '23514');
  update public.health_education_content
     set content_status = 'published', review_change_note = 'Updated the salt advice to match the new protocol.' where id = v_i;
  perform pg_temp.ck('D4 a real note lets the new version publish, and the patient reader returns it',
    (select content_status = 'published' from public.health_education_content where id = v_i)
    and pg_temp.as_text(v_pat, $q$select review_change_note from public.health_education_item_trust(array['lx-note'])$q$) = 'Updated the salt advice to match the new protocol.');
  update public.health_education_content set content_status = 'updated' where id = v_i;
  perform pg_temp.ck('D5a the old note is cleared when the item leaves service for editing (it described the previous version)',
    (select review_change_note is null from public.health_education_content where id = v_i));
  v_t := 'ok';
  begin update public.health_education_content set content_status = 'published' where id = v_i; exception when others then v_t := sqlstate; end;
  perform pg_temp.ck('D5 so the next version cannot publish on the old note', v_t = '23514');
  -- the review_due -> published move (reviewed again, nothing changed) needs no note and keeps the one already shown
  update public.health_education_content set content_status = 'published', review_change_note = 'Updated the sodium advice for the new guideline.' where id = v_i;
  update public.health_education_content set content_status = 'review_due' where id = v_i;
  update public.health_education_content set content_status = 'published' where id = v_i;
  perform pg_temp.ck('D5b reviewed again with nothing changed (review_due to published) needs no new note and keeps the shown one',
    (select content_status = 'published' and review_change_note = 'Updated the sodium advice for the new guideline.' from public.health_education_content where id = v_i));
  update public.health_education_content set content_status = 'updated' where id = v_i;
  perform pg_temp.ck('D6 the note is limited to 500 characters',
    pg_temp.as_try(v_admin, format($q$update public.health_education_content set review_change_note = %L where id = %L$q$, repeat('x', 501), v_i)) <> 'ok'
    or (select char_length(review_change_note) <= 500 from public.health_education_content where id = v_i));

  -- ================= E. review findings: a lesson held back for a passed review date, and the two note bypasses =================
  -- E1/E2: a course lesson the S33 job took out of service (is_active = false, clinical_review, date passed) is still listed, as hidden, and counted.
  select m.content_id into v_cl from public.health_education_programme_modules m join public.health_education_content c on c.id = m.content_id where not c.is_placeholder order by m.content_id limit 1; -- a seeded placeholder must stay draft (health_education_content_placeholder_stays_draft), so never pick one
  v_before := pg_temp.sm(v_admin, 'hidden');
  update public.health_education_content set content_status = 'draft', is_active = false, review_change_note = 'The note that described the previous version.' where id = v_cl;
  update public.health_education_content set content_status = 'clinical_review', next_review_due = pg_temp.today() - 1 where id = v_cl;
  perform pg_temp.ck('E1 a lesson held back for a passed review date is listed as hidden',
    pg_temp.as_count(v_admin, format($q$select count(*) from public.learning_expiry_backlog() where content_id = %L and hidden$q$, v_cl)) = 1);
  perform pg_temp.ck('E2 and it is counted in the hidden tile', pg_temp.sm(v_admin, 'hidden') = v_before + 1);
  -- E3: the stale note is cleared on the S33 route straight to clinical_review, not only on the admin's move to 'updated'
  perform pg_temp.ck('E3 the previous version note is cleared when an item goes straight to clinical_review',
    (select review_change_note is null from public.health_education_content where id = v_cl));
  -- E4: the note cannot be edited on a live (published) item, where no reviewer would see it before patients do
  v_i := pg_temp.mkitem('lx-live', 90, null);
  v_t := 'ok';
  begin update public.health_education_content set review_change_note = 'Now safe to stop your tablets if you feel well.' where id = v_i; exception when others then v_t := sqlstate; end;
  perform pg_temp.ck('E4 the change note cannot be edited on a live item (23514)', v_t = '23514');

  -- ================= SABOTAGE =================
  -- (i) the access check neutered: a patient then reads the backlog (the check is what refuses them)
  create or replace function private.learning_can_manage_expiry() returns boolean language sql stable as $f$ select true $f$;
  perform pg_temp.ck('S1 sabotage: with the access check neutered a patient reads the backlog',
    pg_temp.as_count(v_pat, $q$select count(*) from public.learning_expiry_backlog() where code like 'lx-%'$q$) = 6);
  -- (ii) the note gate dropped: a new version then publishes with no note (the trigger is what refuses it)
  -- (the item must be a genuine new version first: previously published, now in editing, and the gate must refuse it before it is dropped)
  insert into public.health_education_content_status_history (content_id, from_status, to_status) values (v_i, 'draft', 'published');
  update public.health_education_content set content_status = 'updated' where id = v_i;
  v_t := 'ok';
  begin update public.health_education_content set content_status = 'published' where id = v_i; exception when others then v_t := sqlstate; end;
  perform pg_temp.ck('S2a control: with the gate in place that same re-publish is refused', v_t = '23514');
  drop trigger health_education_content_z_change_note_gate on public.health_education_content;
  update public.health_education_content set content_status = 'published' where id = v_i;
  perform pg_temp.ck('S2 sabotage: with the note gate dropped a new version publishes with no note',
    (select content_status = 'published' from public.health_education_content where id = v_i));
  -- (iii) the once-a-day index dropped: the second run on the same day notifies the owner again
  drop index public.notifications_learning_expiry_once_per_day;
  set local role service_role;
  perform public.learning_expiry_run_alerts();
  perform public.learning_expiry_run_alerts();
  reset role;
  perform pg_temp.ck('S3 sabotage: with the once-a-day index dropped the owner is notified twice',
    (select count(*) from public.notifications where recipient_id = v_own and template = 'learning_expiry_owner') = 2);

  -- (iv) the held-lesson rule dropped: the lesson held back for a passed review date then vanishes from the list
  create or replace function private.learning_held_for_overdue_review(uuid, boolean, public.health_education_content_status, date)
    returns boolean language sql stable as $f$ select false $f$;
  perform pg_temp.ck('S4 sabotage: without the held-lesson rule the held lesson is missing from the list',
    pg_temp.as_count(v_admin, format($q$select count(*) from public.learning_expiry_backlog() where content_id = %L$q$, v_cl)) = 0);

  raise notice 'PASS: learning expiry backlog, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;

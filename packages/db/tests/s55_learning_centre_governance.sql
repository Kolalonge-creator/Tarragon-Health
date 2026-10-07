-- S55 proof: Learning Centre governance and reads (migrations *_s55_when_to_seek_care_category.sql,
-- *_s55_learning_governance_aliases_creators.sql, *_s55_learning_read_functions.sql).
--
-- One rolled-back transaction. Depends on nothing but the migrations and seed.sql (no S33 objects).
--   1. Next step (9.4): a draft cannot be published without next_action + kind; an unknown lesson target is refused; with both
--      it publishes; an already-published row coming back from review_due is exempt.
--   2. Lesson length (9.2): a programme module over 5 minutes (or with none) is refused; so is lengthening a module lesson.
--   3. Reviewer credit (9.6): name and review date appear only when clinician_reviewed AND reviewed_at are set; a linked verified
--      clinician supplies the name; sources and next step are returned.
--   4. Aliases (9.3): a draft alias is not used by search; only the CMO can mark one reviewed (an admin is refused); a reviewed alias
--      makes "sugar" find a diabetes item; editing it returns it to draft; a patient cannot read the alias table.
--   5. Creators (9.7): a patient and an unverified clinician are refused; a verified clinician applies; a patient cannot approve;
--      an admin approves; a submission lands in clinical_review, inactive, Members-only, served to nobody; it cannot be published
--      straight from review, nor reviewed by its own creator; once reviewed by another verified clinician it is served, with the
--      byline: a member gets the body, a non-member gets it locked with no body; when the creator loses verification it vanishes.
--   6. Share (9.8): a public item needs a review record; anon reads it only while public, reviewed, in date and not Members.
--   7. This week (9.2): returns one short lesson, drops it when finished, never one over the limit.
--   8. Offline re-check (9.6): returns active in-date codes and omits an expired one.
--   9. SABOTAGE: with the publish gate trigger dropped a row publishes with no next step; with the alias guard dropped an admin can
--      mark an alias reviewed; with the creator gate dropped creator content publishes straight from review. Each must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.act_anon() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
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
  values (v, 's55g-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S55 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name, language = excluded.language;
  return v;
end $f$;
create function pg_temp.mkstaff(p_org uuid, p_profile uuid, p_name text, p_tier text, p_verified boolean, p_by uuid) returns uuid
language plpgsql as $f$
declare v uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, doctor_tier,
      credential_verified_at, credential_verified_by, license_verified_at, indemnity_insurer, indemnity_policy_number, indemnity_expires_at, is_test)
  values (p_org, p_profile, p_name, 'MDCN', 'S55-' || substr(p_profile::text, 1, 8), p_verified, p_tier::public.doctor_tier,
      case when p_verified then now() end, case when p_verified then p_by end, case when p_verified then now() end, 'Test Insurer', 'POL-1', now() + interval '1 year', true)
  returning id into v;
  return v;
end $f$;
create function pg_temp.lib(p_code text) returns text language sql as
$$ select count(*)::text from public.health_education_library(null) where code = p_code $$;
create function pg_temp.detail_body(p_code text) returns text language sql as
$$ select coalesce((select case when body is null then 'NULLBODY' else 'BODY' end from public.health_education_content_detail(p_code)), 'NOROW') $$;
create function pg_temp.mkcontent(p_code text, p_status text, p_min integer default 3) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  insert into public.health_education_content (code, title, summary, body, category, content_type, estimated_minutes, content_status)
  values (p_code, 'S55 ' || p_code, 'summary ' || p_code, 'body text for ' || p_code || ' that is long enough to be a real body', 'getting_started', 'article', p_min, 'draft')
  returning id into v;
  if p_status <> 'draft' then
    update public.health_education_content set next_action = 'Take your blood pressure today and write it down.', next_step_kind = 'booking' where id = v;
    update public.health_education_content set content_status = p_status::public.health_education_content_status where id = v;
  end if;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pat uuid; v_member uuid; v_clin uuid; v_unver uuid; v_cmo uuid; v_rev uuid;
  v_staff_clin uuid; v_staff_unver uuid; v_staff_cmo uuid; v_staff_rev uuid; v_creator uuid;
  v_a uuid; v_b uuid; v_c uuid; v_prog uuid; v_mod_ok uuid; v_n integer; v_row record;
  v_today date := (now() at time zone 'Africa/Lagos')::date;
  v_alias uuid; v_cr_content uuid; v_pub uuid; v_dm uuid; v_week uuid;
begin
  select organisation_id into v_org from public.profiles where organisation_id is not null group by organisation_id order by count(*) desc limit 1;
  if v_org is null then raise exception 'need an organisation to run this proof'; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_pat := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_member := pg_temp.mkuser(v_org, 'member', 'patient');
  v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician');
  v_unver := pg_temp.mkuser(v_org, 'unver', 'clinician');
  v_cmo := pg_temp.mkuser(v_org, 'cmo', 'clinician');
  v_rev := pg_temp.mkuser(v_org, 'rev', 'clinician');
  v_staff_clin := pg_temp.mkstaff(v_org, v_clin, 'Dr Creator Test', 'senior_medical_officer', true, v_admin);
  v_staff_unver := pg_temp.mkstaff(v_org, v_unver, 'Dr Unverified Test', 'medical_officer', false, v_admin);
  v_staff_cmo := pg_temp.mkstaff(v_org, v_cmo, 'Dr Chief Test', 'chief_medical_officer', true, v_admin);
  v_staff_rev := pg_temp.mkstaff(v_org, v_rev, 'Dr Reviewer Test', 'senior_medical_officer', true, v_admin);
  insert into public.patient_memberships (organisation_id, patient_id, source, is_test) values (v_org, v_member, 'purchase', true);

  -- 1. Next step gate ---------------------------------------------------------------------------------------------
  v_a := pg_temp.mkcontent('s55_gate_a', 'draft');
  perform pg_temp.rec('publishing with no next step is refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_a)));
  perform pg_temp.rec('a next step that names an unknown lesson is refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set next_action = 'Read the next lesson now.', next_step_kind = 'lesson', next_step_target_code = 'no_such_lesson', content_status = 'published' where id = %L$q$, v_a)));
  perform pg_temp.rec('a lesson-kind next step needs a target (table check)', '23514',
    pg_temp.try(format($q$update public.health_education_content set next_step_kind = 'lesson', next_step_target_code = null where id = %L$q$, v_a)));
  perform pg_temp.rec('with a next step it publishes', 'ok',
    pg_temp.try(format($q$update public.health_education_content set next_action = 'Take your blood pressure today.', next_step_kind = 'booking', content_status = 'published' where id = %L$q$, v_a)));
  perform pg_temp.rec('published item is active', 'true', (select is_active::text from public.health_education_content where id = v_a));
  update public.health_education_content set content_status = 'review_due' where id = v_a;
  update public.health_education_content set next_action = null, next_step_kind = null where id = v_a;
  perform pg_temp.rec('review_due back to published is exempt from the next-step rule', 'ok',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_a)));

  -- 2. Lesson length ----------------------------------------------------------------------------------------------
  v_b := pg_temp.mkcontent('s55_len_long', 'draft', 8);
  v_c := pg_temp.mkcontent('s55_len_ok', 'draft', 5);
  insert into public.health_education_programmes (code, title, is_active) values ('s55_test_programme', 'S55 test', false) returning id into v_prog;
  perform pg_temp.rec('a module over five minutes is refused', '23514',
    pg_temp.try(format($q$insert into public.health_education_programme_modules (programme_id, content_id, module_number, title) values (%L, %L, 1, 'long')$q$, v_prog, v_b)));
  perform pg_temp.rec('a five-minute module is accepted', 'ok',
    pg_temp.try(format($q$insert into public.health_education_programme_modules (programme_id, content_id, module_number, title) values (%L, %L, 2, 'ok')$q$, v_prog, v_c)));
  perform pg_temp.rec('lengthening a module lesson past five minutes is refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set estimated_minutes = 9 where id = %L$q$, v_c)));
  perform pg_temp.rec('a module lesson with no length is refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set estimated_minutes = null where id = %L$q$, v_c)));
  perform pg_temp.rec('a lesson outside any programme may be longer (control)', 'ok',
    pg_temp.try(format($q$update public.health_education_content set estimated_minutes = 9 where id = %L$q$, v_b)));

  -- 3. Reviewer credit, sources, next step --------------------------------------------------------------------------
  v_a := pg_temp.mkcontent('s55_credit', 'published');
  update public.health_education_content set clinician_reviewed = true, reviewed_by_name = 'Legacy Name', reviewed_at = null, source_reference = 'WHO 2023' where id = v_a;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('no review date: no reviewer credit', 'null', (select coalesce(reviewed_by_name, 'null') from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.back();
  update public.health_education_content set reviewed_at = now() where id = v_a;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('review date set: legacy free-text name shows', 'Legacy Name', (select reviewed_by_name from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.back();
  update public.health_education_content set clinical_owner_id = v_staff_rev where id = v_a;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a linked verified clinician supplies the name', 'Dr Reviewer Test', (select reviewed_by_name from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.rec('sources are returned', 'WHO 2023', (select source_reference from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.rec('the next step is returned', 'booking', (select next_step_kind from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.back();
  update public.health_education_content set clinician_reviewed = false where id = v_a;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('not reviewed: no credit even with a linked clinician', 'null', (select coalesce(reviewed_by_name, 'null') from public.health_education_library(null) where code = 's55_credit'));
  perform pg_temp.back();

  -- 4. Aliases ------------------------------------------------------------------------------------------------------
  v_dm := pg_temp.mkcontent('s55_dm_item', 'published');
  update public.health_education_content set title = 'Managing diabetes and your blood glucose every day', summary = 'Diabetes basics', body = 'Diabetes means your blood glucose runs high. Check glucose, eat well, take medicines.' where id = v_dm;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a draft alias is not used: "sugar" finds nothing', '0', (select count(*)::text from public.health_education_search('sugar') where code = 's55_dm_item'));
  perform pg_temp.rec('a plain word still works without any alias', '1', (select count(*)::text from public.health_education_search('diabetes') where code = 's55_dm_item'));
  perform pg_temp.rec('a patient cannot read the alias table', '0', (select count(*)::text from public.health_education_search_aliases));
  perform pg_temp.back();
  select id into v_alias from public.health_education_search_aliases where alias_normalised = 'sugar';
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin who is not the CMO cannot mark an alias reviewed', '42501',
    pg_temp.try(format($q$update public.health_education_search_aliases set review_state = 'clinician_reviewed' where id = %L$q$, v_alias)));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO can mark an alias reviewed', 'ok',
    pg_temp.try(format($q$update public.health_education_search_aliases set review_state = 'clinician_reviewed' where id = %L$q$, v_alias)));
  perform pg_temp.back();
  perform pg_temp.rec('the review is stamped with the CMO and a date', 'true',
    (select (reviewed_by = v_cmo and reviewed_at is not null)::text from public.health_education_search_aliases where id = v_alias));
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a reviewed alias makes "sugar" find the diabetes item', '1', (select count(*)::text from public.health_education_search('sugar') where code = 's55_dm_item'));
  perform pg_temp.rec('the matched alias is reported', 'sugar', (select matched_alias from public.health_education_search('sugar') where code = 's55_dm_item'));
  perform pg_temp.rec('a question-led search works across categories', '1', (select count(*)::text from public.health_education_search('what does my glucose reading mean?') where code = 's55_dm_item'));
  perform pg_temp.back();
  update public.health_education_search_aliases set expands_to = 'blood sugar glucose diabetes sugar level' where id = v_alias;
  perform pg_temp.rec('editing a reviewed alias returns it to draft', 'draft', (select review_state from public.health_education_search_aliases where id = v_alias));

  -- 5. Creators -----------------------------------------------------------------------------------------------------
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot apply as a creator', '42501', pg_temp.try('select public.apply_as_creator(''bio'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_unver);
  perform pg_temp.rec('an unverified clinician cannot apply', '42501', pg_temp.try('select public.apply_as_creator(''bio'')'));
  perform pg_temp.back();
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('a verified clinician can apply', 'ok', pg_temp.try('select public.apply_as_creator(''Cardiology and community health.'')'));
  perform pg_temp.back();
  select id into v_creator from public.creators where clinical_staff_id = v_staff_clin;
  perform pg_temp.rec('the application is pending', 'pending', (select status from public.creators where id = v_creator));
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('a pending creator cannot submit', '42501',
    pg_temp.try($q$select public.creator_submit_content('cr_pending_try','A title that is long enough','sum','This is a body that is certainly longer than fifty characters in total.','nutrition','article',3,'WHO 2023','Try this today.','booking',null)$q$));
  perform pg_temp.rec('a creator cannot approve themselves', '42501', pg_temp.try(format($q$select public.set_creator_status(%L, 'approved', 'I approve myself please')$q$, v_creator)));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a patient cannot approve a creator', '42501', pg_temp.try(format($q$select public.set_creator_status(%L, 'approved', 'Patient approving them')$q$, v_creator)));
  perform pg_temp.rec('a patient cannot read the creators table', '0', (select count(*)::text from public.creators));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an approval needs a reason', '22023', pg_temp.try(format($q$select public.set_creator_status(%L, 'approved', 'ok')$q$, v_creator)));
  perform pg_temp.rec('an admin can approve with a reason', 'ok', pg_temp.try(format($q$select public.set_creator_status(%L, 'approved', 'Credential checked by the clinical team.')$q$, v_creator)));
  perform pg_temp.back();
  perform pg_temp.act(v_clin);
  perform pg_temp.rec('an approved creator can submit', 'ok',
    pg_temp.try($q$select public.creator_submit_content('cr_series_one','Everyday salt and your pressure','sum','This is a body that is certainly longer than fifty characters in total.','nutrition','article',4,'WHO 2023, NICE NG136','Cut one salty stock cube from today.','booking',null)$q$));
  perform pg_temp.rec('a bad creator code is refused', '22023',
    pg_temp.try($q$select public.creator_submit_content('series_two','A title that is long enough','sum','This is a body that is certainly longer than fifty characters in total.','nutrition','article',4,'WHO 2023','Do this.','booking',null)$q$));
  perform pg_temp.rec('a creator must cite sources', '22023',
    pg_temp.try($q$select public.creator_submit_content('cr_no_src','A title that is long enough','sum','This is a body that is certainly longer than fifty characters in total.','nutrition','article',4,'','Do this today.','booking',null)$q$));
  perform pg_temp.rec('creator sees their own submission', '1', (select count(*)::text from public.creator_my_content() where code = 'cr_series_one'));
  perform pg_temp.back();
  select id into v_cr_content from public.health_education_content where code = 'cr_series_one';
  perform pg_temp.rec('submission lands in clinical_review', 'clinical_review', (select content_status::text from public.health_education_content where id = v_cr_content));
  perform pg_temp.rec('...inactive, unreviewed, Members only', 'false,false,true',
    (select is_active::text || ',' || clinician_reviewed::text || ',' || members_only::text from public.health_education_content where id = v_cr_content));
  perform pg_temp.rec('...byline from the verified profile', 'Dr Creator Test', (select author_name from public.health_education_content where id = v_cr_content));
  perform pg_temp.act(v_member);
  perform pg_temp.rec('a member is not served an unreviewed creator item', '0', pg_temp.lib('cr_series_one'));
  perform pg_temp.back();
  perform pg_temp.rec('creator content cannot be published straight from review', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_cr_content)));
  update public.health_education_content set content_status = 'approved', clinician_reviewed = true, reviewed_at = now() where id = v_cr_content;
  perform pg_temp.rec('approved but no verified reviewer: refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_cr_content)));
  update public.health_education_content set clinical_owner_id = v_staff_clin where id = v_cr_content;
  perform pg_temp.rec('the creator cannot review their own piece', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_cr_content)));
  update public.health_education_content set clinical_owner_id = v_staff_rev where id = v_cr_content;
  perform pg_temp.rec('reviewed by another verified clinician it publishes', 'ok',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_cr_content)));
  perform pg_temp.act(v_member);
  perform pg_temp.rec('a member is served the creator item', '1', pg_temp.lib('cr_series_one'));
  perform pg_temp.rec('...with the body', 'BODY', pg_temp.detail_body('cr_series_one'));
  perform pg_temp.rec('...and the creator byline', 'Dr Creator Test', (select creator_name from public.health_education_content_detail('cr_series_one')));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('a non-member sees it locked', 'true', (select locked::text from public.health_education_content_detail('cr_series_one')));
  perform pg_temp.rec('...with no body', 'NULLBODY', pg_temp.detail_body('cr_series_one'));
  perform pg_temp.rec('a non-member cannot read the row directly either', '0', (select count(*)::text from public.health_education_content where code = 'cr_series_one'));
  perform pg_temp.back();
  update public.clinical_staff set active = false where id = v_staff_clin;
  perform pg_temp.act(v_member);
  perform pg_temp.rec('a creator who stops being verified: their content stops being served', '0', pg_temp.lib('cr_series_one'));
  perform pg_temp.back();
  update public.clinical_staff set active = true where id = v_staff_clin;
  perform pg_temp.act(v_member);
  perform pg_temp.rec('...and returns when verification returns', '1', pg_temp.lib('cr_series_one'));
  perform pg_temp.back();

  -- 6. Share --------------------------------------------------------------------------------------------------------
  v_pub := pg_temp.mkcontent('s55_public', 'published');
  perform pg_temp.rec('a public flag needs a review record', '23514', pg_temp.try(format($q$update public.health_education_content set is_public = true where id = %L$q$, v_pub)));
  update public.health_education_content set clinician_reviewed = true, reviewed_at = now(), reviewed_by_name = 'Dr Public Reviewer', source_reference = 'WHO' where id = v_pub;
  perform pg_temp.rec('a reviewed item can be public', 'ok', pg_temp.try(format($q$update public.health_education_content set is_public = true where id = %L$q$, v_pub)));
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon reads a public, reviewed, in-date item', '1', (select count(*)::text from public.public_health_education_item('s55_public')));
  perform pg_temp.rec('anon cannot read a non-public item', '0', (select count(*)::text from public.public_health_education_item('s55_credit')));
  perform pg_temp.rec('anon cannot call the library', '42501', pg_temp.try('select * from public.health_education_library(null)'));
  perform pg_temp.rec('anon cannot call search', '42501', pg_temp.try('select * from public.health_education_search(''sugar'')'));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today where id = v_pub;
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon: an item due for review today is not served', '0', (select count(*)::text from public.public_health_education_item('s55_public')));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today + 30 where id = v_pub;
  update public.health_education_content set clinician_reviewed = false where id = v_pub;
  perform pg_temp.act_anon();
  perform pg_temp.rec('anon: an item that lost its review is not served', '0', (select count(*)::text from public.public_health_education_item('s55_public')));
  perform pg_temp.rec('anon: a Members item is never public', '0', (select count(*)::text from public.public_health_education_item('cr_series_one')));
  perform pg_temp.back();

  -- 7. This week ------------------------------------------------------------------------------------------------------
  v_week := pg_temp.mkcontent('s55_week_lesson', 'published', 4);
  update public.health_education_content set drip_week = null where drip_week is not null;
  update public.health_education_content set drip_week = 1 where id = v_week;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('this week: the short lesson is returned', 's55_week_lesson', (select code from public.learning_this_week() where code = 's55_week_lesson'));
  perform pg_temp.back();
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('this week: exactly one lesson comes back', '1', (select count(*)::text from public.learning_this_week()));
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (v_org, v_pat, v_week, 'understood');
  perform pg_temp.rec('this week: a finished lesson is not returned again', '0', (select count(*)::text from public.learning_this_week()));
  perform pg_temp.back();
  delete from public.health_education_progress where patient_id = v_pat;
  update public.health_education_content set estimated_minutes = 9 where id = v_week;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('this week: a lesson over the limit is never offered', '0', (select count(*)::text from public.learning_this_week()));
  perform pg_temp.back();

  -- 8. Offline re-check ------------------------------------------------------------------------------------------------
  update public.health_education_content set estimated_minutes = 4 where id = v_week;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('offline re-check returns an in-date code', '1', (select count(*)::text from public.health_education_servable_codes(array['s55_week_lesson'])));
  perform pg_temp.rec('offline re-check omits a Members item for a non-member', '0', (select count(*)::text from public.health_education_servable_codes(array['cr_series_one'])));
  perform pg_temp.back();
  update public.health_education_content set next_review_due = v_today - 1 where id = v_week;
  perform pg_temp.act(v_pat);
  perform pg_temp.rec('offline re-check omits an expired code (the phone then deletes it)', '0', (select count(*)::text from public.health_education_servable_codes(array['s55_week_lesson'])));
  perform pg_temp.back();

  -- 9. SABOTAGE ----------------------------------------------------------------------------------------------------------
  v_a := pg_temp.mkcontent('s55_sab_gate', 'draft');
  drop trigger health_education_content_publish_gate on public.health_education_content;
  insert into results values ('sabotaged', 'publishing with no next step is refused', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_a)));
  drop trigger health_education_search_aliases_guard on public.health_education_search_aliases;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', 'an admin who is not the CMO cannot mark an alias reviewed', '42501',
    pg_temp.try(format($q$update public.health_education_search_aliases set review_state = 'clinician_reviewed', reviewed_by = %L, reviewed_at = now() where id = %L$q$, v_admin, v_alias)));
  perform pg_temp.back();
  v_b := pg_temp.mkcontent('cr_sab_gate', 'draft');
  update public.health_education_content set creator_id = v_creator where id = v_b;
  update public.health_education_content set next_action = 'Do one small thing today.', next_step_kind = 'booking', clinician_reviewed = true, reviewed_at = now(), clinical_owner_id = v_staff_rev where id = v_b;
  drop trigger health_education_content_creator_gate on public.health_education_content;
  insert into results values ('sabotaged', 'creator content cannot be published straight from draft', '23514',
    pg_temp.try(format($q$update public.health_education_content set content_status = 'published' where id = %L$q$, v_b)));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S55 governance proof FAILED on the real migrations: %',
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

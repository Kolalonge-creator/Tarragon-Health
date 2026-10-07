-- S55 follow-up proof (migration *_s55_weekly_lesson_and_members_only_creator_series.sql).
--
--   W. WEEKLY PACING: a new person gets the week-1 lesson (later weeks stay locked by the drip); eight days in they get the week-2
--      lesson; finishing it keeps it as "this week's lesson, done" and offers no second one; only one row is ever returned; a lesson
--      over the configured micro-lesson minutes is never offered; anon cannot call it; the old daily function is gone.
--   M. CREATOR SERIES ARE A MEMBERS-ONLY PERK: a Member sees the body, audio, check and action of a credited lesson; a non-member,
--      a member whose membership has lapsed and a signed-out visitor see the title, the creator credit and the teaser but NOT the body,
--      audio, check, action or self-care text, through every reader (detail, trust, weekly lesson, shared article, offline pack, pack
--      status, direct table select); a non-member cannot record progress on it; non-creator content is unaffected for everyone; the admin
--      switch turns the perk off and on (non-admins refused, reason required, audited) and a missing switch fails closed.
--   SABOTAGE: with the lock function neutered a non-member reads the body; with the progress gate dropped a non-member can record
--   progress; with the perk switched off a non-member reads the body (so each check above can fail).
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
  values (v, 's55w-' || p_label || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, is_test)
  values (v, p_org, p_role::public.user_role, 'S55W ' || p_label, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true;
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
-- run a scalar integer query as a user (anon when p_uid is null); -1 on any error (a refusal)
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
-- run a scalar text query as a user (anon when null); 'ERR' on error
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
-- a published item; p_extra is a SET clause applied while still a draft, before the publish
create function pg_temp.mkitem(p_code text, p_set text default 'id = id') returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.health_education_content
    (code, title, summary, body, category, content_status, clinician_reviewed, reviewed_by_name, reviewed_at, source_reference,
     self_care_action, next_review_due)
  values (p_code, 'Title ' || p_code, 'Teaser ' || p_code, 'BODY-' || p_code, 'getting_started', 'draft', true, 'Dr Reviewer', now(),
          'Proof source', 'SELFCARE-' || p_code, current_date + 90)
  returning id into v;
  execute format('update public.health_education_content set %s where id = %L', p_set, v);
  update public.health_education_content set content_status = 'published' where id = v;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_pw uuid; v_pm uuid; v_pn uuid; v_pe uuid; v_cc uuid; v_other uuid;
  v_cr uuid; v_w1 uuid; v_w2 uuid; v_w3 uuid; v_cm uuid; v_probe uuid; v_cart uuid; v_free uuid; v_n integer; v_t text;
  v_q constant text := '[{"question":"q","options":["a","b"],"answer_index":0}]';
begin
  select id, organisation_id into v_admin, v_org from public.profiles where role = 'admin' limit 1;
  v_pw := pg_temp.mkuser(v_org, 'weekly', 'patient');
  v_pm := pg_temp.mkuser(v_org, 'member', 'patient');
  v_pn := pg_temp.mkuser(v_org, 'nonmember', 'patient');
  v_pe := pg_temp.mkuser(v_org, 'lapsed', 'patient');
  v_cc := pg_temp.mkuser(v_org, 'creator', 'clinician');
  v_other := pg_temp.mkuser(v_org, 'other-admin', 'admin');

  -- ================= W. weekly pacing =================
  v_w1 := pg_temp.mkitem('wk-1', format($s$is_micro_lesson = true, lesson_action = 'Walk ten minutes', estimated_minutes = 3, drip_week = 1, sort_order = 1, knowledge_check = %L::jsonb$s$, v_q));
  v_w2 := pg_temp.mkitem('wk-2', format($s$is_micro_lesson = true, lesson_action = 'Swap one salty snack', estimated_minutes = 4, drip_week = 2, sort_order = 2, knowledge_check = %L::jsonb$s$, v_q));
  v_w3 := pg_temp.mkitem('wk-3', format($s$is_micro_lesson = true, lesson_action = 'Check a food label', estimated_minutes = 5, drip_week = 3, sort_order = 3, knowledge_check = %L::jsonb$s$, v_q));

  perform pg_temp.ck('W1 a new person is offered the week-1 lesson',
    pg_temp.as_text(v_pw, $q$select code from public.weekly_micro_lesson()$q$) = 'wk-1');
  perform pg_temp.ck('W2 only one lesson is ever offered, and week 2 and 3 stay locked by the drip',
    pg_temp.as_count(v_pw, $q$select count(*) from public.weekly_micro_lesson()$q$) = 1);
  perform pg_temp.ck('W3 the lesson carries its minutes and they are within the configured cap',
    (select estimated_minutes <= (private.learning_config('micro_lesson') ->> 'max_minutes')::int from public.health_education_content where code = 'wk-1'));

  -- eight days into the programme: the person's clock (first engagement) moves to week 2
  insert into public.health_education_progress (organisation_id, patient_id, content_id, status, created_at, last_viewed_at)
  values (v_org, v_pw, v_w1, 'understood', now() - interval '8 days', now() - interval '8 days');
  update public.health_education_progress set understood_at = now() - interval '8 days' where patient_id = v_pw and content_id = v_w1;
  perform pg_temp.ck('W4 in programme week 2 the week-2 lesson is offered (the week-1 lesson was finished last week)',
    pg_temp.as_text(v_pw, $q$select code from public.weekly_micro_lesson()$q$) = 'wk-2');
  perform pg_temp.ck('W5 it is not marked done before the person finishes it',
    pg_temp.as_text(v_pw, $q$select completed_this_week::text from public.weekly_micro_lesson()$q$) = 'false');

  insert into public.health_education_progress (organisation_id, patient_id, content_id, status)
  values (v_org, v_pw, v_w2, 'understood');
  perform pg_temp.ck('W6 once finished, the same lesson stays as this week''s lesson, marked done',
    pg_temp.as_text(v_pw, $q$select code || ':' || completed_this_week::text from public.weekly_micro_lesson()$q$) = 'wk-2:true');
  perform pg_temp.ck('W7 a finished week offers no second lesson', pg_temp.as_count(v_pw, $q$select count(*) from public.weekly_micro_lesson()$q$) = 1);

  -- fifteen days in: week 3 is due and the week-2 lesson belongs to the past
  update public.health_education_progress set created_at = now() - interval '15 days', last_viewed_at = now() - interval '8 days', understood_at = now() - interval '15 days'
   where patient_id = v_pw and content_id = v_w1;
  update public.health_education_progress set last_viewed_at = now() - interval '8 days', understood_at = now() - interval '8 days' where patient_id = v_pw and content_id = v_w2;
  -- re-opening an old lesson refreshes last_viewed_at but must not make it "finished this week"
  update public.health_education_progress set last_viewed_at = now() where patient_id = v_pw and content_id = v_w2;
  perform pg_temp.ck('W8 the next programme week offers the next lesson (re-reading week 2 does not count as finishing this week)',
    pg_temp.as_text(v_pw, $q$select code from public.weekly_micro_lesson()$q$) = 'wk-3');

  -- over the cap: never offered (the publish gate keeps it out of new items; this checks the reader on its own)
  alter table public.health_education_content disable trigger health_education_publish_gate;
  update public.health_education_content set estimated_minutes = 9 where id = v_w3;
  alter table public.health_education_content enable trigger health_education_publish_gate;
  perform pg_temp.ck('W9 a lesson over the configured minutes is not offered',
    pg_temp.as_count(v_pw, $q$select count(*) from public.weekly_micro_lesson() where code = 'wk-3'$q$) = 0);
  update public.health_education_content set estimated_minutes = 5 where id = v_w3;

  perform pg_temp.ck('W10 anon cannot call it', pg_temp.as_count(null, 'select count(*) from public.weekly_micro_lesson()') = -1);
  perform pg_temp.ck('W11 the daily function is gone', to_regprocedure('public.daily_micro_lesson()') is null);

  -- ================= M. members-only creator series =================
  insert into public.learning_creators (organisation_id, profile_id, display_name, status, mdcn_number, credential_evidence, indemnity_confirmed, verified_by, verified_at)
  values (v_org, v_cc, 'Dr Creator Name', 'verified', 'MDCN12345', 'Folio sighted on the register', true, v_admin, now())
  returning id into v_cr;
  v_cart := pg_temp.mkitem('cr-article', format($s$creator_id = %L, audio_clip_id = 'LSN-001', video_url = 'https://example.invalid/v', knowledge_check = %L::jsonb$s$, v_cr, v_q));
  v_cm := pg_temp.mkitem('cr-micro', format($s$creator_id = %L, is_micro_lesson = true, lesson_action = 'CREATOR-ACTION', estimated_minutes = 3, drip_week = 1, sort_order = 0, knowledge_check = %L::jsonb$s$, v_cr, v_q));
  v_free := pg_temp.mkitem('free-article', 'audio_clip_id = ''LSN-002''');
  update public.health_education_content set content_type = 'article' where id in (v_cart, v_free, v_cm);

  insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
  values (v_org, v_pm, 'purchase', 'active', now() - interval '30 days', now() + interval '300 days', true),
         (v_org, v_pe, 'purchase', 'active', now() - interval '400 days', now() - interval '35 days', true);

  -- the Member
  perform pg_temp.ck('M1 a Member reads the creator lesson body',
    pg_temp.as_text(v_pm, $q$select body from public.health_education_content_detail('cr-article')$q$) = 'BODY-cr-article');
  perform pg_temp.ck('M2 a Member gets the audio, check, video and self-care text',
    pg_temp.as_count(v_pm, $q$select count(*) from public.health_education_content_detail('cr-article') where video_url is not null$q$) = 1
    and pg_temp.as_count(v_pm, $q$select count(*) from public.health_education_content_detail('cr-article') where knowledge_check is not null$q$) = 1
    and pg_temp.as_text(v_pm, $q$select self_care_action from public.health_education_item_trust(array['cr-article'])$q$) = 'SELFCARE-cr-article'
    and pg_temp.as_text(v_pm, $q$select audio_clip_id from public.health_education_item_trust(array['cr-article'])$q$) = 'LSN-001');
  perform pg_temp.ck('M3 a Member is not marked members-only and sees the table row',
    pg_temp.as_text(v_pm, $q$select members_only::text from public.health_education_item_trust(array['cr-article'])$q$) = 'false'
    and pg_temp.as_count(v_pm, $q$select count(*) from public.health_education_content where code = 'cr-article'$q$) = 1);
  perform pg_temp.ck('M4 a Member can record progress on it',
    pg_temp.as_try(v_pm, format($q$insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (%L, %L, %L, 'seen')$q$, v_org, v_pm, v_cart)) = 'ok');
  perform pg_temp.ck('M5 the offline pack includes it for a Member',
    pg_temp.as_count(v_pm, $q$select count(*) from public.learning_offline_pack() where code = 'cr-article' and body = 'BODY-cr-article'$q$) = 1);
  perform pg_temp.ck('M6 a Member opens the shared link in full',
    pg_temp.as_text(v_pm, $q$select body from public.learn_shared_article('cr-article')$q$) = 'BODY-cr-article');
  perform pg_temp.ck('M7 a Member''s weekly lesson can be the creator lesson, with its action',
    pg_temp.as_text(v_pm, $q$select code || ':' || lesson_action from public.weekly_micro_lesson()$q$) = 'cr-micro:CREATOR-ACTION');

  -- the non-member
  perform pg_temp.ck('M8 a non-member still sees the title, summary (teaser) and a body that is empty',
    pg_temp.as_text(v_pn, $q$select title || '|' || summary || '|' || coalesce(body, 'NULL') from public.health_education_content_detail('cr-article')$q$)
      = 'Title cr-article|Teaser cr-article|');
  perform pg_temp.ck('M9 a non-member gets no audio, video or check',
    pg_temp.as_count(v_pn, $q$select count(*) from public.health_education_content_detail('cr-article') where audio_url is not null or video_url is not null or knowledge_check is not null$q$) = 0);
  perform pg_temp.ck('M10 the trust record names the creator, says members-only, and withholds self-care text, audio and action',
    pg_temp.as_text(v_pn, $q$select members_only::text || '|' || creator_name || '|' || coalesce(self_care_action, 'NULL') || '|' || coalesce(audio_clip_id, 'NULL') from public.health_education_item_trust(array['cr-article'])$q$)
      = 'true|Dr Creator Name|NULL|NULL');
  perform pg_temp.ck('M11 a direct table read returns no creator row (RLS), but still returns core content',
    pg_temp.as_count(v_pn, $q$select count(*) from public.health_education_content where code = 'cr-article'$q$) = 0
    and pg_temp.as_count(v_pn, $q$select count(*) from public.health_education_content where code = 'free-article'$q$) = 1);
  perform pg_temp.ck('M12 the offline pack leaves it out and pack status says it is not servable',
    pg_temp.as_count(v_pn, $q$select count(*) from public.learning_offline_pack() where code = 'cr-article'$q$) = 0
    and pg_temp.as_count(v_pn, $q$select count(*) from public.learning_pack_status(array['cr-article']) where servable$q$) = 0
    and pg_temp.as_count(v_pn, $q$select count(*) from public.learning_pack_status(array['free-article']) where servable$q$) = 1);
  perform pg_temp.ck('M13a opening a locked lesson (a "seen" write) is skipped quietly and records nothing',
    pg_temp.as_try(v_pn, format($q$insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (%L, %L, %L, 'seen')$q$, v_org, v_pn, v_cart)) = 'ok'
    and (select count(*) from public.health_education_progress where patient_id = v_pn and content_id = v_cart) = 0);
  v_probe := pg_temp.mkitem('cr-probe', format($s$creator_id = %L, body = 'Some text with the unusual word zebrafishx inside'$s$, v_cr));
  perform pg_temp.ck('M13b search matches a locked lesson on title and summary only: a body-only word finds it for a Member, not for a non-member',
    pg_temp.as_count(v_pm, $q$select count(*) from public.search_health_education('zebrafishx') where code = 'cr-probe'$q$) = 1
    and pg_temp.as_count(v_pn, $q$select count(*) from public.search_health_education('zebrafishx') where code = 'cr-probe'$q$) = 0
    and pg_temp.as_count(v_pn, $q$select count(*) from public.search_health_education('Title cr-probe') where code = 'cr-probe'$q$) = 1);
  perform pg_temp.ck('M13 a non-member cannot record progress on it',
    pg_temp.as_try(v_pn, format($q$insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (%L, %L, %L, 'understood')$q$, v_org, v_pn, v_cart)) = '42501');
  perform pg_temp.ck('M14a a non-member is offered a free lesson ahead of a creator lesson, so the weekly card is never stuck on a locked one',
    pg_temp.as_text(v_pn, $q$select code from public.weekly_micro_lesson()$q$) = 'wk-1');
  update public.health_education_content set is_micro_lesson = false where code like 'wk-%';
  perform pg_temp.ck('M14 with only a creator lesson due, a non-member sees title and credit but no body, action, check or audio',
    pg_temp.as_text(v_pn, $q$select code || '|' || members_only::text || '|' || creator_name || '|' || title || '|[' || body || ']|' || coalesce(lesson_action, 'NULL') || '|' || coalesce(check_question::text, 'NULL') || '|' || coalesce(audio_clip_id, 'NULL') from public.weekly_micro_lesson()$q$)
      = 'cr-micro|true|Dr Creator Name|Title cr-micro|[]|NULL|NULL|NULL');
  perform pg_temp.ck('M15 the AI knowledge-base text search never returns creator content, and does return a free item (so it is the creator rule that hides it)',
    pg_temp.as_count(v_pn, $q$select count(*) from public.search_health_education_content_text('BODY-free-article', 50, null) where code = 'free-article'$q$) = 1
    and pg_temp.as_count(v_pn, $q$select count(*) from public.search_health_education_content_text('BODY-cr-article', 50, null) where code = 'cr-article'$q$) = 0
    and pg_temp.as_count(v_pm, $q$select count(*) from public.search_health_education_content_text('BODY-cr-article', 50, null) where code = 'cr-article'$q$) = 0);
  perform pg_temp.ck('M16 a signed-in non-member opening the shared link gets the teaser only',
    pg_temp.as_text(v_pn, $q$select coalesce(body, 'NULL') || '|' || members_only::text || '|' || title || '|' || creator_name from public.learn_shared_article('cr-article')$q$)
      = 'NULL|true|Title cr-article|Dr Creator Name');

  -- the lapsed Member
  perform pg_temp.ck('M17 a Member whose membership has ended is locked out again',
    pg_temp.as_text(v_pe, $q$select body from public.health_education_content_detail('cr-article')$q$) = ''
    and pg_temp.as_count(v_pe, $q$select count(*) from public.learning_offline_pack() where code = 'cr-article'$q$) = 0
    and pg_temp.as_count(v_pe, $q$select count(*) from public.learning_pack_status(array['cr-article']) where servable$q$) = 0);

  -- anon
  perform pg_temp.ck('M18 a signed-out visitor to the share link gets title, credit and teaser, never the body or self-care text',
    pg_temp.as_text(null, $q$select coalesce(body, 'NULL') || '|' || coalesce(self_care_action, 'NULL') || '|' || members_only::text || '|' || title || '|' || summary || '|' || creator_name from public.learn_shared_article('cr-article')$q$)
      = 'NULL|NULL|true|Title cr-article|Teaser cr-article|Dr Creator Name');
  perform pg_temp.ck('M19 anon reads no table rows (the select policy is authenticated only) and cannot call the trust record or the pack',
    pg_temp.as_count(null, 'select count(*) from public.health_education_content') <= 0
    and pg_temp.as_count(null, $q$select count(*) from public.health_education_item_trust(array['cr-article'])$q$) = -1
    and pg_temp.as_count(null, 'select count(*) from public.learning_offline_pack()') = -1);

  -- staff and the creator are not locked out
  perform pg_temp.ck('M20 the creator and an admin read the body',
    pg_temp.as_text(v_cc, $q$select body from public.health_education_content_detail('cr-article')$q$) = 'BODY-cr-article'
    and pg_temp.as_text(v_other, $q$select body from public.health_education_content_detail('cr-article')$q$) = 'BODY-cr-article');

  perform pg_temp.ck('M20b the library and feed readers mask the creator lesson for a non-member and show it to a Member',
    pg_temp.as_text(v_pn, $q$select body from public.health_education_library('getting_started') where code = 'cr-article'$q$) = ''
    and pg_temp.as_text(v_pn, $q$select title from public.health_education_library('getting_started') where code = 'cr-article'$q$) = 'Title cr-article'
    and pg_temp.as_text(v_pm, $q$select body from public.health_education_library('getting_started') where code = 'cr-article'$q$) = 'BODY-cr-article'
    and pg_temp.as_count(v_pn, $q$select count(*) from public.health_education_feed() where code = 'cr-article' and body <> ''$q$) = 0);

  -- core content is free for everyone
  perform pg_temp.ck('M21 non-creator content is unaffected: body, audio clip and shared link open for a non-member and for anon',
    pg_temp.as_text(v_pn, $q$select body from public.health_education_content_detail('free-article')$q$) = 'BODY-free-article'
    and pg_temp.as_text(v_pn, $q$select members_only::text from public.health_education_item_trust(array['free-article'])$q$) = 'false'
    and pg_temp.as_text(v_pn, $q$select audio_clip_id from public.health_education_item_trust(array['free-article'])$q$) = 'LSN-002'
    and pg_temp.as_text(null, $q$select body from public.learn_shared_article('free-article')$q$) = 'BODY-free-article'
    and pg_temp.as_count(v_pn, $q$select count(*) from public.learning_offline_pack() where code = 'free-article'$q$) = 1);

  -- the switch
  perform pg_temp.ck('M22 a patient and a clinician cannot change the switch',
    pg_temp.as_try(v_pn, $q$select public.set_learning_creator_perk(false, 'trying to open it up for all')$q$) = '42501'
    and pg_temp.as_try(v_cc, $q$select public.set_learning_creator_perk(false, 'trying to open it up for all')$q$) = '42501');
  perform pg_temp.ck('M23 a short reason is refused', pg_temp.as_try(v_other, $q$select public.set_learning_creator_perk(false, 'no')$q$) = '22023');
  v_t := pg_temp.as_try(v_other, $q$select public.set_learning_creator_perk(false, 'founder asked to open creator series to everyone')$q$);
  perform pg_temp.ck('M24 an admin switches the perk off: a non-member then reads the body, and an audit row is written',
    v_t = 'ok'
    and pg_temp.as_text(v_pn, $q$select body from public.health_education_content_detail('cr-article')$q$) = 'BODY-cr-article'
    and pg_temp.as_text(null, $q$select body from public.learn_shared_article('cr-article')$q$) = 'BODY-cr-article'
    and exists (select 1 from public.audit_log where action = 'learning_creator_perk.set' and actor_id = v_other and (event ->> 'members_only') = 'false'));
  v_t := pg_temp.as_try(v_other, $q$select public.set_learning_creator_perk(true, 'founder confirmed the perk is members only')$q$);
  perform pg_temp.ck('M25 the admin switches it back on: locked again',
    v_t = 'ok'
    and pg_temp.as_text(v_pn, $q$select body from public.health_education_content_detail('cr-article')$q$) = '');
  update public.learning_config set is_active = false where key = 'creator_perk';
  perform pg_temp.ck('M26 with no switch configured it fails closed (locked), not open',
    pg_temp.as_text(v_pn, $q$select body from public.health_education_content_detail('cr-article')$q$) = '');
  update public.learning_config set is_active = true where key = 'creator_perk';

  -- ================= SABOTAGE =================
  -- (i) the lock function neutered: a non-member then reads the body (the lock is what withholds it)
  create or replace function private.learning_creator_locked_for(p_creator uuid, p_patient uuid) returns boolean language sql stable as $f$ select false $f$;
  perform pg_temp.ck('S1 sabotage: with the lock neutered a non-member reads the creator body, the shared link body and finds a lesson by a body-only word',
    pg_temp.as_text(v_pn, $q$select body from public.health_education_content_detail('cr-article')$q$) = 'BODY-cr-article'
    and pg_temp.as_text(null, $q$select body from public.learn_shared_article('cr-article')$q$) = 'BODY-cr-article'
    and pg_temp.as_count(v_pn, $q$select count(*) from public.search_health_education('zebrafishx') where code = 'cr-probe'$q$) = 1);
  -- (ii) the progress gate dropped: a non-member can then record progress (the trigger is what refuses it)
  drop trigger health_education_progress_members_gate on public.health_education_progress;
  perform pg_temp.ck('S2 sabotage: with the progress gate dropped a non-member records progress',
    pg_temp.as_try(v_pn, format($q$insert into public.health_education_progress (organisation_id, patient_id, content_id, status) values (%L, %L, %L, 'understood')$q$, v_org, v_pn, v_cart)) = 'ok');
  raise notice 'PASS: S55 weekly lesson and members-only creator perk, % checks', (select count(*) from results);
end $$;

select n, check_name, case when ok then 'PASS' else 'FAIL' end as verdict from results order by n;
rollback;

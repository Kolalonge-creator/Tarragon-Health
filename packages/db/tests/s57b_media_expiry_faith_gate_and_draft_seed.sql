-- Proof (S57b): the library's daily expiry job, the faith-leader publish gate, and the seeded DRAFT narration scripts.
--   1. FAITH GATE: a faith_reflection item cannot publish with only the clinical (CMO) reviewer; nor with a faith leader name but no role or date; it
--      publishes with all of them. A control series (stress) publishes without any faith reviewer, so the gate is series-specific, not blanket.
--   2. EXPIRY JOB: pg_cron job media-library-expiry-sweep exists, daily; the sweep moves a published item past its date to review_due and un-lists it,
--      audits it, and leaves an in-date item alone; it is loud on failure (audit row, open incident, returns -1) and the admin wrapper raises; anon is refused.
--   3. DRAFT SEED: 24 narration scripts exist, every one draft, placeholder, not live, no audio, no reviewer, not servable, none faith, ids derived from the
--      code; a patient reads none of them and an admin reads the narration; none can be published as they stand.
--   SABOTAGE: (a) the faith check removed from the gate trigger, a faith item publishes without a leader; (b) the sweep made a no-op, an expired item stays live.
-- Wrapped in BEGIN/ROLLBACK; fails loudly with raise exception.
begin;

create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's57b-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'S57b ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as $f$ begin reset role; end $f$;
-- tries a statement; returns 'ok' or the message
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
begin execute p_sql; return 'ok'; exception when others then return sqlerrm; end $f$;
create function pg_temp.mk(p_code text, p_series text) returns uuid language plpgsql as $f$
declare v uuid;
begin
  insert into public.media_library (code, kind, title, series, audio_url, duration_seconds, bytes, is_placeholder)
  values (p_code, 'meditation', 'S57b ' || p_code, p_series, 'https://example.invalid/' || p_code || '.mp3', 240, 100000, false) returning id into v;
  return v;
end $f$;
create function pg_temp.pub(p_id uuid, p_faith_name text, p_faith_role text, p_faith_date date) returns text language plpgsql as $f$
begin
  update public.media_library set content_status = 'published', is_active = true, reviewed_by_name = 'Dr S57b Reviewer', reviewed_at = current_date,
         next_review_due = current_date + 180, faith_leader_reviewer_name = p_faith_name, faith_leader_reviewer_role = p_faith_role, faith_leader_reviewed_at = p_faith_date
   where id = p_id;
  return 'ok';
exception when others then return sqlerrm;
end $f$;

do $$
declare
  v_org uuid; v_pat uuid; v_admin uuid; v_faith uuid; v_faith2 uuid; v_ctl uuid; v_old uuid; v_new uuid; v_n integer; v_r text; v_def text; v_job record;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_pat := pg_temp.mkuser(v_org, 'pat', 'patient');
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');

  -- 1. faith gate ---------------------------------------------------------------------------------------------------------------
  v_faith := pg_temp.mk('s57b-faith-1', 'faith_reflection');
  v_r := pg_temp.pub(v_faith, null, null, null);
  if v_r not like '%faith leader reviewer%' then raise exception 'FAIL 1a: a faith item published with only the clinical reviewer (%)', v_r; end if;
  v_r := pg_temp.pub(v_faith, 'Pastor Example', null, null);
  if v_r not like '%faith leader reviewer%' then raise exception 'FAIL 1b: a faith item published with a name but no role or date (%)', v_r; end if;
  v_r := pg_temp.pub(v_faith, 'Pastor Example', 'Chaplain', null);
  if v_r not like '%faith leader reviewer%' then raise exception 'FAIL 1c: a faith item published without a faith review date (%)', v_r; end if;
  v_r := pg_temp.pub(v_faith, 'Al', 'Imam', current_date);
  if v_r not like '%faith leader reviewer%' then raise exception 'FAIL 1d: a too-short faith reviewer name was accepted (%)', v_r; end if;
  if exists (select 1 from public.media_library where id = v_faith and content_status = 'published') then raise exception 'FAIL 1e: the faith item became published despite refusals'; end if;
  v_r := pg_temp.pub(v_faith, 'Pastor Example', 'Hospital chaplain', current_date);
  if v_r <> 'ok' then raise exception 'FAIL 1f: a faith item with both reviewers could not publish (%)', v_r; end if;
  v_ctl := pg_temp.mk('s57b-stress-1', 'stress');
  v_r := pg_temp.pub(v_ctl, null, null, null);
  if v_r <> 'ok' then raise exception 'FAIL 1g: the control series needed a faith reviewer (%)', v_r; end if;
  -- the clinical reviewer is still needed on a faith item
  v_faith2 := pg_temp.mk('s57b-faith-2', 'faith_reflection');
  v_r := pg_temp.try(format($q$update public.media_library set content_status = 'published', is_active = true, next_review_due = current_date + 90,
      faith_leader_reviewer_name = 'Pastor Example', faith_leader_reviewer_role = 'Chaplain', faith_leader_reviewed_at = current_date where id = %L$q$, v_faith2));
  if v_r not like '%named reviewer%' then raise exception 'FAIL 1h: a faith item published with a faith leader but no clinical reviewer (%)', v_r; end if;

  -- 2. expiry job ---------------------------------------------------------------------------------------------------------------
  select * into v_job from cron.job where jobname = 'media-library-expiry-sweep';
  if v_job.jobid is null or v_job.schedule <> '25 1 * * *' or not v_job.active then raise exception 'FAIL 2a: the daily expiry job is missing, inactive or on another schedule'; end if;
  v_old := pg_temp.mk('s57b-old-1', 'general'); perform pg_temp.pub(v_old, null, null, null);
  v_new := pg_temp.mk('s57b-new-1', 'general'); perform pg_temp.pub(v_new, null, null, null);
  set local session_replication_role = replica;
  update public.media_library set next_review_due = (now() at time zone 'Africa/Lagos')::date - 1 where id = v_old;
  set local session_replication_role = origin;
  v_n := private.media_library_expiry_sweep();
  if v_n < 1 then raise exception 'FAIL 2b: the sweep flagged nothing (%)', v_n; end if;
  if not exists (select 1 from public.media_library where id = v_old and content_status = 'review_due' and not is_active) then raise exception 'FAIL 2c: the expired item was not moved to review due'; end if;
  if not exists (select 1 from public.media_library where id = v_new and content_status = 'published' and is_active) then raise exception 'FAIL 2d: an in-date item was touched'; end if;
  if not exists (select 1 from public.audit_log where action = 'media_library.expired_flagged' and event -> 'codes' ? 's57b-old-1') then raise exception 'FAIL 2e: the flagging was not audited'; end if;
  if private.media_library_expiry_sweep() <> 0 then raise exception 'FAIL 2f: a second run flagged something again'; end if;
  -- access: anon and a patient cannot run it; the admin can read health
  perform pg_temp.act(v_pat);
  if pg_temp.try('select public.media_library_flag_expired()') not like '%not authorised%' then raise exception 'FAIL 2g: a patient could run the flag'; end if;
  if pg_temp.try('select public.media_library_expiry_sweep_health()') not like '%not authorised%' then raise exception 'FAIL 2h: a patient could read the sweep health'; end if;
  if pg_temp.try('select private.media_library_expiry_sweep()') = 'ok' then raise exception 'FAIL 2i: a patient could run the private sweep'; end if;
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  if (public.media_library_expiry_sweep_health() ->> 'scheduled') <> 'true' then raise exception 'FAIL 2j: the health view does not see the job'; end if;
  perform pg_temp.back();
  -- loud on failure
  create function pg_temp.boom() returns trigger language plpgsql as $f$ begin raise exception 'forced failure'; end $f$;
  v_old := pg_temp.mk('s57b-old-2', 'general'); perform pg_temp.pub(v_old, null, null, null);
  set local session_replication_role = replica;
  update public.media_library set next_review_due = (now() at time zone 'Africa/Lagos')::date - 1 where id = v_old;
  set local session_replication_role = origin;
  create trigger s57b_boom before update on public.media_library for each row when (new.content_status = 'review_due') execute function pg_temp.boom();
  v_n := private.media_library_expiry_sweep();
  drop trigger s57b_boom on public.media_library;
  if v_n <> -1 then raise exception 'FAIL 2k: a failing sweep did not report failure (%)', v_n; end if;
  if not exists (select 1 from public.audit_log where action = 'media_library_expiry.error' and event ->> 'error' like '%forced failure%') then raise exception 'FAIL 2l: the failure was not audited'; end if;
  if not exists (select 1 from public.ops_incidents where external_reference like 'media_library_expiry_failed:%' and status not in ('resolved', 'closed')) then raise exception 'FAIL 2m: the failure opened no incident'; end if;
  if not exists (select 1 from public.media_library where id = v_old and content_status = 'published') then raise exception 'FAIL 2n: a failed sweep half-applied'; end if;
  perform private.media_library_expiry_sweep();   -- recovers once the fault is gone
  if not exists (select 1 from public.media_library where id = v_old and content_status = 'review_due') then raise exception 'FAIL 2o: the sweep did not recover after the fault was removed'; end if;

  -- 3. seeded draft narration scripts -------------------------------------------------------------------------------------------
  select count(*) into v_n from public.media_library where script ->> 'needs_clinical_review' = 'true';
  if v_n <> 24 then raise exception 'FAIL 3a: expected 24 draft scripts, found %', v_n; end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true'
      and (content_status <> 'draft' or is_active or not is_placeholder or reviewed_by_name is not null or reviewed_at is not null or audio_url is not null
           or audio_clip_id is not null or private.media_is_servable(is_active, content_status, is_placeholder, next_review_due) or series = 'faith_reflection'
           or coalesce(btrim(script ->> 'narration'), '') = '')) then
    raise exception 'FAIL 3b: a draft script is approved, live, reviewed, has audio, is servable, is faith content or has no text';
  end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true' and id <> md5('tarragon-media-library:' || code)::uuid) then
    raise exception 'FAIL 3c: a draft script id is not derived from its code';
  end if;
  if (select count(*) from public.media_library where script ->> 'needs_clinical_review' = 'true' and kind = 'meditation') <> 10
     or (select count(*) from public.media_library where script ->> 'needs_clinical_review' = 'true' and kind = 'sleep_story') <> 8
     or (select count(*) from public.media_library where script ->> 'needs_clinical_review' = 'true' and kind = 'breathing') <> 6 then
    raise exception 'FAIL 3d: the kinds are not 10 meditations, 8 sleep, 6 breathing';
  end if;
  if exists (select 1 from public.media_library where script ->> 'needs_clinical_review' = 'true' and script ->> 'narration' ~ '—') then raise exception 'FAIL 3e: an em dash in narration'; end if;
  perform pg_temp.act(v_pat);
  select count(*) into v_n from public.media_library where script ->> 'needs_clinical_review' = 'true';
  perform pg_temp.back();
  if v_n <> 0 then raise exception 'FAIL 3f: a patient can read % draft scripts', v_n; end if;
  perform pg_temp.act(v_admin);
  select count(*) into v_n from public.media_library where script ->> 'needs_clinical_review' = 'true';
  perform pg_temp.back();
  if v_n <> 24 then raise exception 'FAIL 3g: an admin cannot read the scripts for review (%)', v_n; end if;
  -- as they stand none can publish: a placeholder is refused, and with the flag cleared an audio item still has no file
  v_r := pg_temp.try($q$update public.media_library set content_status = 'published', is_active = true, reviewed_by_name = 'Dr Reviewer', reviewed_at = current_date, next_review_due = current_date + 90 where code = 'med-intro-01'$q$);
  if v_r not like '%placeholder cannot be published%' then raise exception 'FAIL 3h: a seeded draft could publish as it stands (%)', v_r; end if;
  v_r := pg_temp.try($q$update public.media_library set is_placeholder = false, content_status = 'published', is_active = true, reviewed_by_name = 'Dr Reviewer', reviewed_at = current_date, next_review_due = current_date + 90 where code = 'med-intro-01'$q$);
  if v_r not like '%needs an audio file%' then raise exception 'FAIL 3i: a script with no audio could publish after the flag was cleared (%)', v_r; end if;
  v_r := pg_temp.try($q$update public.media_library set is_placeholder = false, content_status = 'published', is_active = true, reviewed_by_name = 'Dr Reviewer', reviewed_at = current_date, next_review_due = current_date + 90 where code = 'breath-01'$q$);
  if v_r not like '%at least one step%' then raise exception 'FAIL 3j: a breathing script with no steps or pattern could publish (%)', v_r; end if;

  -- SABOTAGE (a): the faith check removed from the gate; a faith item must now publish without a leader
  v_def := pg_get_functiondef('private.media_library_gate()'::regprocedure);
  if v_def not like '%new.series = ''faith_reflection''%' then raise exception 'sabotage marker missing'; end if;
  execute replace(v_def, 'new.series = ''faith_reflection''', 'false');
  v_faith2 := pg_temp.mk('s57b-faith-3', 'faith_reflection');
  if pg_temp.pub(v_faith2, null, null, null) <> 'ok' then raise exception 'VACUOUS TEST (a): the faith check is not what refused the item'; end if;
  execute v_def;   -- restore

  -- SABOTAGE (b): the sweep made a no-op; an expired item must stay live
  v_def := pg_get_functiondef('private.media_library_expiry_sweep()'::regprocedure);
  v_old := pg_temp.mk('s57b-old-3', 'general'); perform pg_temp.pub(v_old, null, null, null);
  set local session_replication_role = replica;
  update public.media_library set next_review_due = (now() at time zone 'Africa/Lagos')::date - 1 where id = v_old;
  set local session_replication_role = origin;
  execute replace(v_def, 'set content_status = ''review_due''', 'set content_status = content_status');
  perform private.media_library_expiry_sweep();
  if exists (select 1 from public.media_library where id = v_old and content_status = 'review_due') then raise exception 'VACUOUS TEST (b): the sweep flagged although its update was removed'; end if;
  execute v_def;
  perform private.media_library_expiry_sweep();
  if not exists (select 1 from public.media_library where id = v_old and content_status = 'review_due') then raise exception 'FAIL: the restored sweep did not flag the item'; end if;

  raise notice 'PASS: faith gate, daily expiry job (loud on failure), 24 non-servable draft scripts';
end $$;

rollback;

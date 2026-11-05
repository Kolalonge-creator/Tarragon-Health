-- Security audit 2026-11-05, Phase 3 (migration *_security_dashboard_and_staff_access_review.sql). One rolled-back transaction.
--
--   1. Shape: anon runs none of the functions; authenticated may only read the review tables; the reminder is not callable.
--   2. A clinician cannot start a review, read review rows or the security overview.
--   3. An admin starts a review: one row per non-patient account in the organisation, snapshot taken; a second open review is
--      refused; the admin reads their own organisation's review and no other organisation's rows are in it.
--   4. Decisions: "remove" with no note is refused, with a note it is kept; "keep" needs no note. Each writes audit_log.
--   5. Completion is refused while any account is undecided, then succeeds; status is no longer overdue and next due is 90 days on.
--   6. Reminder: an overdue organisation's active non-test admin is told once, not again within the week, and not after a review.
--   7. The overview answers an admin with the staff count it should.
--   8. SABOTAGE: the note rule removed from decide, and the read policy opened to everyone; the matching checks must flip.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(label text primary key, id uuid) on commit drop;
grant all on fx to public;

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
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'sar-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'SAR ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '40 years')::date, p_test, 'en')
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_clin uuid; v_patient uuid; v_live_admin uuid; v_review uuid; v_item uuid; v_status jsonb; v_over jsonb;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_clin := pg_temp.mkuser(v_org, 'clinician', 'clinician');
  v_patient := pg_temp.mkuser(v_org, 'patient', 'patient');
  v_live_admin := pg_temp.mkuser(v_org, 'liveadmin', 'admin', false);
  insert into fx values ('admin', v_admin), ('clinician', v_clin);

  -- 1. Shape
  perform pg_temp.rec('anon runs none of the review or overview functions', '0',
    (select count(*)::text from unnest(array['public.security_overview()', 'public.start_staff_access_review()', 'public.decide_staff_access_review_item(uuid,text,text)',
                                              'public.complete_staff_access_review(uuid)', 'public.staff_access_review_status()']) f
      where has_function_privilege('anon', f::regprocedure, 'EXECUTE')));
  perform pg_temp.rec('authenticated may read but not write the review tables', 'true|false|false|false',
    has_table_privilege('authenticated', 'public.staff_access_review_items', 'SELECT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_access_review_items', 'INSERT')::text || '|' ||
    has_table_privilege('authenticated', 'public.staff_access_review_items', 'UPDATE')::text || '|' ||
    has_function_privilege('authenticated', 'private.staff_access_review_reminder()', 'EXECUTE')::text);

  -- 6a. Reminder while overdue (no completed review in this organisation)
  perform private.staff_access_review_reminder();
  perform pg_temp.rec('an overdue organisation''s non-test admin is told once', '1',
    (select count(*)::text from public.notifications where recipient_id = v_live_admin and template = 'staff_access_review_due'));
  perform pg_temp.rec('a test admin is never told', '0',
    (select count(*)::text from public.notifications where recipient_id = v_admin and template = 'staff_access_review_due'));
  perform private.staff_access_review_reminder();
  perform pg_temp.rec('not told again within the week', '1',
    (select count(*)::text from public.notifications where recipient_id = v_live_admin and template = 'staff_access_review_due'));

  -- 2. A clinician
  perform pg_temp.act(v_clin);
  insert into results values ('real', 'a clinician cannot start a review', '42501', pg_temp.try('select public.start_staff_access_review()'));
  insert into results values ('real', 'a clinician cannot read the security overview', '42501', pg_temp.try('select public.security_overview()'));
  perform pg_temp.back();

  -- 3. An admin starts a review
  perform pg_temp.act(v_admin);
  v_review := public.start_staff_access_review();
  insert into results values ('real', 'a second open review is refused', 'P0001', pg_temp.try('select public.start_staff_access_review()'));
  perform pg_temp.back();
  perform pg_temp.rec('one item per non-patient account in the organisation', 'true',
    ((select count(*) from public.staff_access_review_items where review_id = v_review)
       = (select count(*) from public.profiles where organisation_id = v_org and role <> 'patient'))::text);
  perform pg_temp.rec('the patient is not in the review', '0',
    (select count(*)::text from public.staff_access_review_items where review_id = v_review and profile_id = v_patient));
  perform pg_temp.rec('no other organisation''s account is in the review', '0',
    (select count(*)::text from public.staff_access_review_items where review_id = v_review and organisation_id is distinct from v_org));
  perform pg_temp.act(v_clin);
  insert into results values ('real', 'a clinician reads no review rows', '0', (select count(*)::text from public.staff_access_review_items));
  perform pg_temp.back();
  perform pg_temp.act(v_admin);
  insert into results values ('real', 'the admin reads their own organisation''s review', 'true',
    ((select count(*) from public.staff_access_review_items where review_id = v_review) > 0)::text);
  perform pg_temp.back();

  -- 4. Decisions
  select id into v_item from public.staff_access_review_items where review_id = v_review and profile_id = v_clin;
  insert into fx values ('item', v_item);
  perform pg_temp.act(v_admin);
  insert into results values ('real', '"remove" with no note is refused', 'P0001',
    pg_temp.try(format('select public.decide_staff_access_review_item(%L, ''remove'', null)', v_item)));
  insert into results values ('real', '"remove" with a note is kept', 'ok',
    pg_temp.try(format('select public.decide_staff_access_review_item(%L, ''remove'', ''Left the team in October'')', v_item)));
  -- 5. Completion
  insert into results values ('real', 'completion is refused while an account is undecided', 'P0001',
    pg_temp.try(format('select public.complete_staff_access_review(%L)', v_review)));
  perform pg_temp.back();
  for v_item in select id from public.staff_access_review_items where review_id = v_review and decision is null loop
    perform pg_temp.act(v_admin);
    perform public.decide_staff_access_review_item(v_item, 'keep', null);
    perform pg_temp.back();
  end loop;
  perform pg_temp.act(v_admin);
  insert into results values ('real', 'completion succeeds once every account is decided', 'ok',
    pg_temp.try(format('select public.complete_staff_access_review(%L)', v_review)));
  v_status := public.staff_access_review_status();
  v_over := public.security_overview();
  perform pg_temp.back();
  perform pg_temp.rec('no longer overdue; next due is 90 days on', 'false|90',
    (v_status ->> 'overdue') || '|' || extract(day from ((v_status ->> 'next_due_at')::timestamptz - (v_status ->> 'last_completed_at')::timestamptz))::integer::text);
  perform pg_temp.rec('each step is in the audit log', 'true',
    (exists (select 1 from public.audit_log where action = 'staff_access_review.started' and entity_id = v_review and actor_id = v_admin)
     and exists (select 1 from public.audit_log where action = 'staff_access_review.item_decided' and actor_id = v_admin and event ->> 'decision' = 'remove')
     and exists (select 1 from public.audit_log where action = 'staff_access_review.completed' and entity_id = v_review))::text);
  perform pg_temp.rec('the decision and its note are stored, attributed', 'remove|Left the team in October|true',
    (select decision || '|' || decision_note || '|' || (decided_by = v_admin)::text from public.staff_access_review_items where id = (select id from fx where label = 'item')));

  -- 6b. Reminder after a completed review: age the earlier reminder past the weekly window, so only the completed review can
  -- be what stops a new one
  update public.notifications set created_at = now() - interval '8 days' where template = 'staff_access_review_due';
  perform private.staff_access_review_reminder();
  perform pg_temp.rec('no reminder once a review is completed', '0',
    (select count(*)::text from public.notifications where recipient_id = v_live_admin and template = 'staff_access_review_due' and created_at > now() - interval '1 day'));

  -- 7. Overview
  perform pg_temp.rec('the overview counts this organisation''s non-test staff', 'true',
    ((v_over #>> '{staff,total}')::integer = (select count(*) from public.profiles where organisation_id = v_org and role <> 'patient' and not is_test))::text);
  perform pg_temp.rec('the overview carries every section', 'true',
    (v_over ?& array['failed_sign_ins', 'sign_ins_7d', 'open_security_alerts', 'staff', 'privileged_changes_30d', 'exports_30d', 'staff_access_review'])::text);
end $$;

-- 8. SABOTAGE -------------------------------------------------------------------------------------------------------------------
do $$
declare v_admin uuid; v_clin uuid; v_review uuid; v_item uuid;
begin
  select id into v_admin from fx where label = 'admin';
  select id into v_clin from fx where label = 'clinician';
  -- sabotage 1: the note rule removed (and the table check relaxed so only the function decides)
  alter table public.staff_access_review_items drop constraint staff_access_review_items_note;
  create or replace function public.decide_staff_access_review_item(p_item uuid, p_decision text, p_note text default null) returns void
  language plpgsql security definer set search_path = '' as $f$
  begin
    update public.staff_access_review_items set decision = p_decision, decision_note = p_note, decided_by = auth.uid(), decided_at = now() where id = p_item;
  end $f$;
  perform pg_temp.act(v_admin);
  v_review := public.start_staff_access_review();
  perform pg_temp.back();
  select id into v_item from public.staff_access_review_items where review_id = v_review limit 1;
  perform pg_temp.act(v_admin);
  insert into results values ('sabotaged', '"remove" with no note is refused', 'P0001',
    pg_temp.try(format('select public.decide_staff_access_review_item(%L, ''remove'', null)', v_item)));
  perform pg_temp.back();
  -- sabotage 2: the read policy opened to everyone
  drop policy staff_access_review_items_admin_read on public.staff_access_review_items;
  create policy staff_access_review_items_admin_read on public.staff_access_review_items for select to authenticated using (true);
  perform pg_temp.act(v_clin);
  insert into results values ('sabotaged', 'a clinician reads no review rows', '0', (select count(*)::text from public.staff_access_review_items));
  perform pg_temp.back();
end $$;

do $$
declare v_bad text; v_caught integer;
begin
  select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') into v_bad
    from results where phase = 'real' and expected is distinct from actual;
  if v_bad is not null then raise exception 'security_dashboard_and_staff_access_review FAILED: %', v_bad; end if;
  if (select count(*) from results where phase = 'real') <> 23 then
    raise exception 'security_dashboard_and_staff_access_review: expected 23 checks, got %', (select count(*) from results where phase = 'real');
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

-- The runner fails on a trailing FAIL verdict, so a sabotage row that was caught reads CAUGHT (a missed one already raised above).
select phase, check_name, expected, actual,
       case when phase = 'real' then case when expected = actual then 'PASS' else 'FAIL' end
            else case when expected is distinct from actual then 'CAUGHT' else 'MISSED' end end as result
from results order by phase, check_name;

rollback;

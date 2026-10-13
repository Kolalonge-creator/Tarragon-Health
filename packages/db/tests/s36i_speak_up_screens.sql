-- S36i proof: the speak-up (safety concern) screens over the S20 functions (docs/design/S20.md sections 6 and 7; spec INV-07).
-- Run AFTER the S20 migration; changes no database rule, so it exercises only what the screens call.
--
--   1. Grants: anon cannot execute any function the screens call.
--   2. SCREEN LEVEL, who cannot read a concern: an admin account (operations), a finance account, a care coordinator, an analyst, a patient
--      and anon read zero rows from the concern tables and the readers table, get an empty inbox and "my concerns", and cannot call a
--      lead action (acknowledge, respond, close, incident, name or remove a reader, close a retaliation review, add to a concern).
--   3. The raiser reads only their own concern (a colleague's is invisible), sees only the replies meant for them, and cannot call the inbox.
--   4. The lead sees both concerns with identity, deadlines of 48 hours and 14 days, reads the readers table; the answer shapes carry every
--      key the page's Zod schemas require (a missing key would make the page show a load failure, not an empty list).
--   5. Nothing about a concern reaches a notice, a domain event or an audit_log row.
--   6. SABOTAGE: the reader check opened to everyone; the "admin sees nothing" checks must flip, or the test raises VACUOUS TEST.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- run a statement as a user; returns 'ok' or the error message (the message is the stable queue_* code)
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a scalar query as a user; returns the value as text, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- the same as anon
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  return r;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's20-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'S20 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_emp text, p_comps text[], p_admin uuid, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid; s uuid; c text;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'S20 ' || p_label, 'MDCN', 'S17-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, p_emp::public.staff_employment_type,
      case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      p_emp = 'contracted', case when p_emp = 'contracted' then p_admin else null end, p_test)
  returning id into s;
  foreach c in array p_comps loop
    insert into public.clinician_competencies (organisation_id, clinical_staff_id, competency_code, granted_by, is_test) values (p_org, s, c, p_admin, true);
  end loop;
  return v;
end $f$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try_sql(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;

-- 0. Fixtures ------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  perform pg_temp.setf('org', v_org);
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('fin', pg_temp.mkuser(v_org, 'finance', 'finance'));
  perform pg_temp.setf('coord', pg_temp.mkuser(v_org, 'coord', 'care_coordinator'));
  perform pg_temp.setf('analyst', pg_temp.mkuser(v_org, 'analyst', 'analyst'));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('raiser', pg_temp.mkdoc(v_org, 'raiser', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
  perform pg_temp.setf('other', pg_temp.mkdoc(v_org, 'other', 'senior_medical_officer', 'contracted', '{hypertension,adult_general}', v_admin));
end $$;

do $$
declare
  v_cmo uuid := pg_temp.f('cmo'); v_r uuid := pg_temp.f('raiser'); v_o uuid := pg_temp.f('other');
  v_id uuid; v_id2 uuid; u text; v_fn text; v_keys text;
  v_text text := 'zebrafish quartz handover problem on the night shift for the whole team';
  v_text2 text := 'marmalade lantern conduct problem observed on the ward round today';
begin
  -- 1. grants
  foreach v_fn in array array[
    'public.raise_safety_concern(text, text, text, text, uuid)', 'public.my_safety_concerns()', 'public.safety_concern_inbox(text)', 'public.acknowledge_safety_concern(uuid)',
    'public.respond_to_safety_concern(uuid, text)', 'public.add_to_safety_concern(uuid, text)', 'public.close_safety_concern(uuid, text)', 'public.open_incident_for_concern(uuid, text)',
    'public.add_safety_concern_backup_reader(uuid, text)', 'public.remove_safety_concern_backup_reader(uuid)', 'public.retaliation_review_queue()', 'public.close_retaliation_review(uuid, text, text)'] loop
    perform pg_temp.ck('anon cannot execute ' || v_fn, 'false', has_function_privilege('anon', v_fn, 'EXECUTE')::text);
  end loop;

  v_id := pg_temp.q_as(v_r, format('select public.raise_safety_concern(%L, %L, %L, %L)', 'patient_safety', 'high', v_text, '/clinician/queue'))::uuid;
  v_id2 := pg_temp.q_as(v_o, format('select public.raise_safety_concern(%L, %L, %L)', 'colleague_conduct', 'medium', v_text2))::uuid;
  perform pg_temp.ck('both concerns were raised', '2', (select count(*)::text from public.safety_concerns where id in (v_id, v_id2)));

  -- 2. who cannot read, per account kind
  foreach u in array array['admin', 'fin', 'coord', 'analyst', 'pat'] loop
    perform pg_temp.ck(u || ': zero concern rows', '0', pg_temp.q_as(pg_temp.f(u), 'select count(*) from public.safety_concerns'));
    perform pg_temp.ck(u || ': zero message rows', '0', pg_temp.q_as(pg_temp.f(u), 'select count(*) from public.safety_concern_messages'));
    perform pg_temp.ck(u || ': zero reader rows', '0', pg_temp.q_as(pg_temp.f(u), 'select count(*) from public.safety_concern_readers'));
    perform pg_temp.ck(u || ': zero retaliation rows', '0', pg_temp.q_as(pg_temp.f(u), 'select count(*) from public.retaliation_reviews'));
    perform pg_temp.ck(u || ': empty inbox, no error', '[]', pg_temp.q_as(pg_temp.f(u), 'select public.safety_concern_inbox()'));
    perform pg_temp.ck(u || ': empty my concerns', '[]', pg_temp.q_as(pg_temp.f(u), 'select public.my_safety_concerns()'));
    perform pg_temp.ck(u || ': retaliation queue refused', 'ERR:not available', pg_temp.q_as(pg_temp.f(u), 'select public.retaliation_review_queue()'));
    perform pg_temp.ck(u || ': cannot acknowledge', 'ERR:concern not found', pg_temp.q_as(pg_temp.f(u), format('select public.acknowledge_safety_concern(%L)', v_id)));
    perform pg_temp.ck(u || ': cannot respond', 'ERR:concern not found', pg_temp.q_as(pg_temp.f(u), format('select public.respond_to_safety_concern(%L, %L)', v_id, 'A reply that is long enough to pass.')));
    perform pg_temp.ck(u || ': cannot close', 'ERR:concern not found', pg_temp.q_as(pg_temp.f(u), format('select public.close_safety_concern(%L, %L)', v_id, 'A closing note that is long enough.')));
    perform pg_temp.ck(u || ': cannot open an incident', 'ERR:concern not found', pg_temp.q_as(pg_temp.f(u), format('select public.open_incident_for_concern(%L, %L)', v_id, 'sev3')));
    perform pg_temp.ck(u || ': cannot add to it', 'ERR:concern not found', pg_temp.q_as(pg_temp.f(u), format('select public.add_to_safety_concern(%L, %L)', v_id, 'Some more words here.')));
    perform pg_temp.ck(u || ': cannot name a reader', 'ERR:only the clinical lead can name a backup reader', pg_temp.q_as(pg_temp.f(u), format('select public.add_safety_concern_backup_reader(%L)', pg_temp.f(u))));
    perform pg_temp.ck(u || ': cannot remove a reader', 'ERR:only the clinical lead can remove a backup reader', pg_temp.q_as(pg_temp.f(u), format('select public.remove_safety_concern_backup_reader(%L)', pg_temp.f(u))));
    perform pg_temp.ck(u || ': cannot raise one (clinicians only)', 'ERR:only clinicians can raise a safety concern here', pg_temp.q_as(pg_temp.f(u), format('select public.raise_safety_concern(%L, %L, %L)', 'patient_safety', 'high', v_text)));
  end loop;
  foreach v_fn in array array['select count(*) from public.safety_concerns', 'select count(*) from public.safety_concern_messages', 'select count(*) from public.safety_concern_readers', 'select count(*) from public.retaliation_reviews', 'select public.safety_concern_inbox()', 'select public.my_safety_concerns()', 'select public.retaliation_review_queue()'] loop
    perform pg_temp.ck('anon refused: ' || v_fn, '42501', pg_temp.try_anon(v_fn));
  end loop;

  -- 3. the raiser reads only their own
  perform pg_temp.ck('raiser sees exactly their own concern in the table', '1', pg_temp.q_as(v_r, 'select count(*) from public.safety_concerns'));
  perform pg_temp.ck('...and not the colleague''s', '0', pg_temp.q_as(v_r, format('select count(*) from public.safety_concerns where id = %L', v_id2)));
  perform pg_temp.ck('my concerns lists exactly one', '1', pg_temp.q_as(v_r, 'select jsonb_array_length(public.my_safety_concerns())::text'));
  perform pg_temp.ck('...and it is theirs', v_id::text, pg_temp.q_as(v_r, format('select public.my_safety_concerns() -> 0 ->> %L', 'id')));
  perform pg_temp.ck('the colleague''s words are not in my concerns', 'false', pg_temp.q_as(v_r, format('select (public.my_safety_concerns()::text like %L)::text', '%marmalade%')));
  perform pg_temp.ck('the raiser''s inbox is empty', '[]', pg_temp.q_as(v_r, 'select public.safety_concern_inbox()'));
  perform pg_temp.ck('the raiser cannot acknowledge their own', 'ERR:concern not found', pg_temp.q_as(v_r, format('select public.acknowledge_safety_concern(%L)', v_id)));
  perform pg_temp.ck('the raiser cannot add to the colleague''s', 'ERR:concern not found', pg_temp.q_as(v_r, format('select public.add_to_safety_concern(%L, %L)', v_id2, 'Some more words here.')));
  perform pg_temp.ck('the raiser cannot read the readers table', '0', pg_temp.q_as(v_r, 'select count(*) from public.safety_concern_readers'));
  perform pg_temp.ck('the raiser''s own message list hides internal kinds', 'true',
    pg_temp.q_as(v_r, format('select (not exists (select 1 from public.safety_concern_messages where kind not in (%L, %L, %L, %L)))::text', 'response', 'note', 'acknowledged', 'closed')));
  perform pg_temp.ck('the raiser cannot name a reader', 'ERR:only the clinical lead can name a backup reader', pg_temp.q_as(v_r, format('select public.add_safety_concern_backup_reader(%L)', v_o)));

  -- 4. the lead sees both, with identity and deadlines
  perform pg_temp.ck('lead inbox lists both', '2', pg_temp.q_as(v_cmo, 'select jsonb_array_length(public.safety_concern_inbox())::text'));
  perform pg_temp.ck('the lead sees who raised it', 'true', pg_temp.q_as(v_cmo, format('select (public.safety_concern_inbox()::text like %L)::text', '%S20 raiser%')));
  perform pg_temp.ck('the lead can read the readers table (empty here)', '0', pg_temp.q_as(v_cmo, 'select count(*) from public.safety_concern_readers'));
  perform pg_temp.ck('the lead can open the retaliation queue', '[]', pg_temp.q_as(v_cmo, 'select public.retaliation_review_queue()'));
  perform pg_temp.ck('deadlines are 48 hours and 14 days from the config', 'true',
    (select (acknowledge_due_at between created_at + interval '47 hours' and created_at + interval '49 hours'
         and respond_due_at between created_at + interval '13 days' and created_at + interval '15 days')::text from public.safety_concerns where id = v_id));
  -- the page's Zod schemas need every one of these keys
  v_keys := pg_temp.q_as(v_cmo, 'select string_agg(k, '','' order by k) from jsonb_object_keys(public.safety_concern_inbox() -> 0) k');
  perform pg_temp.ck('inbox row carries every key the page reads', 'acknowledge_due_at,category,created_at,description,escalated_at,id,incident_id,messages,overdue,raised_by,raised_by_name,respond_due_at,screen,severity,state,task_id', v_keys);
  v_keys := pg_temp.q_as(v_r, 'select string_agg(k, '','' order by k) from jsonb_object_keys(public.my_safety_concerns() -> 0) k');
  perform pg_temp.ck('my-concerns row carries every key the page reads', 'acknowledge_due_at,acknowledged_at,category,closed_at,created_at,description,id,messages,respond_due_at,responded_at,severity,state', v_keys);
  -- the lead acts; the raiser then reads the reply
  perform pg_temp.ck('the lead acknowledges', 'ok', pg_temp.try_as(v_cmo, format('select public.acknowledge_safety_concern(%L)', v_id)));
  perform pg_temp.ck('the lead replies', 'ok', pg_temp.try_as(v_cmo, format('select public.respond_to_safety_concern(%L, %L)', v_id, 'Thank you, we are changing the handover sheet this week.')));
  perform pg_temp.ck('the raiser reads the reply', 'true', pg_temp.q_as(v_r, format('select (public.my_safety_concerns()::text like %L)::text', '%changing the handover sheet%')));
  perform pg_temp.ck('the raiser adds to it', 'ok', pg_temp.try_as(v_r, format('select public.add_to_safety_concern(%L, %L)', v_id, 'One more detail from last night.')));

  -- 5. nothing about a concern in a notice, an event or the audit log
  perform pg_temp.ck('no notice carries a concern''s words', '0', (select count(*)::text from public.notifications where payload::text ~* '(zebrafish|quartz|marmalade|lantern|conduct problem)'));
  perform pg_temp.ck('no domain event mentions a concern', '0', (select count(*)::text from public.domain_events where payload::text ~* 'zebrafish|marmalade' or payload::text like '%' || v_id::text || '%' or event_type like 'safety_concern%'));
  perform pg_temp.ck('no audit_log row mentions a concern', '0', (select count(*)::text from public.audit_log where entity_id in (v_id, v_id2) or event::text ~* 'zebrafish|marmalade'));
end $$;

-- 6. SABOTAGE: the reader check opened to everyone ------------------------------------------------------------------
create or replace function private.concern_reader(p_escalated timestamptz, p_org uuid) returns boolean
language sql stable security definer set search_path = '' as $$ select true $$;

do $$
declare v_caught integer;
begin
  insert into results values ('sabotaged', 'an admin account reads no concern rows', '0', pg_temp.q_as(pg_temp.f('admin'), 'select count(*) from public.safety_concerns'));
  insert into results values ('sabotaged', 'an admin account gets an empty inbox', '[]', pg_temp.q_as(pg_temp.f('admin'), 'select public.safety_concern_inbox()'));
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught = 0 then raise exception 'VACUOUS TEST: opening the reader check did not change the admin checks'; end if;
end $$;

select phase, check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- The sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed: the runner treats any FAIL verdict as a failed proof.

rollback;

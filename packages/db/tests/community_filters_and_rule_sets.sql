-- Community proof 1 of 3: the text filter and the rule sets (migrations *_community_scan_and_helpers.sql and *_community_guard_and_seed.sql).
--
-- Proves, in one rolled-back transaction:
--   1. The seeded v1 is a draft with the four contact detectors and NO emergency or self-harm rule (the CMO writes those).
--   2. Phone numbers (national, international, spaced, spelled out, look-alike, Arabic-Indic and full-width digits, zero-width
--      characters), email, links and handles are BLOCKED; selling, cure claims, medicine instructions and spam are HELD; and
--      everyday talk in a blood pressure or diabetes group (reading lists, dates, doses, Tarragon links) PASSES.
--   3. The allow-list takes exact hostnames only (a look-alike host and a user@host trick are both refused).
--   4. A scan returns rule ids and classes, never the matched text.
--   5. Only the CMO writes or removes an emergency/self-harm rule or activates a set that carries them; a set that stops
--      blocking phone, email, link or handle cannot go live by anyone; a bad regular expression is refused when saved; a live
--      set cannot be edited; a retired set cannot be revived; and with no live set a scan is unavailable (fail closed).
--   Sabotage: the phone detector and the link detector are each replaced by "false"; the matching fixtures must flip.
--
--   psql -f packages/db/tests/community_filters_and_rule_sets.sql   (against a database where the community migrations are applied)

begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.msg(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate || ':' || sqlerrm; end $f$;
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
  -- clear the session claims too: a leftover sub makes auth.uid() non-null and the is_test guard then treats the owner as a person
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.role', '', true);
end $f$;
create function pg_temp.act_service() returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  set local role service_role;
end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'com-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, language)
  values (v, p_org, p_role::public.user_role, 'COM ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true, 'en')
  on conflict (id) do update set role = excluded.role, is_test = true, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth, full_name = excluded.full_name;
  if not p_test then update public.profiles set is_test = false where id = v; end if;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_admin uuid, p_label text, p_tier text) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'clinician'); v_staff uuid;
begin
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, license_expires_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test, languages, specialty)
  values (p_org, v, 'COM ' || p_label, 'MDCN', 'COM-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now() - interval '5 days', now() + interval '1 year', p_admin,
      p_tier::public.doctor_tier, case when p_tier = 'chief_medical_officer' then 'contracted' else 'employed' end::public.staff_employment_type, 2,
      true, p_admin, true, array['en'], 'General practice')
  returning id into v_staff;
  return v;
end $f$;

do $$
declare
  v_org uuid; v_admin uuid; v_cmo uuid;
  v_j jsonb; r record; v_dec text; v_n integer; v_emerg_rule bigint; v_url_rule bigint; v_t0 timestamptz; v_ms numeric;
begin
  select id into v_org from public.organisations order by id limit 1;
  if v_org is null then insert into public.organisations (name) values ('community proof org') returning id into v_org; end if;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  v_cmo := pg_temp.mkdoc(v_org, v_admin, 'cmo', 'chief_medical_officer');
  -- a known start: no live rule set, whatever the database holds today
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';

  -- 1. The seeded v1 is a draft with no emergency or self-harm rules, and an admin may activate it -------------------------
  perform pg_temp.rec('seed: v1 is a draft', 'draft', (select status from public.community_filter_rule_sets where version = 1));
  perform pg_temp.rec('seed: v1 has no emergency or self-harm rule (the CMO writes those)', '0',
    (select count(*)::text from public.community_filter_rules where rule_set_version = 1 and class in ('self_harm', 'emergency')));
  perform pg_temp.rec('seed: v1 blocks phone, email, link and handle', '4',
    (select count(distinct pattern)::text from public.community_filter_rules where rule_set_version = 1 and kind = 'detector' and action = 'block'));
  perform pg_temp.act(v_admin);
  v_j := public.community_admin_rule_set_activate(1);
  perform pg_temp.back();
  perform pg_temp.rec('an admin can activate a set that has no safety rules', 'active', (select status from public.community_filter_rule_sets where version = 1));

  -- 2. Fixtures: what must be blocked, held, or allowed ---------------------------------------------------------------------
  create temp table fx(kind text, txt text, expected text) on commit drop;
  insert into fx values
    -- phone and account numbers, in the ways people try
    ('phone', 'call me on 08031234567', 'block'), ('phone', '0803 123 4567', 'block'), ('phone', '0803-123-4567', 'block'),
    ('phone', '+234 803 123 4567', 'block'), ('phone', '+2348031234567', 'block'), ('phone', 'o8o3 1234567', 'block'),
    ('phone', 'zero eight zero three one two three four five six seven', 'block'), ('phone', '0 8 0 3 1 2 3 4 5 6 7', 'block'),
    ('phone', '08 03 12 34 56 7', 'block'), ('phone', 'my account 0123456789 gtbank', 'block'), ('phone', '1234 5678 90', 'block'),
    ('phone', '08031234567x', 'block'), ('phone', 'tel08031234567', 'block'),
    ('phone', translate('0803123456789', '0123456789', chr(1632) || chr(1633) || chr(1634) || chr(1635) || chr(1636) || chr(1637) || chr(1638) || chr(1639) || chr(1640) || chr(1641)), 'block'),
    ('phone', translate('08031234567', '0123456789', chr(65296) || chr(65297) || chr(65298) || chr(65299) || chr(65300) || chr(65301) || chr(65302) || chr(65303) || chr(65304) || chr(65305)), 'block'),
    ('phone', '0803' || chr(8203) || '1234567', 'block'),
    -- email
    ('email', 'john.doe@gmail.com', 'block'), ('email', 'mail me at john dot doe at gmail dot com', 'block'),
    ('email', 'john (at) gmail (dot) com', 'block'), ('email', 'john[at]gmail[dot]com', 'block'),
    -- links and handles, and the exact-host allow-list
    ('url', 'visit www.healthcure.com now', 'block'), ('url', 'https://bit.ly/abc', 'block'), ('url', 'buyherbs.ng/shop', 'block'),
    ('url', 'tarragonhealth.ng.evil.com', 'block'), ('url', 'https://tarragonhealth.ng@evil.com/x', 'block'),
    ('url', 'https://evil.com/tarragonhealth.ng', 'block'), ('url', 'find me on gmail dot com', 'block'),
    ('handle', 'dm @nurse_ada for it', 'block'), ('intent', 'dm me', 'block'), ('intent', 'inbox me privately', 'block'),
    ('intent', 'call me on the number I sent', 'block'),
    -- selling, claims, instructions: held for a person
    ('hold', 'follow me on instagram', 'hold'), ('hold', 'whatsapp me', 'hold'), ('hold', 'I sell detox tea', 'hold'),
    ('hold', 'this herbal tea reverses diabetes', 'hold'), ('hold', 'stop taking your metformin', 'hold'),
    ('hold', 'dont take your tablets', 'hold'), ('hold', 'double your dose', 'hold'),
    ('hold', 'don' || chr(8217) || 't take your insulin', 'hold'), ('hold', 'aaaaaaaaaaaaaaaa', 'hold'),
    -- everyday talk in a blood pressure or diabetes group must pass
    ('ok', 'my bp today was 140/90 and yesterday 150/95', 'allow'), ('ok', 'readings 110 125 130 140 this week', 'allow'),
    ('ok', '70 80 90 100 110 pulse log', 'allow'), ('ok', 'appointment on 09-10-2026 at 14:30', 'allow'),
    ('ok', 'started 500 mg twice daily', 'allow'), ('ok', 'I walked 10000 steps', 'allow'), ('ok', 'weight 95 kg, height 175 cm', 'allow'),
    ('ok', 'hello there, how are you? one day at a time', 'allow'), ('ok', 'see https://tarragonhealth.ng/learn/bp for tips', 'allow'),
    ('ok', 'read https://app.tarragonhealth.ng/patient', 'allow'), ('ok', 'Dr. Ade said e.g. cut salt, i.e. less than 5 g', 'allow'),
    ('ok', 'HbA1c 7.2 and fasting 6.1', 'allow'), ('ok', 'sugar 5.6 mmol and bp 120/80, 118/76, 122/79', 'allow'),
    ('ok', 'my mum is 62 and I am 35', 'allow'), ('ok', 'ok then.Be well', 'allow'),
    ('ok', 'I take 1 tablet at 8 and 1 at 20 every day', 'allow'), ('ok', '2026 10 09 was my last review', 'allow'),
    ('ok', 'I never skip my tablets', 'allow'), ('ok', 'my doctor told me to continue my insulin', 'allow'),
    ('ok', 'I stopped adding salt and it helped', 'allow'), ('ok', 'reduce salt in your food', 'allow'),
    ('ok', 'Thanks everyone, this group is kind', 'allow'),
    -- review fix: lists of health numbers and prices are not phone numbers
    ('ok', 'hba1c 6.5 6.8 7.1 7.4 7.0 6.9', 'allow'), ('ok', 'fasting 5.6 6.1 7.2 5.9 6.3', 'allow'),
    ('ok', 'steps this week 10000 12000 9000', 'allow'), ('ok', 'cost was 15000 20000 naira', 'allow'),
    ('ok', '2000 2500 3000', 'allow'),
    -- review fix: bracket and parenthesis link tricks, and a plus number
    ('url', 'go to evil[.]com', 'block'), ('url', 'evil (dot) com', 'block'), ('url', 'evil{.}com', 'block'),
    ('phone', '+44 7700 900123', 'block'), ('phone', '1234567890123', 'block');
  for r in select * from fx order by kind, txt loop
    perform pg_temp.rec(r.kind || ': ' || left(r.txt, 60), r.expected, private.community_scan(r.txt) ->> 'decision');
  end loop;

  -- The guard's conditions: the community branch exists, an older branch survived the in-place patch, and an unknown key fails closed.
  -- If a later migration replaces private.go_live_conditions() from an old copy, THIS check fails in CI.
  perform pg_temp.rec('go_live_conditions has a community branch', 'moderation_team_named', (private.go_live_conditions('community', null) -> 0 ->> 'code'));
  perform pg_temp.rec('...with nine conditions', '9', (jsonb_array_length(private.go_live_conditions('community', null)))::text);
  perform pg_temp.rec('...none of them met on a fresh database', '0', (select count(*)::text from jsonb_array_elements(private.go_live_conditions('community', null)) c where (c ->> 'met')::boolean and c ->> 'source' <> 'switch'));
  perform pg_temp.rec('an older guard''s conditions survived', 'stage2_exit_criteria_met', (private.go_live_conditions('public_signup_enabled', null) -> 0 ->> 'code'));
  perform pg_temp.rec('an unknown key still fails closed', 'unknown_guard', (private.go_live_conditions('no_such_guard', null) -> 0 ->> 'code'));
  perform pg_temp.rec('the guard is born off', 'false', (select is_on::text from public.go_live_guards where key = 'community'));
  perform pg_temp.rec('the guard is switched by the CMO', 'cmo', (select switch_role from public.go_live_guards where key = 'community'));

  -- Speed: a post of the maximum length must be checked in milliseconds, whatever it contains. A backreference rule once cost 4.5 SECONDS on
  -- 2000 characters (every post would have held the member's row lock that long), so this is a standing check on the seeded rules.
  for r in select * from (values ('dots', repeat('a.', 1000)), ('digits', repeat('1 ', 1000)), ('plain', repeat('hello there friends ', 100)),
                                   ('separators', repeat('1-.(_)* ', 250)), ('letters', repeat('a', 2000)), ('words', repeat('zero one two ', 150))) as x(k, txt) loop
    v_t0 := clock_timestamp();
    perform private.community_scan(r.txt);
    v_ms := extract(epoch from clock_timestamp() - v_t0) * 1000;
    perform pg_temp.rec('a 2000 character ' || r.k || ' post is scanned in under 800 ms', 'true', (v_ms < 800)::text);
  end loop;

  -- A decision never carries the text it matched
  perform pg_temp.rec('a scan returns rule ids and classes, never the matched text', 'false',
    (private.community_scan('call me on 08031234567')::text like '%08031234567%')::text);

  -- 3. Rule sets: who may write and activate what -------------------------------------------------------------------------
  perform pg_temp.act(v_admin);
  v_j := public.community_admin_rule_set_create(1);                                   -- draft v2
  perform pg_temp.back();
  perform pg_temp.rec('a new draft copies the live set', '2', (v_j ->> 'version'));
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot write an emergency rule', '42501',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'emergency', 'regex', 'test emergency phrase', 'safety', null)$q$));
  perform pg_temp.rec('an admin cannot write a self-harm rule', '42501',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'self_harm', 'regex', 'test crisis phrase', 'safety', null)$q$));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('the CMO can write an emergency rule', 'ok',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'emergency', 'regex', '\ytest emergency phrase\y', 'safety', 'proof only')$q$));
  perform pg_temp.rec('the CMO can write a self-harm rule', 'ok',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'self_harm', 'regex', '\ytest crisis phrase\y', 'safety', 'proof only')$q$));
  perform pg_temp.rec('a regular expression that cannot compile is refused when saved', '2201B',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'spam', 'regex', '(unclosed', 'hold', null)$q$));
  perform pg_temp.rec('a rule with a backreference is refused on a draft (they are very slow in this regex engine)', '22023',
    pg_temp.try($q$select public.community_admin_rule_save(2, 'spam', 'regex', '(.)\1{9,}', 'hold', null)$q$));
  perform pg_temp.back();
  select id into v_emerg_rule from public.community_filter_rules where rule_set_version = 2 and class = 'emergency';
  perform pg_temp.rec('the emergency rule exists to be deleted (the check below is not vacuous)', 'true', (v_emerg_rule is not null)::text);
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin cannot activate a set that carries safety rules', '42501', pg_temp.try('select public.community_admin_rule_set_activate(2)'));
  perform pg_temp.rec('an admin cannot delete a safety rule', '42501', pg_temp.try(format('select public.community_admin_rule_delete(%s)', v_emerg_rule)));
  perform pg_temp.back();
  perform pg_temp.rec('the safety rule is still there after the refused delete', 'true', exists (select 1 from public.community_filter_rules where id = v_emerg_rule)::text);

  -- The floor: a set that drops a contact detector cannot go live, whoever signs it
  perform pg_temp.act(v_admin);
  v_j := public.community_admin_rule_set_create(1);                                   -- draft v3
  perform pg_temp.back();
  select id into v_url_rule from public.community_filter_rules where rule_set_version = 3 and pattern = 'url';
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('an admin can delete a non-safety rule from a draft', 'ok', pg_temp.try(format('select public.community_admin_rule_delete(%s)', v_url_rule)));
  perform pg_temp.rec('a set that no longer blocks links cannot be activated (admin)', '42501', pg_temp.try('select public.community_admin_rule_set_activate(3)'));
  perform pg_temp.back();
  perform pg_temp.act(v_cmo);
  perform pg_temp.rec('a set that no longer blocks links cannot be activated (CMO either)', '42501', pg_temp.try('select public.community_admin_rule_set_activate(3)'));
  perform pg_temp.back();
  perform pg_temp.rec('after the refused activation, v1 is still the live set', 'active', (select status from public.community_filter_rule_sets where version = 1));

  -- The allow-list accepts exact hostnames only
  perform pg_temp.act(v_admin);
  perform pg_temp.rec('a hostname with a path is not a hostname', 'refused',
    (public.community_admin_rule_set_params(3, '["tarragonhealth.ng/learn"]'::jsonb) ->> 'status'));
  perform pg_temp.rec('a wildcard is not a hostname', 'refused', (public.community_admin_rule_set_params(3, '["*.tarragonhealth.ng"]'::jsonb) ->> 'status'));
  perform pg_temp.rec('a plain hostname is accepted on a draft', 'ok', (public.community_admin_rule_set_params(3, '["tarragonhealth.ng"]'::jsonb) ->> 'status'));
  perform pg_temp.back();

  -- The CMO activates the set with safety rules; v1 retires; the new rules act
  perform pg_temp.act(v_cmo);
  v_j := public.community_admin_rule_set_activate(2);
  perform pg_temp.back();
  perform pg_temp.rec('the CMO activates a set with safety rules', 'active', (select status from public.community_filter_rule_sets where version = 2));
  perform pg_temp.rec('the previous set is retired', 'retired', (select status from public.community_filter_rule_sets where version = 1));
  perform pg_temp.rec('only one set is ever live', '1', (select count(*)::text from public.community_filter_rule_sets where status = 'active'));
  perform pg_temp.rec('the approver is recorded', v_cmo::text, (select approved_by::text from public.community_filter_rule_sets where version = 2));
  perform pg_temp.rec('emergency language is decided as safety', 'safety', private.community_scan('I have a test emergency phrase') ->> 'decision');
  perform pg_temp.rec('self-harm language is decided as safety', 'safety', private.community_scan('this is a test crisis phrase') ->> 'decision');
  perform pg_temp.rec('safety outranks a contact block', 'safety', private.community_scan('test crisis phrase call 08031234567') ->> 'decision');
  perform pg_temp.rec('contact blocking still works under the new set', 'block', private.community_scan('call me on 08031234567') ->> 'decision');
  perform pg_temp.rec('a live set cannot be edited (parameters)', '42501', pg_temp.try('update public.community_filter_rule_sets set params = ''{}''::jsonb where version = 2'));
  perform pg_temp.rec('a live set cannot gain a rule', '42501',
    pg_temp.try($q$insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action) values (2, 'spam', 'regex', 'x', 'hold')$q$));
  perform pg_temp.rec('a retired set cannot be revived', '42501', pg_temp.try('update public.community_filter_rule_sets set status = ''active'' where version = 1'));
  perform pg_temp.rec('a rule set cannot be deleted', '42501', pg_temp.try('delete from public.community_filter_rule_sets where version = 1'));


  -- 4. SABOTAGE: break each detector and prove the matching checks flip --------------------------------------------------------
  create or replace function private.community_detect_phone(p_norm text) returns boolean language sql immutable as 'select false';
  select count(*) into v_n from fx where kind = 'phone' and private.community_scan(txt) ->> 'decision' = expected;
  insert into results values ('sabotaged', 'phone fixtures all blocked', (select count(*)::text from fx where kind = 'phone'), v_n::text);
  create or replace function private.community_detect_url(p_norm text, p_allowed jsonb) returns boolean language sql immutable as 'select false';
  select count(*) into v_n from fx where kind = 'url' and private.community_scan(txt) ->> 'decision' = expected;
  insert into results values ('sabotaged', 'link fixtures all blocked', (select count(*)::text from fx where kind = 'url'), v_n::text);
  -- (the real, unbroken functions are the migration's; the two replacements above live only inside this rolled-back transaction)
  -- Fail closed: with no live set the scan is unavailable and the callers refuse to post
  update public.community_filter_rule_sets set status = 'retired' where status = 'active';
  insert into results values ('real', 'with no live rule set a scan is unavailable (fail closed)', 'unavailable', private.community_scan('hello') ->> 'decision');
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'community filter proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ')
         from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected is distinct from actual;
  if v_caught < 2 then raise exception 'VACUOUS TEST: only % of 2 sabotage steps changed the matching check', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;
-- Sabotaged rows are asserted to differ inside the DO block above and are deliberately not printed.

rollback;

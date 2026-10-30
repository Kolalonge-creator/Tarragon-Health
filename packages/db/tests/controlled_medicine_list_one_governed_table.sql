-- OQ-484 proof: ONE governed controlled-medicine list (migration *_controlled_medicine_list_one_governed_table.sql). Bug class: two sources of truth for a safety list.
--
--   1. The seed is the list that was live (60 terms for the 58 patterns), and the table-reading private.is_controlled_medicine agrees with the old regex literal
--      on a battery of names: every term in written forms, brands with doses, near misses and look-alike words, empty and null.
--   2. A CHANGE WITH NO CODE CHANGE: the Chief Medical Officer adds a term and (a) the database hard stop (prescription_safety_findings, the signing refusal,
--      prescription_has_controlled_item) now catches it, (b) get_controlled_medicine_list, which is what the web guard reads, now carries it with its tier and
--      label and a higher version; retiring it undoes both; a phrase with a space matches as a phrase.
--   3. Guards: only the CMO writes (admin, prescriber, patient refused, anon cannot execute); the tables are closed to the API; nothing is deleted or renamed;
--      every change needs a NEW note of at least 10 characters; a no-op, a regex-looking term and a bad tier are refused; every change lands in the history
--      with its actor and note, and in audit_log.
--   3b. The list can never be emptied (the last active term cannot be retired), the history cannot be edited, deleted or truncated even by the owner,
--      the terms table cannot be truncated, a repeated note is refused with a clear message, and a direct edit with no signed-in actor is not recorded
--      under the previous actor.
--   4. SABOTAGE: (A) the function put back to a fixed regex that ignores the table, (B) the CMO check removed, (C) the history trigger disabled,
--      (D) the new-note guard disabled, (E) the last-term guard removed. Every one must flip a check, or the proof is vacuous.
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.sub', '', true); perform set_config('request.jwt.claim.role', '', true); end $f$;
-- one statement as a user: its single text result, or 'ERR:' || message
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- one statement as a user: 'ok' or the SQLSTATE
create function pg_temp.st_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.st_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('request.jwt.claim.role', 'anon', true);
  set local role anon;
  begin execute p_sql; r := 'ok'; exception when others then r := sqlstate; end;
  reset role;
  perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true);
  return r;
end $f$;
create function pg_temp.st_owner(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text) returns uuid language plpgsql as
$f$ declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'oq484-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test)
  values (v, p_org, p_role::public.user_role, 'OQ484 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '45 years')::date, true)
  on conflict (id) do update set role = excluded.role, organisation_id = excluded.organisation_id, is_test = true, is_active = true, phone = excluded.phone;
  return v;
end $f$;
create function pg_temp.mkdoc(p_org uuid, p_label text, p_tier text, p_admin uuid) returns uuid language plpgsql as
$f$ declare v uuid;
begin
  v := pg_temp.mkuser(p_org, p_label, 'clinician');
  insert into public.clinical_staff (organisation_id, profile_id, full_name, credential_type, credential_number, active, status,
      license_verified_at, verified_by, doctor_tier, employment_type, credentialing_level, indemnity_exempt, indemnity_exempt_by, is_test)
  values (p_org, v, 'OQ484 ' || p_label, 'MDCN', 'OQ484-' || p_label || '-' || substr(v::text, 1, 8), true, 'active', now(), p_admin,
      p_tier::public.doctor_tier, 'contracted', case when p_tier in ('senior_medical_officer', 'chief_medical_officer') then 2 else 1 end,
      true, p_admin, true);
  return v;
end $f$;

-- the regex literal that was live in private.is_controlled_medicine before this migration (the old second copy), for the equivalence battery only
create function pg_temp.legacy(p_name text) returns boolean language sql as
$$ select lower(btrim(coalesce(p_name, ''))) ~* '\m(morphine|pethidine|meperidine|fentanyl|oxycodone|hydrocodone|methadone|diamorphine|codeine|tramadol|dihydrocodeine|diazepam|lorazepam|alprazolam|midazolam|clonazepam|chlordiazepoxide|methylphenidate|amphetamine|dexamfetamine|dextroamphetamine|lisdexamfetamine|phenobarbital|phenobarbitone|ketamine|bromazepam|tramal|ultram|ultracet|tramacet|zydol|valium|diazemuls|ativan|xanax|rivotril|klonopin|lexotan|dormicum|librium|ritalin|concerta|adderall|dexedrine|vyvanse|luminal|ketalar|oxycontin|oxynorm|percocet|duragesic|sublimaze|demerol|phensedyl|solpadeine|panadeine|co-?codamol|co-?dydramol)\M' $$;
create function pg_temp.list_version() returns integer language sql as $$ select (public.get_controlled_medicine_list() ->> 'version')::integer $$;
create function pg_temp.in_list(p_term text) returns boolean language sql as
$$ select exists (select 1 from jsonb_array_elements(public.get_controlled_medicine_list() -> 'terms') e where e ->> 'term' = p_term) $$;
create function pg_temp.finds(p_patient uuid, p_drug text) returns boolean language sql as
$$ select private.prescription_safety_findings(p_patient, p_drug, null) @> '[{"code":"controlled_medicine","blocking":true}]'::jsonb $$;
create function pg_temp.hist_n() returns integer language sql as $$ select count(*)::integer from public.controlled_medicine_term_history $$;
create function pg_temp.set_term(p_uid uuid, p_term text, p_tier text, p_label text, p_active boolean, p_note text) returns text language sql as
$$ select pg_temp.q_as(p_uid, format($q$select public.set_controlled_medicine_term(%L, %L, %L, %L, %L)::text$q$, p_term, p_tier, p_label, p_active, p_note)) $$;

-- 0. Fixtures ------------------------------------------------------------------------------------------------------------------
do $$
declare v_org uuid; v_admin uuid;
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_admin := pg_temp.mkuser(v_org, 'admin', 'admin');
  perform pg_temp.setf('admin', v_admin);
  perform pg_temp.setf('cmo', pg_temp.mkdoc(v_org, 'cmo', 'chief_medical_officer', v_admin));
  perform pg_temp.setf('smo', pg_temp.mkdoc(v_org, 'smo', 'senior_medical_officer', v_admin));
  perform pg_temp.setf('pat', pg_temp.mkuser(v_org, 'pat', 'patient'));
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id) values (v_org, pg_temp.f('pat'), pg_temp.f('smo'));
  insert into public.patient_allergies (organisation_id, patient_id, allergen, source, recorded_by) values (v_org, pg_temp.f('pat'), 'proof-none', 'clinician', pg_temp.f('smo'));
end $$;

-- 1. Seed and equivalence with the old regex ------------------------------------------------------------------------------------
do $$
declare r record; names text[]; n text; v_bad text := ''; v_checked integer := 0;
begin
  perform pg_temp.ck('the seed is 60 active terms', '60', (select count(*)::text from public.controlled_medicine_terms where active));
  perform pg_temp.ck('...with 60 history rows, versions 1 to 60', '60|1|60',
    (select count(*)::text || '|' || min(version)::text || '|' || max(version)::text from public.controlled_medicine_term_history where action = 'added'));
  perform pg_temp.ck('...24 narcotic-tier terms', '24', (select count(*)::text from public.controlled_medicine_terms where tier = 'narcotic'));
  for r in select term from public.controlled_medicine_terms loop
    names := array[r.term, upper(r.term) || ' 5mg', 'Brand ' || r.term || ' tablets', '  ' || r.term || ' syrup ', r.term || 'x', 'x' || r.term];
    foreach n in array names loop
      v_checked := v_checked + 1;
      if private.is_controlled_medicine(n) is distinct from pg_temp.legacy(n) then v_bad := v_bad || n || '; '; end if;
    end loop;
  end loop;
  foreach n in array array['Encodeinate', 'Valiumx', 'Concertina', 'Ultrasound gel', 'Panadol Extra', 'Paracetamol 500mg', 'Ventolin', 'Tramadolxyz', 'Amlodipine 5mg', 'Metformin',
                           '', '   ', 'codeine phosphate', 'Co-codamol 30/500', 'cocodamol', 'Co-Dydramol', 'codydramol', 'co codamol', 'co--codamol', 'Phenobarbitone 30mg', 'OxyContin 10mg',
                           'Tramal 50mg', 'Xanax XR', 'Ritalin LA', 'morphine sulfate', 'dihydrocodeine', 'amphetamine salts', 'ketamine'] loop
    v_checked := v_checked + 1;
    if private.is_controlled_medicine(n) is distinct from pg_temp.legacy(n) then v_bad := v_bad || '"' || n || '"; '; end if;
  end loop;
  if private.is_controlled_medicine(null) is distinct from pg_temp.legacy(null) then v_bad := v_bad || 'null; '; end if;
  perform pg_temp.ck('the table-reading check agrees with the old regex on every name in the battery', 'none', coalesce(nullif(v_bad, ''), 'none'));
  perform pg_temp.ck('the battery was not empty', 'true', (v_checked > 380)::text);
  perform pg_temp.ck('a signed item holding a controlled name is still seen', 'true|false',
    private.prescription_has_controlled_item('x', '[{"drug_name":"Tramal"}]'::jsonb)::text || '|' || private.prescription_has_controlled_item('x', '[{"drug_name":"Metformin"}]'::jsonb)::text);
end $$;

-- 2. A change with no code change ----------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_smo uuid := pg_temp.f('smo'); v_pat uuid := pg_temp.f('pat'); v0 integer; v1 integer; r text;
begin
  v0 := pg_temp.list_version();
  perform pg_temp.ck('control: before, the term is not controlled', 'false|false|false', pg_temp.finds(v_pat, 'Proofium 5mg')::text || '|' || private.is_controlled_medicine('Proofium')::text || '|' || pg_temp.in_list('proofium')::text);
  perform pg_temp.ck('control: before, a prescriber can sign it', 'true',
    (pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'Proofium', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat)) !~ '^ERR')::text);
  -- the medicine above was a control; stop it so the duplicate check does not blur the next signing attempt
  perform pg_temp.st_as(v_pat, format($q$update public.medications set is_active = false, stopped_at = now(), stopped_reason = 'proof' where patient_id = %L and drug_name = 'Proofium'$q$, v_pat));

  r := pg_temp.set_term(v_cmo, 'Proofium', 'restricted', 'Proof class', true, 'Added by the proof to show a data change');
  perform pg_temp.ck('the CMO adds a term', 'true', (r !~ '^ERR')::text);
  perform pg_temp.ck('the database hard stop now catches it (findings, check, items)', 'true|true|true',
    pg_temp.finds(v_pat, 'Proofium 5mg')::text || '|' || private.is_controlled_medicine('proofium 5 mg')::text ||
    '|' || private.prescription_has_controlled_item('x', '[{"drug_name":"Proofium"}]'::jsonb)::text);
  perform pg_temp.ck('...and signing it is refused', 'true',
    (pg_temp.q_as(v_smo, format($q$select public.prescribe_medication(%L, 'Proofium', '5 mg', 'daily', null, null, null, 'oral', 30, '30 tablets', 0, null, null, true)::text$q$, v_pat)) ~ '^ERR')::text);
  perform pg_temp.ck('...the list the web reads carries it with its tier and label', 'restricted|Proof class',
    (select (e ->> 'tier') || '|' || (e ->> 'label') from jsonb_array_elements(public.get_controlled_medicine_list() -> 'terms') e where e ->> 'term' = 'proofium'));
  v1 := pg_temp.list_version();
  perform pg_temp.ck('...at a higher version', 'true', (v1 > v0)::text);
  perform pg_temp.ck('...which is readable by a signed-in patient', 'true', (pg_temp.q_as(v_pat, $q$select (public.get_controlled_medicine_list() ->> 'version')::text$q$) !~ '^ERR')::text);

  r := pg_temp.set_term(v_cmo, 'proofium', 'narcotic', 'Proof class', true, 'Tier raised by the proof');
  perform pg_temp.ck('a change of tier is a new version and shows in the list', 'true|narcotic',
    (pg_temp.list_version() > v1)::text || '|' || (select e ->> 'tier' from jsonb_array_elements(public.get_controlled_medicine_list() -> 'terms') e where e ->> 'term' = 'proofium'));

  r := pg_temp.set_term(v_cmo, 'proofium', 'narcotic', 'Proof class', false, 'Retired again by the proof');
  perform pg_temp.ck('retiring it takes it off the hard stop and the web list', 'false|false|false', pg_temp.finds(v_pat, 'Proofium 5mg')::text || '|' || private.is_controlled_medicine('Proofium')::text || '|' || pg_temp.in_list('proofium')::text);
  r := pg_temp.set_term(v_cmo, 'proofium', 'narcotic', 'Proof class', true, 'Reinstated by the proof');
  perform pg_temp.ck('reinstating it brings it back', 'true|true', private.is_controlled_medicine('Proofium')::text || '|' || pg_temp.in_list('proofium')::text);
  perform pg_temp.ck('the history says added, changed, retired, reinstated, by the CMO, with a note each', 'added,changed,retired,reinstated|' || v_cmo::text || '|4',
    (select string_agg(action, ',' order by version) || '|' || min(changed_by::text) || '|' || count(distinct change_note)::text from public.controlled_medicine_term_history where term = 'proofium'));
  perform pg_temp.ck('...and audit_log has the four changes', '4', (select count(*)::text from public.audit_log where action = 'controlled_medicine_list.changed' and actor_id = v_cmo));

  -- a phrase with a space matches as a phrase
  r := pg_temp.set_term(v_cmo, '  Proof   Phrase ', 'restricted', 'Proof class', true, 'A two-word term added by the proof');
  perform pg_temp.ck('a two-word term is stored tidy and matches as a phrase, not as run-together words', 'proof phrase|true|false',
    (select term from public.controlled_medicine_terms where id = r::uuid) || '|' || private.is_controlled_medicine('Proof Phrase 5mg')::text || '|' || private.is_controlled_medicine('proofphrase')::text);
end $$;

-- 3. Guards --------------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_pat uuid := pg_temp.f('pat'); who text;
begin
  foreach who in array array['admin', 'smo', 'pat'] loop
    perform pg_temp.ck('only the CMO can change the list (' || who || ' refused)', 'true',
      (pg_temp.set_term(pg_temp.f(who), 'guardword', 'restricted', 'Guard', true, 'Should not be allowed to happen') like 'ERR:only the Chief Medical Officer%')::text);
  end loop;
  perform pg_temp.ck('...and nothing was added', '0', (select count(*)::text from public.controlled_medicine_terms where term = 'guardword'));
  perform pg_temp.ck('anon cannot execute the write', '42501', pg_temp.st_anon($q$select public.set_controlled_medicine_term('anonword', 'restricted', 'x', true, 'ten characters at least')$q$));
  perform pg_temp.ck('anon cannot read the list', '42501', pg_temp.st_anon($q$select public.get_controlled_medicine_list()$q$));
  perform pg_temp.ck('a signed-in user cannot read the table directly', '42501', pg_temp.st_as(v_pat, $q$select * from public.controlled_medicine_terms$q$));
  perform pg_temp.ck('...nor write it', '42501', pg_temp.st_as(v_cmo, $q$insert into public.controlled_medicine_terms (term, tier, label, change_note) values ('sneak', 'restricted', 'x', 'direct write attempt')$q$));
  perform pg_temp.ck('...nor read the history', '42501', pg_temp.st_as(v_cmo, $q$select * from public.controlled_medicine_term_history$q$));
  perform pg_temp.ck('...and the check function itself is not callable by a user', '42501', pg_temp.st_as(v_pat, $q$select private.is_controlled_medicine('tramadol')$q$));
  perform pg_temp.ck('a term is never deleted', '42501', pg_temp.st_owner($q$delete from public.controlled_medicine_terms where term = 'morphine'$q$));
  perform pg_temp.ck('...nor renamed', '42501', pg_temp.st_owner($q$update public.controlled_medicine_terms set term = 'morphine2', change_note = 'rename attempt by owner' where term = 'morphine'$q$));
  perform pg_temp.ck('...and an update with the same note is refused', '23514', pg_temp.st_owner($q$update public.controlled_medicine_terms set label = 'Changed' where term = 'morphine'$q$));
  perform pg_temp.ck('a note under 10 characters is refused', 'ERR:a change note of at least 10 characters is required', pg_temp.set_term(v_cmo, 'noteword', 'restricted', 'x', true, 'short'));
  perform pg_temp.ck('a no-op change is refused', 'ERR:nothing to change: the term is already like that', pg_temp.set_term(v_cmo, 'morphine', 'narcotic', 'Opioid analgesic', true, 'Nothing actually changes here'));
  foreach who in array array['a|b', 'x.*', 'x(y)', 'x\y', 'x;drop', ''] loop
    perform pg_temp.ck('a term that could be a regex is refused: "' || who || '"', 'ERR:a controlled-medicine term is letters, digits, spaces and hyphens only', pg_temp.set_term(v_cmo, who, 'restricted', 'x', true, 'Should be refused as a term'));
  end loop;
  perform pg_temp.ck('a bad tier is refused', 'ERR:the tier is narcotic or restricted', pg_temp.set_term(v_cmo, 'tierword', 'schedule2', 'x', true, 'Should be refused as a tier'));
  perform pg_temp.ck('a missing label is refused', 'ERR:a controlled-medicine term needs a label', pg_temp.set_term(v_cmo, 'labelword', 'restricted', '  ', true, 'Should be refused as a label'));
  perform pg_temp.ck('every seeded term is still controlled', 'true', (select bool_and(private.is_controlled_medicine(term)) from public.controlled_medicine_terms where change_note like 'Seeded%')::text);
end $$;

-- 3b. Never emptied, history immutable, notes ------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); r text; t record; v_before integer; v_actor text;
begin
  perform pg_temp.ck('a repeated note is refused with a clear message', 'ERR:write a new change note: it is the same as the last note on this term',
    pg_temp.set_term(v_cmo, 'proofium', 'narcotic', 'Proof class', false, 'Reinstated by the proof'));
  perform pg_temp.ck('the history cannot be edited by anyone, the owner included', '42501', pg_temp.st_owner($q$update public.controlled_medicine_term_history set change_note = 'rewritten history' where version = 1$q$));
  perform pg_temp.ck('...nor deleted', '42501', pg_temp.st_owner($q$delete from public.controlled_medicine_term_history where version = 1$q$));
  perform pg_temp.ck('...nor truncated', '42501', pg_temp.st_owner($q$truncate public.controlled_medicine_term_history$q$));
  perform pg_temp.ck('the terms table cannot be truncated either', '42501', pg_temp.st_owner($q$truncate public.controlled_medicine_terms$q$));
  -- a direct edit with no signed-in user is recorded with no actor, not under the CMO who last touched the row
  update public.controlled_medicine_terms set label = 'Opioid analgesic ', change_note = 'Direct edit by the owner in the proof' where term = 'morphine';
  v_actor := (select coalesce(changed_by::text, 'none') from public.controlled_medicine_term_history where term = 'morphine' order by version desc limit 1);
  perform pg_temp.ck('a direct edit with no signed-in user is recorded with no actor', 'none', v_actor);
  update public.controlled_medicine_terms set label = 'Opioid analgesic', change_note = 'Direct edit undone by the owner in the proof' where term = 'morphine';

  -- the list cannot be emptied: retire every term but one through the CMO function; the last one is refused
  v_before := (select count(*) from public.controlled_medicine_terms where active);
  for t in select term, tier, label from public.controlled_medicine_terms where active and term <> 'ketalar' order by term loop
    r := pg_temp.set_term(v_cmo, t.term, t.tier, t.label, false, 'Retired in the proof to test the floor');
    if r like 'ERR:%' then raise exception 'retiring % failed: %', t.term, r; end if;
  end loop;
  perform pg_temp.ck('all but one term can be retired', '1', (select count(*)::text from public.controlled_medicine_terms where active));
  perform pg_temp.ck('...the last active term cannot be retired', 'ERR:the list must keep at least one active term',
    pg_temp.set_term(v_cmo, 'ketalar', 'restricted', 'Dissociative anaesthetic', false, 'Trying to empty the list in the proof'));
  perform pg_temp.ck('...so the hard stop still catches it', 'true|false', private.is_controlled_medicine('Ketalar 50mg')::text || '|' || private.is_controlled_medicine('Morphine')::text);
  -- put the list back (reinstate every term the loop retired) so the sabotage section starts from the seeded list
  for t in select term, tier, label from public.controlled_medicine_terms where not active and change_note = 'Retired in the proof to test the floor' loop
    r := pg_temp.set_term(v_cmo, t.term, t.tier, t.label, true, 'Reinstated after the floor test');
  end loop;
  perform pg_temp.ck('...and the list is whole again afterwards', v_before::text, (select count(*)::text from public.controlled_medicine_terms where active));
end $$;

-- 4. SABOTAGE ------------------------------------------------------------------------------------------------------------------
do $$
declare v_cmo uuid := pg_temp.f('cmo'); v_pat uuid := pg_temp.f('pat');
  v_orig text; v_def text; r text; h0 integer; h1 integer;
begin
  -- A. the function ignores the table (a fixed regex again): a term the CMO adds changes nothing
  v_orig := pg_get_functiondef('private.is_controlled_medicine(text)'::regprocedure);
  execute $d$create or replace function private.is_controlled_medicine(p_name text) returns boolean language sql immutable security definer set search_path = ''
             as $b$ select lower(btrim(coalesce(p_name, ''))) ~* '\m(morphine|tramadol)\M' $b$ $d$;
  perform pg_temp.set_term(v_cmo, 'sabone', 'restricted', 'Sab', true, 'Added during sabotage A');
  insert into results values ('sabotaged', 'A: a term the CMO adds changes the hard stop', 'true', pg_temp.finds(v_pat, 'Sabone')::text);
  execute v_orig;

  -- B. the CMO check removed: a patient can change the list
  v_orig := pg_get_functiondef('public.set_controlled_medicine_term(text,text,text,boolean,text)'::regprocedure);
  v_def := replace(v_orig, 'if v_uid is null or not private.credential_is_cmo() then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE B not applied'; end if;
  execute v_def;
  r := pg_temp.set_term(v_pat, 'sabtwo', 'restricted', 'Sab', true, 'Added by a patient during sabotage B');
  insert into results values ('sabotaged', 'B: a patient cannot change the list', 'refused', case when r like 'ERR:only the Chief Medical Officer%' then 'refused' else 'accepted' end);
  execute v_orig;

  -- C. the history trigger disabled: a change leaves no history
  alter table public.controlled_medicine_terms disable trigger controlled_medicine_terms_b_history;
  h0 := pg_temp.hist_n();
  perform pg_temp.set_term(v_cmo, 'sabthree', 'restricted', 'Sab', true, 'Added during sabotage C');
  h1 := pg_temp.hist_n();
  insert into results values ('sabotaged', 'C: a change adds a history row', '1', (h1 - h0)::text);
  alter table public.controlled_medicine_terms enable trigger controlled_medicine_terms_b_history;

  -- D. the new-note guard disabled: an update with the old note goes through
  alter table public.controlled_medicine_terms disable trigger controlled_medicine_terms_a_guard;
  insert into results values ('sabotaged', 'D: an update with the same note is refused', '23514',
    pg_temp.st_owner($q$update public.controlled_medicine_terms set label = 'Changed' where term = 'morphine'$q$));
  alter table public.controlled_medicine_terms enable trigger controlled_medicine_terms_a_guard;

  -- E. the last-term guard removed: the list can be emptied
  v_orig := pg_get_functiondef('public.set_controlled_medicine_term(text,text,text,boolean,text)'::regprocedure);
  v_def := replace(v_orig, 'if v_row.active and not p_active and not exists (select 1 from public.controlled_medicine_terms where active and id <> v_row.id) then', 'if false then');
  if v_def = v_orig then raise exception 'SABOTAGE E not applied'; end if;
  execute v_def;
  update public.controlled_medicine_terms set active = false, change_note = 'Sabotage E: all but one retired' where term <> 'ketalar' and active;
  r := pg_temp.set_term(v_cmo, 'ketalar', 'restricted', 'Dissociative anaesthetic', false, 'Sabotage E: retire the last term');
  insert into results values ('sabotaged', 'E: the last active term cannot be retired', 'refused', case when r like 'ERR:the list must keep%' then 'refused' else 'accepted' end);
  execute v_orig;
end $$;

do $$
declare v_bad integer; v_flipped integer; v_total integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'OQ-484 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(distinct left(check_name, 1)) into v_flipped from results where phase = 'sabotaged' and expected is distinct from actual;
  select count(distinct left(check_name, 1)) into v_total from results where phase = 'sabotaged';
  if v_total < 5 or v_flipped < 5 then
    raise exception 'VACUOUS TEST: the sabotage flipped % of % checks (%)', v_flipped, v_total,
      (select string_agg(check_name || ' => ' || coalesce(actual, 'null'), '; ') from results where phase = 'sabotaged');
  end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result
from results where phase = 'real' order by check_name;

rollback;

-- ===========================================================================
-- Proof: 20261028061244_gap71_sponsor_methods_and_funding_disclosure.sql (GAP-71, D5-lite; invariant I9; S75a single minimum-cell rule).
--
--   1. OFF BY DEFAULT: the guard `sponsor_methods_disclosure_enabled` is seeded off; with it off the pack carries `methods_and_funding` as withheld
--      (reason not_switched_on) while every other pack key is still there, and the sponsor-facing function says the same. No review is seeded.
--   2. THE BLOCK (guard on): the sponsor organisation's name and that Tarragon produced the figures; the cascade and outcome-measure definition
--      versions with their sign status (proposed, not signed -> signed after the CMO acts); the minimum-cell rule uses the SAME floor as the pack's
--      group figures; exclusions are said to be in force only when a SIGNED definition lists them; the review is "not independently reviewed" until
--      a record exists. It names no person and no count of any person.
--   3. THE REVIEW RECORD: only a platform admin or the CMO records or withdraws one (clinician, patient, sponsor staff, anon refused); a future date and
--      a causal sentence are refused; a record is never edited or deleted; a withdrawn one stops showing; it shows in the pack and to the sponsor.
--   4. SPONSOR ROLE: the sponsor's staff read the disclosure for their own programme only (another sponsor's and a missing programme get the same
--      refusal); a patient and a clinician are refused; the sponsor role is refused every individual record (members' profiles and readings) and the
--      review table directly.
--   5. PACK: still passes the causal-wording check with a review present; contains no member id.
--   6. SCANS: new functions have an explicit search_path; anon cannot execute any; the private block is not executable by authenticated.
--   7. SABOTAGE: the append-only trigger dropped (an edit must then succeed); the ownership check removed from sponsor_methods_disclosure (another
--      sponsor's staff must then read it). Both checks must flip.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. UNRUN at authoring time (no Docker): first execution is the CI migration replay.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.sk(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;
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
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlstate; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
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
create function pg_temp.try(p_sql text) returns text language plpgsql as
$f$ begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $f$;
create function pg_temp.today() returns date language sql as $$ select (now() at time zone 'Africa/Lagos')::date $$;

create function pg_temp.mkuser(p_label text, p_role text) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid(); v_org uuid := (select id from public.organisations order by created_at limit 1);
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 'gap71-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, sex)
  values (v, v_org, p_role::public.user_role, 'GAP71 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'), (current_date - interval '50 years')::date, 'female')
  on conflict (id) do update set role = excluded.role, is_active = true, phone = excluded.phone, full_name = excluded.full_name;
  return v;
end $f$;

-- the whole block as the admin sees it through the pack
create function pg_temp.pack() returns jsonb language plpgsql as
$f$ declare r jsonb;
begin
  perform pg_temp.act(pg_temp.f('admin'));
  r := public.sponsor_pilot_pack(pg_temp.f('cohort'));
  perform pg_temp.back();
  return r;
end $f$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 0. Fixtures
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare
  v_org uuid := (select id from public.organisations order by created_at limit 1);
  v_sp uuid; v_sp2 uuid; v_cmo uuid; v_ver uuid; v_coh uuid; p uuid; i integer;
begin
  perform pg_temp.setf('admin', pg_temp.mkuser('admin', 'admin'));
  perform pg_temp.setf('clin', pg_temp.mkuser('clin', 'clinician'));
  perform pg_temp.setf('patient', pg_temp.mkuser('patient', 'patient'));
  v_cmo := pg_temp.mkuser('cmo', 'clinician'); perform pg_temp.setf('cmo', v_cmo);
  set local session_replication_role = replica;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, is_test, active, status, doctor_tier, languages, license_verified_at, license_expires_at, specialty, indemnity_exempt, indemnity_exempt_by)
  values (v_org, v_cmo, 'GAP71 CMO', true, true, 'active', 'chief_medical_officer', array['en'], now() - interval '3 days', now() + interval '1 year', 'General practice', true, pg_temp.f('admin'));
  set local session_replication_role = origin;

  insert into public.organisations (name, type) values ('GAP71 Sponsor Corp', 'corporate') returning id into v_sp;
  insert into public.organisations (name, type) values ('GAP71 Other Sponsor', 'ngo') returning id into v_sp2;
  perform pg_temp.setf('st', pg_temp.mkuser('sponsor-staff', 'corporate_admin'));
  update public.profiles set organisation_id = v_sp where id = pg_temp.f('st');
  perform pg_temp.setf('st2', pg_temp.mkuser('other-staff', 'ngo_admin'));
  update public.profiles set organisation_id = v_sp2 where id = pg_temp.f('st2');

  update public.consent_versions set is_current = true where consent_type = 'sponsor_reporting' and version = '2026-10-07-draft';
  select id into v_ver from public.consent_versions where consent_type = 'sponsor_reporting' and is_current limit 1;
  insert into public.sponsor_cohorts (organisation_id, sponsor_org_id, name, code, valid_from, valid_to, max_uses)
    values (v_org, v_sp, 'GAP71 programme', 'GAPQ7AA2', current_date - 400, current_date + 30, 100) returning id into v_coh;
  perform pg_temp.setf('cohort', v_coh);
  -- three members who agreed to share (so a real member id exists to look for)
  for i in 1 .. 3 loop
    p := pg_temp.mkuser('member' || i, 'patient'); perform pg_temp.setf('m' || i, p);
    insert into public.patient_memberships (organisation_id, patient_id, source, starts_at) values (v_org, p, 'purchase', now() - interval '100 days');
    insert into public.vitals_readings (organisation_id, patient_id, vital_type, systolic, diastolic, taken_at, source) values (v_org, p, 'blood_pressure', 150, 95, now() - interval '3 days', 'device');
    insert into public.profile_cohorts (organisation_id, patient_id, cohort_id, reporting_consent, consented_at, consent_version_id) values (v_org, p, v_coh, true, now(), v_ver);
    insert into public.patient_consents (organisation_id, patient_id, consent_type, consent_version_id, version, action) values (v_org, p, 'sponsor_reporting', v_ver, '2026-10-07-draft', 'accepted');
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Off by default; nothing seeded
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; v_pack jsonb;
begin
  perform pg_temp.ck('1a the guard is seeded off', 'false', (select is_on::text from public.go_live_guards where key = 'sponsor_methods_disclosure_enabled'));
  perform pg_temp.ck('1b the guard is the CMO''s to switch', 'cmo', (select switch_role from public.go_live_guards where key = 'sponsor_methods_disclosure_enabled'));
  perform pg_temp.ck('1c no independent review is seeded', '0', (select count(*)::text from public.sponsor_independent_reviews));
  r := pg_temp.pack();
  perform pg_temp.ck('1d guard off: the pack still issues', 'true', r ->> 'ok');
  perform pg_temp.ck('1e guard off: the block is withheld', 'true/not_switched_on', (r #>> '{pack,methods_and_funding,withheld}') || '/' || (r #>> '{pack,methods_and_funding,reason}'));
  perform pg_temp.ck('1f guard off: every other pack section is still present', '5', (select count(*)::text from jsonb_object_keys(r -> 'pack') k where k in ('cover', 'group_figures', 'clinical_measures', 'cascade_of_care', 'selection_panel')));
  perform pg_temp.ck('1g guard off: the sponsor-facing function says the same', 'true/not_switched_on',
    coalesce(pg_temp.q_as(pg_temp.f('st'), format($q$ select (public.sponsor_methods_disclosure(%L) #>> '{methods,withheld}') || '/' || (public.sponsor_methods_disclosure(%L) #>> '{methods,reason}') $q$, pg_temp.f('cohort'), pg_temp.f('cohort'))), 'null'));
end $$;

-- switch the guard on, inside this rolled-back transaction only (a guard cannot be changed directly, so the guard trigger is paused for the update)
alter table public.go_live_guards disable trigger go_live_guards_guard;
update public.go_live_guards set is_on = true, changed_at = now(), changed_by = pg_temp.f('cmo'), change_note = 'GAP71 proof' where key = 'sponsor_methods_disclosure_enabled';
alter table public.go_live_guards enable trigger go_live_guards_guard;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. The block
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb; b jsonb; v_mv integer; v_keys text; v_txt text;
begin
  r := pg_temp.pack(); b := r #> '{pack,methods_and_funding}';
  perform pg_temp.ck('2a guard on: the block is shown', 'false', b ->> 'withheld');
  perform pg_temp.ck('2b it names the sponsor and says Tarragon produced the figures', 'GAP71 Sponsor Corp/Tarragon Health', (b #>> '{funding,sponsor}') || '/' || (b #>> '{funding,produced_by}'));
  perform pg_temp.ck('2c the funding sentence carries the sponsor name', 'true', (b #>> '{funding,text}' like 'GAP71 Sponsor Corp sponsors this programme%')::text);
  -- unsigned: both definitions are PROPOSED, not signed
  perform pg_temp.ck('2d the cascade definition (v1) is proposed, not signed', '1/proposed_not_signed', (b #>> '{definitions,cascade_of_care,version}') || '/' || (b #>> '{definitions,cascade_of_care,status}'));
  select max(version) into v_mv from public.outcome_config where config ? 'measures';
  perform pg_temp.ck('2e the outcome measure definition is the newest listing the measures, proposed, not signed', v_mv::text || '/proposed_not_signed', (b #>> '{definitions,outcome_measures,version}') || '/' || (b #>> '{definitions,outcome_measures,status}'));
  perform pg_temp.ck('2f the status text for an unsigned version is plain', 'Proposed, not signed', b #>> '{definitions,cascade_of_care,status_text}');
  perform pg_temp.ck('2g exclusions are NOT said to be in force while the definition is unsigned', 'false', b #>> '{exclusions,applied_by_the_definition_in_use}');
  -- the minimum: the SAME floor as the group figures in the same pack
  perform pg_temp.ck('2h the minimum-cell rule uses the pack''s own floor', r #>> '{pack,group_figures,minimum_cell}', b #>> '{minimum_cell,minimum}');
  perform pg_temp.ck('2i ... and says it in words', 'true', ((b #>> '{minimum_cell,text}') like 'A group smaller than ' || (b #>> '{minimum_cell,minimum}') || ' people is never shown%')::text);
  -- review: absent
  perform pg_temp.ck('2j no review record: not independently reviewed', 'not_independently_reviewed/These figures have not been independently reviewed.', (b #>> '{review,status}') || '/' || (b #>> '{review,text}'));

  -- the CMO signs the cascade definitions; activating the newest measure definitions stands for the CMO's outcome sign-off
  perform pg_temp.ck('2k the CMO signs the cascade definitions', '', coalesce(pg_temp.q_as(pg_temp.f('cmo'), $q$ select public.sign_outcome_cascade_config(1)::text $q$), 'null'));
  set local session_replication_role = replica;
  update public.outcome_config set is_active = false where is_active;
  update public.outcome_config set is_active = true where version = v_mv;
  set local session_replication_role = origin;
  b := (pg_temp.pack()) #> '{pack,methods_and_funding}';
  perform pg_temp.ck('2l the cascade definition now reads signed, on the Lagos date', 'signed/Signed on ' || pg_temp.today()::text, (b #>> '{definitions,cascade_of_care,status}') || '/' || (b #>> '{definitions,cascade_of_care,status_text}'));
  perform pg_temp.ck('2m the outcome measure definition now reads signed', v_mv::text || '/signed', (b #>> '{definitions,outcome_measures,version}') || '/' || (b #>> '{definitions,outcome_measures,status}'));
  perform pg_temp.ck('2n exclusions are in force once a signed definition lists them', (v_mv >= 4)::text, b #>> '{exclusions,applied_by_the_definition_in_use}');

  -- nothing about a person: no key names a person, a score, mental health or reproductive health
  select string_agg(k, ',') into v_keys from (
    select jsonb_object_keys(b) k
    union all select jsonb_object_keys(b -> 'funding') union all select jsonb_object_keys(b -> 'definitions')
    union all select jsonb_object_keys(b -> 'definitions' -> 'outcome_measures') union all select jsonb_object_keys(b -> 'definitions' -> 'cascade_of_care')
    union all select jsonb_object_keys(b -> 'minimum_cell') union all select jsonb_object_keys(b -> 'exclusions') union all select jsonb_object_keys(b -> 'review')) x;
  perform pg_temp.ck('2o no key names a person, a score or a protected topic', '0', (select count(*)::text from unnest(string_to_array(v_keys, ',')) k where k ~* '(patient|member|person|email|phone|score|phq|gad|mental|reproduct|pregnan|menstru|fertil)'));
  v_txt := private.json_text(b);
  perform pg_temp.ck('2p no member id is in the block', '0', (select count(*)::text from fx where k ~ '^m[123]$' and position(v::text in v_txt) > 0));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. The review record
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_id uuid; r jsonb; v_args text;
begin
  v_args := format('%L, %L, %L, %L, %L', pg_temp.f('cohort'), 'Dr Test Reviewer', 'Test Evaluation Ltd', (pg_temp.today() - 1)::text, 'Definitions, minimum cell and exclusions of the pilot pack');
  perform pg_temp.ck('3a a clinician cannot record a review', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), 'select public.record_sponsor_independent_review(' || v_args || ')::text'));
  perform pg_temp.ck('3b a patient cannot', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), 'select public.record_sponsor_independent_review(' || v_args || ')::text'));
  perform pg_temp.ck('3c the sponsor''s own staff cannot', 'ERR:42501', pg_temp.q_as(pg_temp.f('st'), 'select public.record_sponsor_independent_review(' || v_args || ')::text'));
  perform pg_temp.ck('3d anon cannot', '42501', pg_temp.try_anon('select public.record_sponsor_independent_review(' || v_args || ')'));
  perform pg_temp.ck('3e nothing was written by the refusals', '0', (select count(*)::text from public.sponsor_independent_reviews));
  perform pg_temp.ck('3f a future date is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format('select public.record_sponsor_independent_review(%L, %L, %L, %L, %L)::text', pg_temp.f('cohort'), 'Dr Test Reviewer', 'Test Evaluation Ltd', (pg_temp.today() + 1)::text, 'Definitions and suppression of the pack')));
  perform pg_temp.ck('3g a causal sentence is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format('select public.record_sponsor_independent_review(%L, %L, %L, %L, %L)::text', pg_temp.f('cohort'), 'Dr Test Reviewer', 'Test Evaluation Ltd', (pg_temp.today() - 1)::text, 'The programme caused the fall in blood pressure')));
  perform pg_temp.ck('3h an unknown programme is refused', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format('select public.record_sponsor_independent_review(%L, %L, %L, %L, %L)::text', gen_random_uuid(), 'Dr Test Reviewer', 'Test Evaluation Ltd', (pg_temp.today() - 1)::text, 'Definitions and suppression of the pack')));

  v_id := pg_temp.q_as(pg_temp.f('admin'), 'select public.record_sponsor_independent_review(' || v_args || ')::text')::uuid;
  perform pg_temp.setf('review', v_id);
  perform pg_temp.ck('3i the admin records a review', '1', (select count(*)::text from public.sponsor_independent_reviews where id = v_id and recorded_by = pg_temp.f('admin')));
  r := pg_temp.pack();
  perform pg_temp.ck('3j it shows in the pack, by name, organisation and scope', 'independently_reviewed/Dr Test Reviewer/Test Evaluation Ltd',
    (r #>> '{pack,methods_and_funding,review,status}') || '/' || (r #>> '{pack,methods_and_funding,review,reviewer}') || '/' || (r #>> '{pack,methods_and_funding,review,organisation}'));
  perform pg_temp.ck('3k ... in one sentence that names the scope', 'true', ((r #>> '{pack,methods_and_funding,review,text}') like 'Independently reviewed by Dr Test Reviewer (Test Evaluation Ltd) on % Scope of the review: Definitions, minimum cell and exclusions of the pilot pack.')::text);
  perform pg_temp.ck('3l the pack with a review present passes the causal-wording check', 'true', r ->> 'ok');
  perform pg_temp.ck('3m the sponsor''s own staff see it', 'independently_reviewed', coalesce(pg_temp.q_as(pg_temp.f('st'), format($q$ select public.sponsor_methods_disclosure(%L) #>> '{methods,review,status}' $q$, pg_temp.f('cohort'))), 'null'));
  -- the CMO can record too
  perform pg_temp.ck('3n the CMO can record a review', '1', (select count(*)::text from (select pg_temp.q_as(pg_temp.f('cmo'), 'select public.record_sponsor_independent_review(' || replace(v_args, 'Dr Test Reviewer', 'Dr Second Reviewer') || ')::text')) x where x.q_as not like 'ERR:%'));
  perform pg_temp.ck('3o the newest review by date is the one shown', 'true', ((pg_temp.pack()) #>> '{pack,methods_and_funding,review,reviewer}' in ('Dr Test Reviewer', 'Dr Second Reviewer'))::text);

  -- append-only (the owner included)
  perform pg_temp.ck('3p an edit is refused', '23514', pg_temp.try(format('update public.sponsor_independent_reviews set scope = %L where id = %L', 'An edited scope that is long enough', v_id)));
  perform pg_temp.ck('3q a delete is refused', '23514', pg_temp.try(format('delete from public.sponsor_independent_reviews where id = %L', v_id)));
  -- withdrawing
  perform pg_temp.ck('3r the sponsor''s staff cannot withdraw', 'ERR:42501', pg_temp.q_as(pg_temp.f('st'), format($q$ select public.withdraw_sponsor_independent_review(%L, 'trying to remove it')::text $q$, v_id)));
  perform pg_temp.ck('3s a withdrawal needs a reason', 'ERR:22023', pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.withdraw_sponsor_independent_review(%L, 'no')::text $q$, v_id)));
  perform pg_temp.ck('3t the admin withdraws it', '1', (select count(*)::text from (select pg_temp.q_as(pg_temp.f('admin'), format($q$ select public.withdraw_sponsor_independent_review(%L, 'entered against the wrong programme')::text $q$, v_id)) as q) x where x.q not like 'ERR:%'));
  perform pg_temp.ck('3u a withdrawn review stays withdrawn', '23514', pg_temp.try(format('update public.sponsor_independent_reviews set retraction_note = %L where id = %L', 'changed my mind about the note', v_id)));
  -- withdraw the second one too, so the pack returns to "not independently reviewed"
  update public.sponsor_independent_reviews set retracted_at = now(), retracted_by = pg_temp.f('admin'), retraction_note = 'proof clean-up' where retracted_at is null;
  perform pg_temp.ck('3v with every review withdrawn the pack says not independently reviewed again', 'not_independently_reviewed', (pg_temp.pack()) #>> '{pack,methods_and_funding,review,status}');
  -- the table is closed to direct reads except admin / CMO
  insert into public.sponsor_independent_reviews (cohort_id, reviewer_name, reviewer_organisation, reviewed_on, scope, recorded_by)
    values (pg_temp.f('cohort'), 'Dr Visible', 'Visible Ltd', pg_temp.today() - 2, 'Scope for the visibility check', pg_temp.f('admin'));
  perform pg_temp.ck('3w the admin can read the table directly', '1', pg_temp.q_as(pg_temp.f('admin'), 'select count(*)::text from public.sponsor_independent_reviews where reviewer_name = ''Dr Visible'''));
  perform pg_temp.ck('3x the sponsor''s staff read nothing from it directly', '0', coalesce(pg_temp.q_as(pg_temp.f('st'), 'select count(*)::text from public.sponsor_independent_reviews'), 'null'));
  perform pg_temp.ck('3y a clinician reads nothing from it directly', '0', coalesce(pg_temp.q_as(pg_temp.f('clin'), 'select count(*)::text from public.sponsor_independent_reviews'), 'null'));
  perform pg_temp.ck('3z a user cannot insert directly', 'ERR:42501', pg_temp.q_as(pg_temp.f('admin'), format($q$ insert into public.sponsor_independent_reviews (cohort_id, reviewer_name, reviewer_organisation, reviewed_on, scope, recorded_by) values (%L, 'Dr Direct', 'Direct Ltd', current_date, 'Scope written straight into the table', %L) returning id::text $q$, pg_temp.f('cohort'), pg_temp.f('admin'))));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. The sponsor role
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_ids uuid[] := array[pg_temp.f('m1'), pg_temp.f('m2'), pg_temp.f('m3')];
begin
  perform pg_temp.ck('4a the sponsor''s staff read the disclosure for their own programme', 'true', coalesce(pg_temp.q_as(pg_temp.f('st'), format($q$ select (public.sponsor_methods_disclosure(%L) ->> 'ok') $q$, pg_temp.f('cohort'))), 'null'));
  perform pg_temp.ck('4b another sponsor''s staff get the refusal answer', 'false', coalesce(pg_temp.q_as(pg_temp.f('st2'), format($q$ select (public.sponsor_methods_disclosure(%L) ->> 'ok') $q$, pg_temp.f('cohort'))), 'null'));
  perform pg_temp.ck('4c ... which is the same answer as for a programme that does not exist', 'false', coalesce(pg_temp.q_as(pg_temp.f('st'), format($q$ select (public.sponsor_methods_disclosure(%L) ->> 'ok') $q$, gen_random_uuid())), 'null'));
  perform pg_temp.ck('4d a patient is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('patient'), format('select public.sponsor_methods_disclosure(%L)::text', pg_temp.f('cohort'))));
  perform pg_temp.ck('4e a clinician is refused', 'ERR:42501', pg_temp.q_as(pg_temp.f('clin'), format('select public.sponsor_methods_disclosure(%L)::text', pg_temp.f('cohort'))));
  perform pg_temp.ck('4f anon is refused', '42501', pg_temp.try_anon(format('select public.sponsor_methods_disclosure(%L)', pg_temp.f('cohort'))));
  perform pg_temp.ck('4g a view of the disclosure is audited', 'true', (exists (select 1 from public.audit_log where action = 'sponsor.methods_viewed' and entity_id = pg_temp.f('cohort')))::text);
  -- invariant I9: the sponsor role is refused every individual record
  perform pg_temp.ck('4h the sponsor role reads no member profile', '0', coalesce(pg_temp.q_as(pg_temp.f('st'), format('select count(*)::text from public.profiles where id = any(%L::uuid[])', v_ids)), 'null'));
  perform pg_temp.ck('4i the sponsor role reads no member reading', '0', coalesce(pg_temp.q_as(pg_temp.f('st'), format('select count(*)::text from public.vitals_readings where patient_id = any(%L::uuid[])', v_ids)), 'null'));
  perform pg_temp.ck('4j the sponsor role reads no member''s programme row', '0', coalesce(pg_temp.q_as(pg_temp.f('st'), format('select count(*)::text from public.profile_cohorts where patient_id = any(%L::uuid[])', v_ids)), 'null'));
  -- the fixture is counted by the proof's own privileged session: since the S39 tied-reads change an admin cannot read a member's readings
  -- either (that is the design), so an admin read would show a refusal, not whether the fixture exists
  perform pg_temp.ck('4k ... and the fixture exists (so the zeros above are refusals, not an empty fixture)', '3', (select count(*)::text from public.vitals_readings where patient_id = any(v_ids)));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. The pack carries no member
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare r jsonb := pg_temp.pack(); v_txt text;
begin
  v_txt := r::text;
  perform pg_temp.ck('5a the pack is issued with the block in it', 'true/false', (r ->> 'ok') || '/' || (r #>> '{pack,methods_and_funding,withheld}'));
  perform pg_temp.ck('5b no member id is anywhere in the pack', '0', (select count(*)::text from fx where k ~ '^m[123]$' and position(v::text in v_txt) > 0));
  perform pg_temp.ck('5c the causal-wording check still refuses a causal claim', '1', cardinality(private.causal_wording_hits('The programme caused the fall in blood pressure.'))::text);
  perform pg_temp.ck('5d the block''s own words pass the check', '0', cardinality(private.causal_wording_hits(private.json_text(r #> '{pack,methods_and_funding}')))::text);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Scans
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
begin
  perform pg_temp.ck('6a every new function sets an explicit search_path', '0', (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where ((n.nspname = 'public' and p.proname in ('sponsor_methods_disclosure', 'record_sponsor_independent_review', 'withdraw_sponsor_independent_review'))
        or (n.nspname = 'private' and p.proname in ('sponsor_methods_block', 'sponsor_methods_wording', 'sponsor_independent_reviews_guard')))
      and not coalesce(p.proconfig::text ilike '%search_path%', false)));
  perform pg_temp.ck('6b anon can execute none of the public functions', 'false', (has_function_privilege('anon', 'public.sponsor_methods_disclosure(uuid)', 'EXECUTE')
    or has_function_privilege('anon', 'public.record_sponsor_independent_review(uuid,text,text,date,text)', 'EXECUTE') or has_function_privilege('anon', 'public.withdraw_sponsor_independent_review(uuid,text)', 'EXECUTE'))::text);
  perform pg_temp.ck('6c a signed-in user cannot execute the private block or the wording', 'false', (has_function_privilege('authenticated', 'private.sponsor_methods_block(uuid,integer)', 'EXECUTE')
    or has_function_privilege('authenticated', 'private.sponsor_methods_wording()', 'EXECUTE'))::text);
  perform pg_temp.ck('6d the table is closed to anon and to writes by users', 'false', (has_table_privilege('anon', 'public.sponsor_independent_reviews', 'SELECT') or has_table_privilege('authenticated', 'public.sponsor_independent_reviews', 'INSERT,UPDATE,DELETE'))::text);
  perform pg_temp.ck('6e a signed-in user can select (row security does the filtering)', 'true', has_table_privilege('authenticated', 'public.sponsor_independent_reviews', 'SELECT')::text);
  perform pg_temp.ck('6f row security is on', 'true', (select relrowsecurity::text from pg_class where oid = 'public.sponsor_independent_reviews'::regclass));
  perform pg_temp.ck('6g the table has no patient column (so it needs no staff_read_scope or data_registry entry)', '0', (select count(*)::text from information_schema.columns where table_schema = 'public' and table_name = 'sponsor_independent_reviews' and column_name ~ 'patient'));
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Sabotage: a proof that cannot fail is not a proof
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare v_id uuid; r text;
begin
  select id into v_id from public.sponsor_independent_reviews where reviewer_name = 'Dr Visible';
  -- (a) the append-only trigger dropped: an edit must then succeed
  drop trigger sponsor_independent_reviews_guard on public.sponsor_independent_reviews;
  perform pg_temp.sk('sabotaged-trigger', '3p an edit is refused', '23514', pg_temp.try(format('update public.sponsor_independent_reviews set scope = %L where id = %L', 'An edited scope that is long enough', v_id)));
end $$;

create or replace function public.sponsor_methods_disclosure(p_cohort uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid := private.sponsor_staff_org(); v_privileged boolean := (private.is_admin() or private.credential_is_cmo());
begin
  if (select auth.uid()) is null or (v_org is null and not v_privileged) then raise exception 'sponsor_not_authorised' using errcode = '42501'; end if;
  -- SABOTAGE: the ownership check is gone
  return jsonb_build_object('ok', true, 'methods', private.sponsor_methods_block(p_cohort, 20));
end $$;

do $$
begin
  perform pg_temp.sk('sabotaged-owner', '4b another sponsor''s staff get the refusal answer', 'false', coalesce(pg_temp.q_as(pg_temp.f('st2'), format($q$ select (public.sponsor_methods_disclosure(%L) ->> 'ok') $q$, pg_temp.f('cohort'))), 'null'));
end $$;

do $$
declare v_bad integer; v_flipped integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'GAP-71 proof FAILED on the real migration: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_flipped from results where phase = 'sabotaged-trigger' and expected is distinct from actual;
  if v_flipped < 1 then raise exception 'VACUOUS TEST: dropping the append-only trigger did not flip 3p'; end if;
  select count(*) into v_flipped from results where phase = 'sabotaged-owner' and expected is distinct from actual;
  if v_flipped < 1 then raise exception 'VACUOUS TEST: removing the ownership check did not flip 4b'; end if;
end $$;

select check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;

rollback;

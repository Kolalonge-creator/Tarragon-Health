-- S68b proof: the daily child log, the card photo and the idempotency keys (migration *_s68h_child_daily_log_card_photos_and_offline_keys). One rolled-back transaction.
--   1. A parent who manages a child logs feed, sleep and nappy events; recorded_by and the organisation are server-derived (a forged organisation is overwritten),
--      the caregiver label is cleaned, a replay of the same client id is a unique violation (a duplicate, never a second row), the log is append-only
--      (no update, no delete), a future time and a feed type on a non-feed event are refused, a correction must point at the same child.
--   2. The guard: a REAL child is refused while maternal_enabled is off and allowed once on; READS are never gated (history written while the guard was on
--      is still readable after it is off), and no select policy mentions a plan, entitlement or guard (a child's own history is never paywalled).
--   3. Who can read: the parent, a second caregiver whose view grant on the CHILD carries medical_history, org staff. NOT a view grant with no category,
--      NOT a stranger, NOT anon. A read-only partner cannot write. The partner, who holds no grant on the mother, reads NONE of her EPDS screens, feed
--      log, lifecycle or loss records: the child's grant does not reach the mother.
--   4. Card photo: the path must be <uploader>/<child>/<client id>.jpg, a new photo is always waiting for the care team (reviewed_by null), the partner with
--      the vaccinations category reads it and cannot add one, nothing can be changed or removed from the phone, the bucket is private and jpeg only.
--   5. client_id on the mother's feed log and on growth: a replay is a unique violation. The two new tables are classified allowed for under-18 rows and registered.
--   6. SABOTAGE: (a) the guard check removed from the daily-event trigger, (b) the select policy opened, (c) the unique client constraint dropped. Checks must flip.
begin;

-- S47d: reproductive health records are written only after the person has said yes. This proof is about something else, so every profile it creates
-- gets the yes recorded for it by a trigger that exists only in this rolled-back transaction.
create function pg_temp.s47d_say_yes() returns trigger language plpgsql as $f$
begin
  if new.organisation_id is not null and not exists (select 1 from public.consent_matrix_events e where e.patient_id = new.id and e.data_type = 'reproductive') then
    insert into public.consent_matrix_events (organisation_id, patient_id, data_type, purpose, action, policy_version, source, recorded_by, is_test)
    values (new.organisation_id, new.id, 'reproductive', 'care', 'granted', 2, 'patient', new.id, false);
  end if;
  return new;
end $f$;
create trigger zz_s47d_say_yes after insert or update of organisation_id on public.profiles for each row execute function pg_temp.s47d_say_yes();


-- S04b-1: a child exists only as a minor dependant record, and the minor-scope trigger (also on every table that holds a patient_id) refuses most tables to
-- minors. These proofs are about the maternal and child content, so the trigger is lifted for this rolled-back transaction only.
do $$
declare v_t record;
begin
  for v_t in select c.relname from pg_trigger g join pg_class c on c.oid = g.tgrelid join pg_namespace n on n.oid = c.relnamespace
              where g.tgname = '00_minor_dependant_scope' and n.nspname = 'public' loop
    execute format('alter table public.%I disable trigger "00_minor_dependant_scope"', v_t.relname);
  end loop;
end $$;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;

create function pg_temp.f(p text) returns uuid language sql as $$ select v from fx where k = p $$;
create function pg_temp.setf(p text, p_v uuid) returns void language sql as
$$ insert into fx values (p, p_v) on conflict (k) do update set v = excluded.v $$;
create function pg_temp.ck(p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values ('real', p_name, p_expected, p_actual) $$;
create function pg_temp.act(p_uid uuid) returns void language plpgsql as
$f$ begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.back() returns void language plpgsql as
$f$ begin reset role; perform set_config('request.jwt.claims', '', true); perform set_config('request.jwt.claim.role', '', true); perform set_config('request.jwt.claim.sub', '', true); end $f$;
-- run a statement as a user; 'ok' or the error message
create function pg_temp.try_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql; r := 'ok'; exception when others then r := sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
-- run a statement as a user and return the first column of the first row ('ERR:' + message on error)
create function pg_temp.q_as(p_uid uuid, p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  perform pg_temp.act(p_uid);
  begin execute p_sql into r; exception when others then r := 'ERR:' || sqlerrm; end;
  perform pg_temp.back();
  return r;
end $f$;
create function pg_temp.q(p_sql text) returns text language plpgsql as
$f$ declare r text; begin execute p_sql into r; return r; end $f$;
create function pg_temp.try_anon(p_sql text) returns text language plpgsql as
$f$ declare r text;
begin
  set local role anon;
  begin execute p_sql into r; r := 'ok'; exception when others then r := sqlerrm; end;
  reset role;
  return r;
end $f$;
-- a profile (auth user first). p_dob / p_sex optional. Test accounts by default (INV-13).
create function pg_temp.mkuser(p_org uuid, p_label text, p_role text, p_dob date default null, p_sex text default null, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v, 's68-' || p_label || '-' || v || '@example.invalid', 'x', now(), '{}', '{}');
  -- S04b-1: registration is for adults; a person under 18 exists only as a minor dependant record.
  insert into public.profiles (id, organisation_id, role, full_name, phone, date_of_birth, is_test, is_dependent_account, dependent_kind)
  values (v, p_org, p_role::public.user_role, 'S68 ' || p_label, '+23480' || lpad((random() * 99999999)::int::text, 8, '0'),
          coalesce(p_dob, (current_date - interval '30 years')::date), p_test,
          coalesce(p_dob, current_date - interval '30 years') > current_date - interval '18 years',
          case when coalesce(p_dob, current_date - interval '30 years') > current_date - interval '18 years' then 'minor_child'::public.dependent_kind end)
  on conflict (id) do update set role = excluded.role, is_test = excluded.is_test, is_active = true, phone = excluded.phone, date_of_birth = excluded.date_of_birth,
    is_dependent_account = excluded.is_dependent_account, dependent_kind = excluded.dependent_kind;
  if p_sex is not null then update public.profiles set sex = p_sex::public.sex where id = v; end if;
  if p_role = 'clinician' then
    insert into public.clinical_staff (organisation_id, profile_id, full_name, active, license_verified_at, doctor_tier)
    values (p_org, v, 'S68 ' || p_label, true, now(), 'senior_medical_officer') on conflict do nothing;  -- S39g: a clinician's write needs an active staff row and a care tie
  end if;
  return v;
end $f$;
-- a dependent child managed by a parent
create function pg_temp.mkchild(p_org uuid, p_parent uuid, p_label text, p_dob date, p_sex text, p_test boolean default true) returns uuid
language plpgsql as $f$
declare v uuid := pg_temp.mkuser(p_org, p_label, 'patient', p_dob, p_sex, p_test);
begin
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v, p_parent, 'manage', p_parent);
  return v;
end $f$;
-- the guard, for the proof only: the real guard row can be switched by nobody but set_go_live_guard
create function pg_temp.guard_state(p_on boolean) returns void language plpgsql as
$f$ begin
  execute format('create or replace function private.go_live_guard_on(p_key text) returns boolean language sql stable security definer set search_path = '''' as ''select %s''', case when p_on then 'true' else 'false' end);
end $f$;


do $$
declare
  v_org uuid; v_mum uuid; v_dad uuid; v_cg uuid; v_stranger uuid; v_clin uuid; v_clin2 uuid; v_co uuid; v_adult uuid; v_child uuid; v_child2 uuid; v_real uuid; g uuid;
  r text; e1 uuid := gen_random_uuid(); e2 uuid := gen_random_uuid(); v_self uuid := gen_random_uuid(); v_fast uuid := gen_random_uuid(); cid uuid := gen_random_uuid();
begin
  select id into v_org from public.organisations order by created_at limit 1;
  v_mum := pg_temp.mkuser(v_org, 'mum', 'patient', (current_date - interval '28 years')::date, 'female');
  v_dad := pg_temp.mkuser(v_org, 'partner', 'patient'); v_cg := pg_temp.mkuser(v_org, 'plain_view', 'patient');
  v_stranger := pg_temp.mkuser(v_org, 'stranger', 'patient'); v_clin := pg_temp.mkuser(v_org, 'clin', 'clinician'); v_clin2 := pg_temp.mkuser(v_org, 'clin_untied', 'clinician'); v_co := pg_temp.mkuser(v_org, 'coord', 'care_coordinator');
  v_child := pg_temp.mkchild(v_org, v_mum, 'baby', current_date - 60, 'female');
  v_child2 := pg_temp.mkchild(v_org, v_stranger, 'other_baby', current_date - 90, 'male');
  -- ONE clinician is tied to the child (care team assignment); the other is staff of the same organisation with NO tie
  insert into public.care_team_assignment (organisation_id, patient_id, clinician_id, care_coordinator_id, assigned_at) values (v_org, v_child, v_clin, v_co, now());
  perform pg_temp.setf('clin2', v_clin2);
  perform pg_temp.setf('org', v_org); perform pg_temp.setf('mum', v_mum); perform pg_temp.setf('dad', v_dad); perform pg_temp.setf('cg', v_cg);
  perform pg_temp.setf('stranger', v_stranger); perform pg_temp.setf('clin', v_clin); perform pg_temp.setf('child', v_child); perform pg_temp.setf('child2', v_child2);

  -- a read-only partner: a VIEW grant on the child carrying medical_history and vaccinations (set by the child's own session, the only way the model allows)
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_child, v_dad, 'view', v_child) returning id into g;
  perform pg_temp.act(v_child);
  perform public.set_care_access_categories(g, array['medical_history', 'vaccinations']::public.care_access_category[]);
  perform pg_temp.back();
  -- a second caregiver whose view grant carries NO category
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_child, v_cg, 'view', v_child);

  -- 1. the parent logs events; server-derived fields; label cleaned
  r := pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, feed_type, occurred_at, logged_by_label)
        values (%L, %L, %L, %L, 'feed', 'breast', now() - interval '10 minutes', %L)$q$, e1, gen_random_uuid(), v_child, gen_random_uuid(), ' <b>Aunty</b>   Ngozi '));
  perform pg_temp.ck('a parent who manages the child logs a feed', 'ok', r);
  perform pg_temp.ck('...the forged organisation is overwritten by the child''s own', v_org::text, (select organisation_id::text from public.child_daily_events where id = e1));
  perform pg_temp.ck('...recorded_by is the signed-in account, source caregiver', v_mum::text || '|caregiver', (select recorded_by::text || '|' || source from public.child_daily_events where id = e1));
  perform pg_temp.ck('...the caregiver label is cleaned (markup removed, spaces collapsed)', 'b Aunty /b Ngozi', (select logged_by_label from public.child_daily_events where id = e1));
  perform pg_temp.ck('sleep start, sleep stop, wet and dirty nappies are accepted', 'ok|ok|ok|ok', concat_ws('|',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'sleep_start', now() - interval '5 hours')$q$, v_org, v_child)),
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'sleep_stop', now() - interval '4 hours')$q$, v_org, v_child)),
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now() - interval '3 hours')$q$, v_org, v_child)),
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, %L, 'nappy_dirty', now() - interval '2 hours')$q$, v_org, v_child, cid))));
  perform pg_temp.ck('a replay of the same client id is a duplicate (unique violation), not a second row', 'true',
    (pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, %L, 'nappy_dirty', now() - interval '2 hours')$q$, v_org, v_child, cid)) like '%child_daily_events_unique_client%')::text);
  perform pg_temp.ck('...still exactly one row for that client id', '1', (select count(*)::text from public.child_daily_events where client_id = cid));
  perform pg_temp.ck('the log is append-only: no update', 'permission denied for table child_daily_events', pg_temp.try_as(v_mum, 'update public.child_daily_events set kind = ''nappy_wet'''));
  perform pg_temp.ck('...and no delete', 'permission denied for table child_daily_events', pg_temp.try_as(v_mum, 'delete from public.child_daily_events'));
  r := pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, occurred_at, client_recorded_at) values (%L, %L, %L, gen_random_uuid(), 'nappy_wet', now() + interval '2 days', now() + interval '2 days')$q$, v_fast, v_org, v_child));
  perform pg_temp.ck('a phone clock two days fast is accepted, not lost: occurred_at is clamped to now and the phone claim is kept', 'ok|true|true', r
    || '|' || (select (occurred_at <= now())::text from public.child_daily_events where id = v_fast)
    || '|' || (select (client_recorded_at > now() + interval '1 day')::text from public.child_daily_events where id = v_fast));
  perform pg_temp.ck('a feed type on a non-feed event is refused', 'true',
    (pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, feed_type, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', 'breast', now())$q$, v_org, v_child)) like '%child_daily_events_feed_type_only_on_feed%')::text);
  perform pg_temp.ck('a correction pointing at the same child is accepted', 'ok',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at, corrects_id) values (%L, %L, gen_random_uuid(), 'feed', now() - interval '9 minutes', %L)$q$, v_org, v_child, e1)));
  perform pg_temp.try_as(v_stranger, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, e2, v_org, v_child2));
  perform pg_temp.ck('a correction pointing at ANOTHER child''s entry is refused', 'A correction must point at an entry for the same child',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at, corrects_id) values (%L, %L, gen_random_uuid(), 'feed', now(), %L)$q$, v_org, v_child, e2)));

  -- 3. who can read and write
  perform pg_temp.ck('the parent reads the child''s log', '7', pg_temp.q_as(v_mum, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('the read-only partner (view grant + medical_history on the child) reads it', '7', pg_temp.q_as(v_dad, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('a view grant with no category reads nothing', '0', pg_temp.q_as(v_cg, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('a stranger reads nothing', '0', pg_temp.q_as(v_stranger, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('a clinician WITH a care tie reads it', '7', pg_temp.q_as(v_clin, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('a clinician of the same organisation WITHOUT a tie is refused (reads 0)', '0', pg_temp.q_as(v_clin2, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.ck('the tied clinician may record for the child, the untied one may not', 'ok|true',
    pg_temp.try_as(v_clin, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_child))
    || '|' || (pg_temp.try_as(v_clin2, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_child)) like '%row-level security%')::text);
  perform pg_temp.ck('...and the tied clinician''s row is stored as clinician_recorded', 'clinician_recorded', (select source from public.child_daily_events where patient_id = v_child and recorded_by = v_clin limit 1));
  perform pg_temp.ck('both child tables are registered as TIED (G1) and no select policy keeps the plain organisation-wide staff read (G2)', 'tied|tied|0',
    (select string_agg(mode, '|' order by table_name) from public.staff_read_scope where table_name in ('child_card_photos', 'child_daily_events'))
    || '|' || (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('child_daily_events', 'child_card_photos') and cmd in ('SELECT', 'ALL') and coalesce(qual, '') like '%private.is_org_staff(organisation_id)%'));
  perform pg_temp.ck('a correction cannot point at itself (the trigger refuses it first; the CHECK is the backstop)', 'true',
    (pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, occurred_at, corrects_id) values (%L, %L, %L, gen_random_uuid(), 'feed', now(), %L)$q$, v_self, v_org, v_child, v_self)) like '%child_daily_events_not_self_correcting%' or pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, occurred_at, corrects_id) values (%L, %L, %L, gen_random_uuid(), 'feed', now(), %L)$q$, gen_random_uuid(), v_org, v_child, v_self)) like '%must point at an entry for the same child%')::text);
  perform pg_temp.ck('anon is refused', 'permission denied for table child_daily_events', pg_temp.try_anon('select 1 from public.child_daily_events limit 1'));
  perform pg_temp.ck('the read-only partner cannot write', 'true',
    (pg_temp.try_as(v_dad, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_child)) like '%row-level security%')::text);
  perform pg_temp.ck('a stranger cannot write for the child', 'true',
    (pg_temp.try_as(v_stranger, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_child)) like '%row-level security%')::text);

  -- a manager of someone who is no longer a minor cannot write for them through the old grant
  v_adult := pg_temp.mkuser(v_org, 'adult_dep', 'patient', (current_date - interval '19 years')::date, 'female');
  update public.profiles set is_dependent_account = true, dependent_kind = 'minor_child' where id = v_adult;
  insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by) values (v_adult, v_mum, 'manage', v_mum);
  perform pg_temp.ck('a manage grant over someone aged 19 does not allow a daily-log entry', 'true',
    (pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_adult)) like '%row-level security%')::text);
  perform pg_temp.ck('the storage insert policy ties the child folder to a child the uploader may act for', 'true',
    (select (count(*) = 1 and bool_and(with_check like '%can_act_for_minor%'))::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'child card photo uploader insert'));
  perform pg_temp.ck('can_act_for_minor is not executable by anon', 'false', has_function_privilege('anon', 'private.can_act_for_minor(uuid)', 'EXECUTE')::text);

  -- ...and the partner reaches NOTHING of the mother's: her EPDS screen, feed log, life stage and pregnancy record
  insert into public.mental_health_screens (organisation_id, patient_id, instrument, total_score, severity_band, item_responses) values (v_org, v_mum, 'epds', 0, 'minimal', '{"items":[0,0,0,0,0,0,0,0,0,0]}');
  insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type) values (v_org, v_mum, 'breast_left');
  perform pg_temp.ck('control: the mother reads her own EPDS screen and feed log', '1|1', pg_temp.q_as(v_mum, format('select (select count(*) from public.mental_health_screens where patient_id = %L)::text || ''|'' || (select count(*) from public.breastfeeding_feed_log where patient_id = %L)::text', v_mum, v_mum)));
  perform pg_temp.ck('the partner reads none of the mother''s EPDS screens', '0', pg_temp.q_as(v_dad, format('select count(*)::text from public.mental_health_screens where patient_id = %L', v_mum)));
  perform pg_temp.ck('...none of her feed log', '0', pg_temp.q_as(v_dad, format('select count(*)::text from public.breastfeeding_feed_log where patient_id = %L', v_mum)));
  perform pg_temp.ck('...none of her life stage, loss or pregnancy records', '0|0|0', pg_temp.q_as(v_dad, format('select (select count(*) from public.lifecycle_states where patient_id = %1$L)::text || ''|'' || (select count(*) from public.pregnancy_loss_records where patient_id = %1$L)::text || ''|'' || (select count(*) from public.patient_pregnancy where patient_id = %1$L)::text', v_mum)));

  -- 2. the guard: a REAL child is refused while maternal_enabled is off; reads are never gated
  v_real := pg_temp.mkchild(v_org, v_mum, 'real_baby', current_date - 30, 'male', false);
  perform pg_temp.setf('real', v_real);
  perform pg_temp.setf('fastsab', gen_random_uuid());
  perform pg_temp.ck('a REAL child is refused while maternal_enabled is off', 'The daily log is not open yet',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_real)));
  perform pg_temp.guard_state(true);
  perform pg_temp.ck('...and allowed once it is on', 'ok',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_real)));
  perform pg_temp.guard_state(false);
  perform pg_temp.ck('a child''s history stays readable with the guard off (never behind a switch)', '1', pg_temp.q_as(v_mum, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_real)));
  perform pg_temp.ck('no select policy on either new table mentions a plan, entitlement, subscription or guard', '0',
    (select count(*)::text from pg_policies where schemaname = 'public' and tablename in ('child_daily_events', 'child_card_photos') and cmd = 'SELECT' and qual ~* 'entitle|plan|subscription|go_live|voucher'));

  -- 4. the card photo
  r := pg_temp.try_as(v_mum, format($q$insert into public.child_card_photos (organisation_id, patient_id, client_id, storage_path, size_bytes, status, reviewed_by, reviewed_at, logged_by_label)
        values (%L, %L, %L, %L, 120000, 'seen_by_care_team', %L, now(), 'Mum')$q$, v_org, v_child, cid, v_mum::text || '/' || v_child::text || '/' || cid::text || '.jpg', v_clin));
  perform pg_temp.ck('the parent saves a card photo record', 'ok', r);
  perform pg_temp.ck('...it always starts waiting for the care team, with no reviewer', 'waiting_for_care_team|null', (select status || '|' || coalesce(reviewed_by::text, 'null') from public.child_card_photos where client_id = cid));
  perform pg_temp.ck('the row is written first: it starts pending_upload, and confirming without a file is refused, confirming by someone else is refused', 'pending_upload|ERR:the file has not been uploaded yet|ERR:no such photo record',
    (select file_state from public.child_card_photos where client_id = cid) || '|' || pg_temp.q_as(v_mum, format('select public.confirm_child_card_photo_uploaded(%L, %L)', v_child, cid))
    || '|' || pg_temp.q_as(v_dad, format('select public.confirm_child_card_photo_uploaded(%L, %L)', v_child, cid)));
  insert into storage.objects (bucket_id, name) values ('child-card-photos', v_mum::text || '/' || v_child::text || '/' || cid::text || '.jpg');
  perform pg_temp.ck('once the file exists the uploader can confirm it, and only then the row is uploaded', 'true|uploaded', pg_temp.q_as(v_mum, format('select public.confirm_child_card_photo_uploaded(%L, %L)::text', v_child, cid)) || '|' || (select file_state from public.child_card_photos where client_id = cid));
  perform pg_temp.ck('anon cannot call the confirm function', 'false', has_function_privilege('anon', 'public.confirm_child_card_photo_uploaded(uuid,uuid)', 'EXECUTE')::text);
  perform pg_temp.ck('a path that is not <uploader>/<child>/<client id>.jpg is refused', 'The photo path does not match the account, the child and the entry',
    pg_temp.try_as(v_mum, format($q$insert into public.child_card_photos (organisation_id, patient_id, client_id, storage_path, size_bytes) values (%L, %L, gen_random_uuid(), 'someone/else.jpg', 1000)$q$, v_org, v_child)));
  perform pg_temp.ck('the partner with the vaccinations category reads the record', '1', pg_temp.q_as(v_dad, format('select count(*)::text from public.child_card_photos where patient_id = %L', v_child)));
  perform pg_temp.ck('a view grant with no category and a stranger read nothing', '0|0', pg_temp.q_as(v_cg, format('select count(*)::text from public.child_card_photos where patient_id = %L', v_child)) || '|' || pg_temp.q_as(v_stranger, format('select count(*)::text from public.child_card_photos where patient_id = %L', v_child)));
  perform pg_temp.ck('the partner cannot add a card photo', 'true',
    (pg_temp.try_as(v_dad, format($q$insert into public.child_card_photos (organisation_id, patient_id, client_id, storage_path, size_bytes) values (%L, %L, gen_random_uuid(), 'x', 1000)$q$, v_org, v_child)) like '%row-level security%')::text);
  perform pg_temp.ck('nothing can be changed or removed from the phone', 'permission denied for table child_card_photos|permission denied for table child_card_photos',
    pg_temp.try_as(v_mum, 'update public.child_card_photos set status = ''seen_by_care_team''') || '|' || pg_temp.try_as(v_mum, 'delete from public.child_card_photos'));
  perform pg_temp.ck('anon is refused', 'permission denied for table child_card_photos', pg_temp.try_anon('select 1 from public.child_card_photos limit 1'));
  perform pg_temp.ck('the bucket is private, jpeg only, 5 MB', 'false|{image/jpeg}|5242880', (select public::text || '|' || allowed_mime_types::text || '|' || file_size_limit from storage.buckets where id = 'child-card-photos'));
  perform pg_temp.ck('the two uploader-folder storage policies exist, and no update or delete policy', '2|0',
    (select (count(*) filter (where cmd in ('INSERT', 'SELECT')))::text || '|' || (count(*) filter (where cmd in ('UPDATE', 'DELETE', 'ALL')))::text from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'child card photo%'));

  -- 5. idempotency keys on the S68 writes the phone could not queue before, and the classification
  perform pg_temp.ck('a queued feed-log write replayed is a duplicate', 'ok|true',
    pg_temp.try_as(v_mum, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, client_id) values (%L, %L, 'formula', %L)$q$, v_org, v_mum, e1))
    || '|' || (pg_temp.try_as(v_mum, format($q$insert into public.breastfeeding_feed_log (organisation_id, patient_id, feed_type, client_id) values (%L, %L, 'formula', %L)$q$, v_org, v_mum, e1)) like '%breastfeeding_feed_log_client_id_uq%')::text);
  perform pg_temp.ck('a queued growth write replayed is a duplicate', 'ok|true',
    pg_temp.try_as(v_mum, format($q$insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position, client_id) values (%L, %L, now() - interval '1 hour', 5.1, 58, 'recumbent', %L)$q$, v_org, v_child, e1))
    || '|' || (pg_temp.try_as(v_mum, format($q$insert into public.child_growth_measurements (organisation_id, patient_id, measured_at, weight_kg, height_cm, measure_position, client_id) values (%L, %L, now() - interval '1 hour', 5.1, 58, 'recumbent', %L)$q$, v_org, v_child, e1)) like '%child_growth_measurements_client_id_uq%')::text);
  perform pg_temp.ck('both new tables are classified allowed for under-18 rows, with no scope trigger left on them', 'allowed|allowed|0',
    (select string_agg(policy, '|' order by table_name) from public.minor_dependant_table_policy where table_name in ('child_card_photos', 'child_daily_events'))
    || '|' || (select count(*)::text from pg_trigger g join pg_class c on c.oid = g.tgrelid where c.relname in ('child_daily_events', 'child_card_photos') and g.tgname = '00_minor_dependant_scope'));
  perform pg_temp.ck('both new tables are in the S39d data registry', '2', (select count(*)::text from public.data_registry where table_name in ('child_daily_events', 'child_card_photos')));
  perform pg_temp.ck('private.go_live_conditions() is untouched (still exists)', 'true', (to_regprocedure('private.go_live_conditions()') is not null)::text);
end $$;

-- 6. SABOTAGE
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('private.stamp_child_daily_event()'::regprocedure);
  execute replace(replace(v_def, 'if not private.go_live_open_patient(''maternal_enabled'', new.patient_id) then', 'if false then'), 'new.occurred_at := now();', 'null;');
end $$;
drop policy child_daily_events_select on public.child_daily_events;
create policy child_daily_events_select on public.child_daily_events for select to authenticated using (true);
alter table public.child_daily_events drop constraint child_daily_events_unique_client;
do $$
declare
  v_org uuid := pg_temp.f('org'); v_mum uuid := pg_temp.f('mum'); v_stranger uuid := pg_temp.f('stranger'); v_real uuid := pg_temp.f('real'); v_child uuid := pg_temp.f('child');
  c uuid := gen_random_uuid(); ins text;
begin
  insert into results values ('sabotaged', 'a REAL child is refused while maternal_enabled is off', 'The daily log is not open yet',
    pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, gen_random_uuid(), 'nappy_wet', now())$q$, v_org, v_real)));
  insert into results values ('sabotaged', 'a clinician of the same organisation WITHOUT a tie is refused (reads 0)', '0', pg_temp.q_as(pg_temp.f('clin2'), format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  perform pg_temp.try_as(v_mum, format($q$insert into public.child_daily_events (id, organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, %L, gen_random_uuid(), 'nappy_wet', now() + interval '2 days')$q$, pg_temp.f('fastsab'), v_org, v_child));
  insert into results values ('sabotaged', 'a phone clock two days fast is clamped to now', 'true', coalesce((select (occurred_at <= now())::text from public.child_daily_events where id = pg_temp.f('fastsab')), 'missing'));
  insert into results values ('sabotaged', 'a stranger reads nothing', '0', pg_temp.q_as(v_stranger, format('select count(*)::text from public.child_daily_events where patient_id = %L', v_child)));
  ins := format($q$insert into public.child_daily_events (organisation_id, patient_id, client_id, kind, occurred_at) values (%L, %L, %L, 'nappy_wet', now())$q$, v_org, v_child, c);
  perform pg_temp.try_as(v_mum, ins);
  perform pg_temp.try_as(v_mum, ins);
  insert into results values ('sabotaged', 'one row per client id', '1', (select count(*)::text from public.child_daily_events where client_id = c));
end $$;

do $$
declare v_bad integer; v_caught integer;
begin
  select count(*) into v_bad from results where phase = 'real' and expected is distinct from actual;
  if v_bad > 0 then
    raise exception 'S68b child daily log proof FAILED: %',
      (select string_agg(check_name || ' => expected ' || expected || ' got ' || coalesce(actual, 'null'), '; ') from results where phase = 'real' and expected is distinct from actual);
  end if;
  select count(*) into v_caught from results where phase = 'sabotaged' and expected <> actual;
  if v_caught < 3 then raise exception 'VACUOUS TEST: the sabotage flipped % of 3 checks', v_caught; end if;
end $$;

select phase, check_name, expected, actual, case when expected = actual then 'PASS' else 'FAIL' end as result from results where phase = 'real' order by check_name;
rollback;

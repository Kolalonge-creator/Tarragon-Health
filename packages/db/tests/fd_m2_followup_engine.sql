-- ===========================================================================
-- Proof: Front Desk M2 follow-up engine (migration 20261102001301_fd_m2_followup_engine.sql).
-- Spec acceptance check: "a simulated stalled user gets the right email once, quiet hours and caps hold, completion stops it, unsubscribe works".
--
--   1. DISABLED: with the master switch off the detector does nothing.
--   2. DETECTION: confirmed-email accounts get a contact, a live consent (contract basis, hashed wording) and the right runs: a stalled
--      sign-up gets finish_signup, an onboarded account without a risk check gets the reminder, a new account gets the welcome.
--      CONTROLS: a test account, an unconfirmed email and a phone-only account get nothing. A second sweep adds nothing (idempotent).
--      A stalled sign-up found days late is treated as stalling now: its first email is due now, not stale.
--   3. APPROVAL GATE: with nothing approved nothing is claimed and the runs are left scheduled.
--   4. QUIET HOURS: inside the window nothing is claimed and nothing is consumed.
--   5. DRY-RUN: the due, approved runs are held back as skipped/dry_run (counted); a non-boolean setting is treated as dry-run; re-arm puts
--      the fresh ones back and only an admin may.
--   6. EXACTLY ONCE: going live claims each contact once (the minimum gap defers the contact's other due run); an immediate second claim
--      returns nothing; after the send is recorded nothing more is due inside 12 hours.
--   7. CAPS: over weekly_send_cap a run is skipped; a paused sequence and unapproved wording are deferred, not dropped; an overdue run is stale.
--   8. COMPLETION STOPS IT: a risk score or finished onboarding makes remaining runs goal_reached at send time, and the detector cancels the rest.
--   9. UNSUBSCRIBE / BOUNCE: both suppress at once, withdraw every consent, cancel scheduled runs; a bounce recorded by the Resend webhook table does it too.
--  10. CONSENT: a marketing sequence is not started without marketing consent; withdrawing consent skips the send.
--  11. EVENTS: an app event cancels runs whose goal it is; an unknown event type is refused.
--  12. ACCESS: nobody but the service role claims, finishes, detects or unsubscribes; the overview is staff only.
--  13. SABOTAGE (each MUST flip): claim granted to authenticated; the bounce trigger dropped; the goal check made blind.
-- Wrapped in BEGIN/ROLLBACK; mints its own fixtures. Fails loudly and prints a verdict table.
-- ===========================================================================
begin;

create temp table results(phase text, check_name text, expected text, actual text) on commit drop;
grant all on results to public;
create function pg_temp.rec(p_phase text, p_name text, p_expected text, p_actual text) returns void language sql as
$$ insert into results values (p_phase, p_name, p_expected, p_actual) $$;

create function pg_temp.as_val(p_uid uuid, p_role text, p_sql text) returns text language plpgsql as
$f$
declare v_out text;
begin
  perform set_config('request.jwt.claims', case when p_uid is null then json_build_object('role', p_role)::text
                                                else json_build_object('sub', p_uid, 'role', p_role)::text end, true);
  execute format('set local role %I', p_role);
  begin
    execute p_sql into v_out;
  exception when others then
    v_out := 'ERR:' || sqlstate;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_out;
end $f$;

create temp table fx(k text primary key, v uuid) on commit drop;
grant all on fx to public;
create function pg_temp.f(p_k text) returns uuid language sql as $$ select v from fx where k = p_k $$;

-- config + claim helpers
create function pg_temp.cfg(p_key text, p_val jsonb) returns void language sql as
$$ update public.fd_app_config set value = p_val where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_key $$;
create temp table lastclaim(j jsonb) on commit drop;
grant all on lastclaim to public;
create function pg_temp.claim() returns void language sql as $$
  delete from lastclaim;
  insert into lastclaim select coalesce(jsonb_agg(jsonb_build_object('c', contact_id, 's', step_key, 'r', run_id)), '[]'::jsonb) from public.service_fd_claim_runs(50)
$$;
create function pg_temp.claimed_n() returns text language sql as $$ select jsonb_array_length(j)::text from lastclaim $$;
create function pg_temp.claimed_steps() returns text language sql as
$$ select coalesce(string_agg(x ->> 's', ',' order by x ->> 's'), '') from lastclaim, jsonb_array_elements(j) x $$;
create function pg_temp.run_state(p_contact uuid, p_step text) returns text language sql as
$$ select string_agg(fr.state || coalesce('/' || fr.skip_reason, ''), ',' order by fr.scheduled_for) from public.fd_followup_runs fr
    join public.fd_sequence_steps st on st.id = fr.step_id where fr.contact_id = p_contact and st.step_key = p_step $$;
create function pg_temp.run_state_key(p_contact uuid, p_step text, p_key text) returns text language sql as
$$ select string_agg(fr.state || coalesce('/' || fr.skip_reason, ''), ',' order by fr.scheduled_for) from public.fd_followup_runs fr
    join public.fd_sequence_steps st on st.id = fr.step_id where fr.contact_id = p_contact and st.step_key = p_step and fr.enrolment_key = p_key $$;
create function pg_temp.contact_of(p_user uuid) returns uuid language sql as $$ select id from public.fd_contacts where app_user_id = p_user $$;
create function pg_temp.approve(p_step text) returns void language sql as
$$ update public.fd_sequence_steps set status = 'approved', approved_by = pg_temp.f('admin'), approved_at = now() where step_key = p_step $$;

do $$
declare
  v_org constant uuid := '00000000-0000-0000-0000-000000000001';
  v_admin uuid := gen_random_uuid(); v_pat uuid := gen_random_uuid();
  v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid();
  v_t uuid := gen_random_uuid(); v_u uuid := gen_random_uuid(); v_p uuid := gen_random_uuid(); v_f uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  select u, 'fd2-' || substr(u::text, 1, 8) || '@example.invalid', 'x', now(), '{}', '{}' from unnest(array[v_admin, v_pat, v_a, v_b, v_c, v_t, v_f]) u;
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
  values (v_u, 'fd2-unconfirmed-' || substr(v_u::text, 1, 8) || '@example.invalid', 'x', null, '{}', '{}');
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data) values (v_p, null, 'x', now(), '{}', '{}');

  alter table public.profiles disable trigger profiles_enforce_onboarding_prereqs;
  insert into public.profiles (id, organisation_id, role, full_name, phone, created_at, onboarding_completed_at, is_test) values
    (v_admin, v_org, 'admin',   'FD2 Admin',          '+2348058883701', now() - interval '90 days', now() - interval '89 days', false),
    (v_pat,   v_org, 'patient', 'FD2 Patient',        '+2348058883702', now() - interval '90 days', now() - interval '89 days', false),
    (v_a,     v_org, 'patient', 'Ada Stalled',        '+2348058883703', now() - interval '4 days',  null,                       false),
    (v_b,     v_org, 'patient', 'Bola Onboarded',     '+2348058883704', now() - interval '10 days', now() - interval '3 days',  false),
    (v_c,     v_org, 'patient', 'Chidi Newcomer',     '+2348058883705', now() - interval '20 minutes', null,                     false),
    (v_t,     v_org, 'patient', 'Test Account',       '+2348058883706', now() - interval '4 days',  null,                       true),
    (v_u,     v_org, 'patient', 'Unconfirmed Email',  '+2348058883707', now() - interval '4 days',  null,                       false),
    (v_p,     v_org, 'patient', 'Phone Only',         '+2348058883708', now() - interval '4 days',  null,                       false),
    (v_f,     v_org, 'patient', 'Femi Finished',      '+2348058883709', now() - interval '10 days', now() - interval '9 days',  false)
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role, full_name = excluded.full_name,
    created_at = excluded.created_at, onboarding_completed_at = excluded.onboarding_completed_at, is_test = excluded.is_test;
  update public.profiles set onboarding_completed_at = null where id in (v_a, v_c, v_t, v_u, v_p);
  alter table public.profiles enable trigger profiles_enforce_onboarding_prereqs;

  insert into fx values ('admin', v_admin), ('pat', v_pat), ('a', v_a), ('b', v_b), ('c', v_c), ('t', v_t), ('u', v_u), ('p', v_p), ('f', v_f);
  -- config known to the proof: master switch OFF, dry-run ON (as shipped), quiet window nowhere near now, cap 3
  perform pg_temp.cfg('followups_enabled', 'false'::jsonb);
  perform pg_temp.cfg('followups_dry_run', 'true'::jsonb);
  perform pg_temp.cfg('weekly_send_cap', '3'::jsonb);
end $$;

-- A quiet window that does NOT contain now, and one that does (Africa/Lagos, the configured zone).
create function pg_temp.quiet_off() returns void language sql as $$
  select pg_temp.cfg('quiet_hours', jsonb_build_object('start', to_char((now() at time zone 'Africa/Lagos') + interval '2 hours', 'HH24:MI'),
                                                          'end', to_char((now() at time zone 'Africa/Lagos') + interval '3 hours', 'HH24:MI'), 'timezone', 'Africa/Lagos'))
$$;
create function pg_temp.quiet_on() returns void language sql as $$
  select pg_temp.cfg('quiet_hours', jsonb_build_object('start', to_char((now() at time zone 'Africa/Lagos') - interval '1 hour', 'HH24:MI'),
                                                          'end', to_char((now() at time zone 'Africa/Lagos') + interval '1 hour', 'HH24:MI'), 'timezone', 'Africa/Lagos'))
$$;
select pg_temp.quiet_off();

-- 1. disabled ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('disabled', 'the detector does nothing while the master switch is off', 'followups_disabled',
  pg_temp.as_val(null, 'service_role', $q$select (public.service_fd_detect())->>'skipped'$q$));
select pg_temp.rec('disabled', 'and creates no contact', '0', (select count(*)::text from public.fd_contacts where app_user_id = pg_temp.f('a')));

-- 2. detection --------------------------------------------------------------------------------------------------------------------------------
select pg_temp.cfg('followups_enabled', 'true'::jsonb);
-- DPO GATE: until the lawful basis is confirmed the detector creates no account contact and no consent.
select pg_temp.as_val(null, 'service_role', $q$select (public.service_fd_detect())::text$q$);
select pg_temp.rec('basis', 'with the lawful basis unconfirmed no account contact is created', '0',
  (select count(*)::text from public.fd_contacts where app_user_id in (pg_temp.f('a'), pg_temp.f('b'), pg_temp.f('c'))));
select pg_temp.rec('basis', 'a leads.manage-style outsider cannot confirm it (patient refused)', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', $q$select public.fd_set_config('account_followup_basis_confirmed', 'true'::jsonb)::text$q$));
select pg_temp.rec('basis', 'a non-boolean value is refused', 'ERR:P0001',
  pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('account_followup_basis_confirmed', '"yes"'::jsonb)::text$q$));
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', $q$select public.fd_set_config('account_followup_basis_confirmed', 'true'::jsonb)::text$q$);
select pg_temp.rec('basis', 'an admin confirms it and the change is audited', 'true',
  (select exists (select 1 from public.fd_audit_log where entity = 'fd_app_config' and entity_id = 'account_followup_basis_confirmed' and (detail -> 'value') = 'true'::jsonb)::text));
select pg_temp.rec('detect', 'the detector runs as service_role', 'true',
  (pg_temp.as_val(null, 'service_role', $q$select (public.service_fd_detect())::text$q$) like '{%')::text);
select pg_temp.rec('detect', 'contacts exist for the stalled, onboarded and new accounts', '3',
  (select count(*)::text from public.fd_contacts where app_user_id in (pg_temp.f('a'), pg_temp.f('b'), pg_temp.f('c'))));
select pg_temp.rec('detect', 'CONTROL a test account gets no contact', '0', (select count(*)::text from public.fd_contacts where app_user_id = pg_temp.f('t')));
select pg_temp.rec('detect', 'CONTROL an unconfirmed email gets no contact', '0', (select count(*)::text from public.fd_contacts where app_user_id = pg_temp.f('u')));
select pg_temp.rec('detect', 'CONTROL a phone-only account gets no contact', '0', (select count(*)::text from public.fd_contacts where app_user_id = pg_temp.f('p')));
select pg_temp.rec('detect', 'the stalled account has a live contract-basis consent with a 64 character wording hash', 'contract/true',
  (select lawful_basis || '/' || (evidence_hash ~ '^[0-9a-f]{64}$' and withdrawn_at is null)::text from public.fd_consents
    where contact_id = pg_temp.contact_of(pg_temp.f('a')) and purpose = 'service_followup'));
select pg_temp.rec('detect', 'a four day old welcome is stale, not queued', 'skipped/stale',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'welcome_1'));
select pg_temp.rec('detect', 'a stalled sign-up found late has its FIRST email due now (not stale)', 'scheduled',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));
select pg_temp.rec('detect', 'and its first email is due at or before now', 'true',
  (select (fr.scheduled_for <= now())::text from public.fd_followup_runs fr join public.fd_sequence_steps st on st.id = fr.step_id
    where fr.contact_id = pg_temp.contact_of(pg_temp.f('a')) and st.step_key = 'finish_signup_1'));
select pg_temp.rec('detect', 'the onboarded account without a risk check gets the reminder', 'scheduled',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('b')), 'risk_check_1'));
select pg_temp.rec('detect', 'the new account gets the welcome, due now', 'scheduled',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('c')), 'welcome_1'));
select pg_temp.rec('detect', 'the funnel events are derived', 'true',
  (exists (select 1 from public.fd_funnel_events where event_type = 'account_created' and app_user_id = pg_temp.f('a'))
   and exists (select 1 from public.fd_funnel_events where event_type = 'onboarding_completed' and app_user_id = pg_temp.f('b')))::text);
create temp table runs_before(n bigint) on commit drop;
grant all on runs_before to public;
insert into runs_before select count(*) from public.fd_followup_runs;
select pg_temp.as_val(null, 'service_role', $q$select (public.service_fd_detect())::text$q$);
select pg_temp.rec('detect', 'a second sweep schedules nothing new (idempotent)', 'true', ((select count(*) from public.fd_followup_runs) = (select n from runs_before))::text);

-- 3. approval gate ----------------------------------------------------------------------------------------------------------------------------
select pg_temp.cfg('followups_dry_run', 'false'::jsonb);
select pg_temp.claim();
select pg_temp.rec('gate', 'NOTHING IS CLAIMED while every step is draft', '0', pg_temp.claimed_n());
select pg_temp.rec('gate', 'and the due runs are left scheduled, not consumed', 'scheduled',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));

-- 4. quiet hours ------------------------------------------------------------------------------------------------------------------------------
select pg_temp.approve('welcome_1'); select pg_temp.approve('welcome_2'); select pg_temp.approve('finish_signup_1');
select pg_temp.approve('risk_check_1'); select pg_temp.approve('reengage_1'); select pg_temp.approve('health_check_1');
select pg_temp.quiet_on();
select pg_temp.claim();
select pg_temp.rec('quiet', 'inside quiet hours nothing is claimed', '0', pg_temp.claimed_n());
select pg_temp.rec('quiet', 'and nothing is consumed', 'scheduled', pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));
select pg_temp.quiet_off();

-- 5. dry-run ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.cfg('followups_dry_run', 'true'::jsonb);
select pg_temp.claim();
select pg_temp.rec('dryrun', 'in dry-run nothing is claimed', '0', pg_temp.claimed_n());
select pg_temp.rec('dryrun', 'the held-back run is recorded as skipped/dry_run, flagged', 'skipped/dry_run',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));
select pg_temp.rec('dryrun', 'a patient cannot re-arm', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select public.fd_rearm_dry_run_runs()::text'));
select pg_temp.rec('dryrun', 'anon cannot re-arm', 'ERR:42501', pg_temp.as_val(null, 'anon', 'select public.fd_rearm_dry_run_runs()::text'));
select pg_temp.rec('dryrun', 'an admin re-arms the held-back runs', 'true',
  (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.fd_rearm_dry_run_runs()::text')::int >= 3)::text);
select pg_temp.rec('dryrun', 'they are scheduled again', 'scheduled', pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));
select pg_temp.cfg('followups_dry_run', '"maybe"'::jsonb);
select pg_temp.claim();
select pg_temp.rec('dryrun', 'a non-boolean dry-run setting is treated as dry-run (fail safe)', '0', pg_temp.claimed_n());
select pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select public.fd_rearm_dry_run_runs()::text');

-- 6. exactly once -----------------------------------------------------------------------------------------------------------------------------
select pg_temp.cfg('followups_dry_run', 'false'::jsonb);
select pg_temp.claim();
select pg_temp.rec('once', 'going live claims one run for each of the three contacts', '3', pg_temp.claimed_n());
select pg_temp.rec('once', 'the right steps (A finish_signup_1, B risk_check_1, C welcome_1)', 'finish_signup_1,risk_check_1,welcome_1', pg_temp.claimed_steps());
create temp table first_claim(j jsonb) on commit drop;
grant all on first_claim to public;
insert into first_claim select j from lastclaim;
select pg_temp.rec('once', 'the contact''s other due run (A welcome_2) waits behind the minimum gap', 'scheduled',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'welcome_2'));
select pg_temp.claim();
select pg_temp.rec('once', 'an immediate second claim returns nothing (no double send)', '0', pg_temp.claimed_n());
select public.service_fd_finish_run((x ->> 'r')::uuid, true, 'msg-' || (x ->> 's'), null) from first_claim, jsonb_array_elements(j) x;
select pg_temp.rec('once', 'finished runs are sent', 'sent', pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'finish_signup_1'));
select pg_temp.rec('once', 'and the contact''s last_contacted_at is stamped', 'true',
  (select (last_contacted_at is not null)::text from public.fd_contacts where id = pg_temp.contact_of(pg_temp.f('a'))));
select pg_temp.claim();
select pg_temp.rec('once', 'inside 12 hours nothing more is due for anyone', '0', pg_temp.claimed_n());

-- 7. caps, pause, unapproved, stale -------------------------------------------------------------------------------------------------------
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id in
  (pg_temp.contact_of(pg_temp.f('a')), pg_temp.contact_of(pg_temp.f('b')), pg_temp.contact_of(pg_temp.f('c')));
select pg_temp.cfg('weekly_send_cap', '1'::jsonb);
select pg_temp.claim();
select pg_temp.rec('caps', 'over the weekly cap the due run is skipped, not sent', 'skipped/weekly_cap',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('a')), 'welcome_2'));
select pg_temp.cfg('weekly_send_cap', '3'::jsonb);

-- pause, unapproved wording and staleness, on a dedicated enrolment for B (cancelled afterwards so it cannot disturb later checks)
select private.fd_enrol(pg_temp.contact_of(pg_temp.f('b')), 'welcome', now() - interval '1 hour', 'pause:1');
select pg_temp.approve('welcome_1');
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id = pg_temp.contact_of(pg_temp.f('b'));
update public.fd_sequences set paused = true where key = 'welcome';
select pg_temp.claim();
select pg_temp.rec('caps', 'a paused sequence is deferred, not claimed and not dropped', 'scheduled',
  pg_temp.run_state_key(pg_temp.contact_of(pg_temp.f('b')), 'welcome_1', 'pause:1'));
update public.fd_sequences set paused = false where key = 'welcome';
update public.fd_followup_runs fr set scheduled_for = now() - interval '1 hour'
  from public.fd_sequence_steps st where st.id = fr.step_id and st.step_key = 'welcome_3' and fr.enrolment_key = 'pause:1';
select pg_temp.claim();
select pg_temp.rec('caps', 'unapproved wording is deferred, not claimed and not dropped', 'scheduled',
  pg_temp.run_state_key(pg_temp.contact_of(pg_temp.f('b')), 'welcome_3', 'pause:1'));
-- the unpause above let welcome_1 be claimed (correct); clear it so the 12 hour gap does not hide the staleness check
update public.fd_followup_runs set state = 'cancelled' where contact_id = pg_temp.contact_of(pg_temp.f('b')) and state = 'sending';
update public.fd_followup_runs fr set scheduled_for = now() - interval '4 days'
  from public.fd_sequence_steps st where st.id = fr.step_id and st.step_key = 'welcome_2' and fr.enrolment_key = 'pause:1';
select pg_temp.claim();
select pg_temp.rec('caps', 'a run overdue by more than 3 days is skipped as stale at send time', 'skipped/stale',
  pg_temp.run_state_key(pg_temp.contact_of(pg_temp.f('b')), 'welcome_2', 'pause:1'));
update public.fd_followup_runs set state = 'cancelled' where enrolment_key = 'pause:1' and state in ('scheduled', 'sending');
update public.fd_followup_runs set state = 'cancelled' where contact_id = pg_temp.contact_of(pg_temp.f('b')) and state = 'sending';

-- 8. completion stops it ----------------------------------------------------------------------------------------------------------------------
insert into public.patient_risk_scores (organisation_id, patient_id, score_type, score, risk_level)
select organisation_id, id, 'proof_check', 1, 'low'::public.risk_level from public.profiles where id = pg_temp.f('b');
select pg_temp.approve('risk_check_2');
update public.fd_followup_runs fr set scheduled_for = now() - interval '1 hour'
 from public.fd_sequence_steps st where st.id = fr.step_id and st.step_key = 'risk_check_2' and fr.contact_id = pg_temp.contact_of(pg_temp.f('b'));
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id = pg_temp.contact_of(pg_temp.f('b'));
select pg_temp.claim();
select pg_temp.rec('goal', 'a risk score makes the reminder goal_reached at send time (no email)', 'skipped/goal_reached',
  pg_temp.run_state(pg_temp.contact_of(pg_temp.f('b')), 'risk_check_2'));
select pg_temp.rec('goal', 'and it was not claimed', 'false', (pg_temp.claimed_steps() like '%risk_check_2%')::text);

alter table public.profiles disable trigger profiles_enforce_onboarding_prereqs;
update public.profiles set onboarding_completed_at = now() where id = pg_temp.f('a');
alter table public.profiles enable trigger profiles_enforce_onboarding_prereqs;
select pg_temp.as_val(null, 'service_role', $q$select (public.service_fd_detect())::text$q$);
select pg_temp.rec('goal', 'finishing onboarding makes the detector cancel A''s remaining finish_signup runs', '0',
  (select count(*)::text from public.fd_followup_runs fr join public.fd_sequences s on s.id = fr.sequence_id
    where fr.contact_id = pg_temp.contact_of(pg_temp.f('a')) and s.key = 'finish_signup' and fr.state = 'scheduled'));

-- 9. unsubscribe and bounce -------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('suppress', 'anon cannot unsubscribe a contact', 'ERR:42501',
  pg_temp.as_val(null, 'anon', format($q$select public.service_fd_unsubscribe(%L)::text$q$, pg_temp.contact_of(pg_temp.f('c')))));
select pg_temp.as_val(null, 'service_role', format($q$select public.service_fd_unsubscribe(%L)::text$q$, pg_temp.contact_of(pg_temp.f('c'))));
select pg_temp.rec('suppress', 'unsubscribe suppresses the contact with a reason', 'true/unsubscribed',
  (select suppressed::text || '/' || suppressed_reason from public.fd_contacts where id = pg_temp.contact_of(pg_temp.f('c'))));
select pg_temp.rec('suppress', 'and withdraws every consent', '0',
  (select count(*)::text from public.fd_consents where contact_id = pg_temp.contact_of(pg_temp.f('c')) and withdrawn_at is null));
select pg_temp.rec('suppress', 'and cancels scheduled runs', '0',
  (select count(*)::text from public.fd_followup_runs where contact_id = pg_temp.contact_of(pg_temp.f('c')) and state in ('scheduled', 'sending')));
select pg_temp.rec('suppress', 'and the sweep schedules nothing for them again', '0',
  (select private.fd_enrol(pg_temp.contact_of(pg_temp.f('c')), 'welcome', now(), 'again:1'))::text);
select pg_temp.rec('suppress', 'the unsubscribe is audited', 'true',
  (select exists (select 1 from public.fd_audit_log where action = 'suppress' and entity_id = pg_temp.contact_of(pg_temp.f('c'))::text)::text));

insert into public.notification_email_suppressions (email, reason)
select email, 'bounced' from public.fd_contacts where id = pg_temp.contact_of(pg_temp.f('a'));
select pg_temp.rec('suppress', 'a bounce recorded by the Resend webhook table suppresses the front desk contact', 'true/bounced',
  (select suppressed::text || '/' || suppressed_reason from public.fd_contacts where id = pg_temp.contact_of(pg_temp.f('a'))));

-- 10. consent ---------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('consent', 'a marketing sequence is NOT started for a contact with only follow-up consent', '0',
  (select private.fd_enrol(pg_temp.contact_of(pg_temp.f('b')), 'reengage_7d', now(), 'reeng:proof'))::text);
select private.fd_record_consent(pg_temp.contact_of(pg_temp.f('b')), 'email', 'marketing', 'consent', 'marketing-v1', 'proof marketing wording', 'proof');
select pg_temp.rec('consent', 'with marketing consent it is started', 'true',
  ((select private.fd_enrol(pg_temp.contact_of(pg_temp.f('b')), 'reengage_7d', now(), 'reeng:proof')) > 0)::text);
update public.fd_consents set withdrawn_at = now() where contact_id = pg_temp.contact_of(pg_temp.f('b')) and purpose = 'marketing';
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id = pg_temp.contact_of(pg_temp.f('b'));
select pg_temp.claim();
select pg_temp.rec('consent', 'withdrawing the marketing consent skips the send', 'skipped/no_consent',
  pg_temp.run_state_key(pg_temp.contact_of(pg_temp.f('b')), 'reengage_1', 'reeng:proof'));

-- 10b. the platform's own marketing opt-out (profiles.marketing_opt_in, the broadcast unsubscribe) is honoured by marketing follow-ups
select private.fd_record_consent(pg_temp.contact_of(pg_temp.f('b')), 'email', 'marketing', 'consent', 'marketing-v1', 'proof marketing wording', 'proof');
select private.fd_enrol(pg_temp.contact_of(pg_temp.f('b')), 'reengage_7d', now(), 'reeng:optout');
update public.profiles set marketing_opt_in = false where id = pg_temp.f('b');
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id = pg_temp.contact_of(pg_temp.f('b'));
select pg_temp.claim();
select pg_temp.rec('optout', 'a marketing follow-up is skipped when the person opted out of marketing elsewhere', 'skipped/opted_out',
  pg_temp.run_state_key(pg_temp.contact_of(pg_temp.f('b')), 'reengage_1', 'reeng:optout'));
select pg_temp.rec('optout', 'unsubscribing here also clears the platform marketing flag', 'false',
  (select marketing_opt_in::text from public.profiles where id = pg_temp.f('c')));

-- 10c. an event recorded before the contact existed (only an app user id) still counts for the goal check
insert into public.fd_funnel_events (contact_id, app_user_id, event_type, dedupe_key) values (null, pg_temp.f('b'), 'checkout_started', 'orphan-event-proof-1');
select pg_temp.rec('orphan', 'an event with no contact id but the same app user stops the sequence', 'true',
  (select private.fd_goal_reached(pg_temp.contact_of(pg_temp.f('b')), array['checkout_started'], now() - interval '1 day'))::text);
select pg_temp.rec('orphan', 'CONTROL another user''s event does not', 'false',
  (select private.fd_goal_reached(pg_temp.contact_of(pg_temp.f('c')), array['checkout_started'], now() - interval '1 day'))::text);

-- 11. app events ------------------------------------------------------------------------------------------------------------------------------
insert into public.fd_contacts (email, app_user_id, source) select lower(u.email), pg_temp.f('f'), 'app_signup' from auth.users u where u.id = pg_temp.f('f') on conflict do nothing;
select private.fd_record_consent(pg_temp.contact_of(pg_temp.f('f')), 'email', 'marketing', 'consent', 'marketing-v1', 'proof marketing wording', 'proof');
select private.fd_enrol(pg_temp.contact_of(pg_temp.f('f')), 'health_check_interest', now(), 'hc:proof');
select pg_temp.rec('events', 'health_check_interest is scheduled for an interested contact', '2',
  (select count(*)::text from public.fd_followup_runs where contact_id = pg_temp.contact_of(pg_temp.f('f')) and state = 'scheduled'));
select pg_temp.rec('events', 'an unknown event type is refused', 'false',
  (pg_temp.as_val(null, 'service_role', format($q$select (public.service_fd_record_event(%L, 'made_up', null, 'key-unknown-1')->>'recorded')$q$, pg_temp.f('f')))));
select pg_temp.rec('events', 'checkout_started is recorded and cancels the sequence''s scheduled runs', '2',
  pg_temp.as_val(null, 'service_role', format($q$select (public.service_fd_record_event(%L, 'checkout_started', null, 'key-checkout-1')->>'cancelled')$q$, pg_temp.f('f'))));
select pg_temp.rec('events', 'the same event twice records once', '1',
  (select count(*)::text from public.fd_funnel_events where dedupe_key = 'key-checkout-1'));

-- 12. access ----------------------------------------------------------------------------------------------------------------------------------
select pg_temp.rec('access', 'a patient cannot claim', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.service_fd_claim_runs(1)'));
select pg_temp.rec('access', 'an admin cannot claim either (service role only)', 'ERR:42501', pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select count(*)::text from public.service_fd_claim_runs(1)'));
select pg_temp.rec('access', 'anon cannot run the detector', 'ERR:42501', pg_temp.as_val(null, 'anon', 'select (public.service_fd_detect())::text'));
select pg_temp.rec('access', 'a patient cannot finish a run', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', format($q$select public.service_fd_finish_run(%L, true, 'x', null)::text$q$, gen_random_uuid())));
select pg_temp.rec('access', 'a patient cannot read the overview', 'ERR:42501', pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select (public.fd_followup_overview())::text'));
select pg_temp.rec('access', 'an admin reads the overview, emails masked', 'true',
  (pg_temp.as_val(pg_temp.f('admin'), 'authenticated', 'select (public.fd_followup_overview())::text') like '%***@%')::text);

-- 13. SABOTAGE (expected = healthy value; a flip is the proof the check can fail) --------------------------------------------------------------
grant execute on function public.service_fd_claim_runs(integer) to authenticated;
select pg_temp.rec('sabotage', 'SABOTAGE (a): claim granted to authenticated, a patient can now claim', 'ERR:42501',
  pg_temp.as_val(pg_temp.f('pat'), 'authenticated', 'select count(*)::text from public.service_fd_claim_runs(1)'));

drop trigger fd_on_email_suppressed on public.notification_email_suppressions;
insert into public.fd_contacts (email, source) values ('fd2-bounce-sab@example.invalid', 'import');
insert into public.notification_email_suppressions (email, reason) values ('fd2-bounce-sab@example.invalid', 'complained');
select pg_temp.rec('sabotage', 'SABOTAGE (b): bounce trigger dropped, a complaint no longer suppresses the contact', 'true',
  (select suppressed::text from public.fd_contacts where email = 'fd2-bounce-sab@example.invalid'));

-- (c) the goal check made blind: a contact who already finished the goal is mailed anyway.
select private.fd_record_consent(pg_temp.contact_of(pg_temp.f('b')), 'email', 'service_followup', 'contract', 'account-followup-v1', 'x', 'proof');
insert into public.fd_followup_runs (contact_id, sequence_id, step_id, enrolment_key, state, scheduled_for)
select pg_temp.contact_of(pg_temp.f('b')), s.id, st.id, 'sab-goal', 'scheduled', now() - interval '1 hour'
  from public.fd_sequences s join public.fd_sequence_steps st on st.sequence_id = s.id and st.step_key = 'risk_check_1' where s.key = 'risk_check_nudge';
update public.fd_followup_runs set sent_at = now() - interval '13 hours' where state = 'sent' and contact_id = pg_temp.contact_of(pg_temp.f('b'));
create or replace function private.fd_goal_reached(p_contact uuid, p_stops text[], p_since timestamptz) returns boolean language sql as $$ select false $$;
select pg_temp.claim();
select pg_temp.rec('sabotage', 'SABOTAGE (c): goal check made blind, a finished contact is claimed for a send', 'skipped/goal_reached',
  (select string_agg(state || coalesce('/' || skip_reason, ''), ',') from public.fd_followup_runs where enrolment_key = 'sab-goal'));

-- Verdict ---------------------------------------------------------------------------------------------------------------------------------------
select phase, check_name, expected, actual,
       case when phase = 'sabotage' then case when expected is distinct from actual then 'PASS (caught)' else 'FAIL (sabotage not detected)' end
            when expected = actual then 'PASS' else 'FAIL' end as verdict
  from results order by phase, check_name;

do $$
declare v_bad int; v_first text;
begin
  select count(*), min(check_name) into v_bad, v_first from results
   where (phase <> 'sabotage' and expected is distinct from actual) or (phase = 'sabotage' and expected is not distinct from actual);
  if v_bad > 0 then raise exception 'fd M2 proof: % check(s) failed, first: %', v_bad, v_first; end if;
end $$;

rollback;

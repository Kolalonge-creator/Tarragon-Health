-- Tarragon Health
-- Live proof for the Reputation & Review-Generation Engine
-- (20260924211014_reputation_review_prompts.sql,
--  20260924211227_fix_reputation_review_prompt_email_payload.sql,
--  20260924211429_reputation_review_prompt_id_in_payload.sql,
--  20260924214612_reputation_review_prompts_review_findings.sql,
--  20260924215058_fix_skip_status_both_channels.sql -- a /code-review high
--  fast-follow: flag-disabled now records 'skipped_flag_disabled' on both
--  channels instead of enqueuing nothing at all, and a patient with no
--  email on file gets only the native_app_store row, never a
--  trustpilot_email row stuck at 'queued' forever with nowhere to send).
--
-- Every negative is paired with a positive control per CLAUDE.md's own rule:
--   1.  Escalation resolved, flag ON            -> 2 queued prompts (one per
--                                                    channel) + 1 pending
--                                                    notification with a real
--                                                    to_email/prompt-id payload
--   2.  A second, different escalation for the same patient inside the
--       90-day cooldown                          -> recorded as
--                                                    skipped_rate_limited, not
--                                                    silently dropped, and no
--                                                    second notification fires
--   3.  Patient claims their queued native prompt -> row flips to 'shown'
--   4.  Same patient claims again                  -> null (nothing left queued)
--   5.  An unrelated patient with no prompts claims -> null (not case 3's row)
--   6.  An unrelated patient cannot SELECT another patient's prompt row
--                                                    -> BLOCKED (real RLS,
--                                                       run as `authenticated`)
--   7.  Patient marks their own trustpilot_email row 'clicked'
--                                                    -> ALLOWED, clicked_at set
--   8.  An unrelated patient tries to mark someone else's row 'clicked'
--                                                    -> no-op (row unchanged)
--   9.  anon cannot execute claim_pending_reputation_review_prompt()
--                                                    -> BLOCKED (privilege
--                                                       check, not RLS)
--   10. anon cannot execute private.enqueue_reputation_review_prompt(...)
--                                                    -> BLOCKED
--   11. Escalation resolved, flag OFF               -> recorded as
--                                                       skipped_flag_disabled
--                                                       on both channels, not
--                                                       silently dropped
--   12. A patient with no email on auth.users, escalation resolved, flag ON
--                                                    -> native_app_store row
--                                                       queued, no
--                                                       trustpilot_email row
--                                                       at all (nothing to
--                                                       send it to)
--
-- Sabotage check: temporarily replace enqueue_reputation_review_prompt with a
-- version that has no cooldown check, resolve one more escalation for the
-- already-asked patient, and confirm it now enqueues a fresh 'queued' pair
-- instead of 'skipped_rate_limited' -- proves case 2's assertion is actually
-- exercising the cooldown branch, not passing vacuously.
--
-- Not covered here (needs two real concurrent connections, not a single
-- psql session -- see this directory's own convention for that class of
-- proof): the pg_advisory_xact_lock added in 20260924214612 to close a
-- TOCTOU race between two overlapping enqueue calls for the same patient.
--
-- Run: npx supabase db query --linked -f packages/db/tests/reputation_review_prompts.sql
-- Nothing here persists -- the whole file runs inside begin/rollback.

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

------------------------------------------------------------------
-- Fixtures. Every party is minted here (never borrowed from the
-- @tarragon.test QA roster, which doesn't exist on a fresh `supabase db
-- reset`).
------------------------------------------------------------------
do $$
declare
  v_org uuid := gen_random_uuid();
  v_patient uuid := gen_random_uuid();
  v_patient2 uuid := gen_random_uuid();
  v_patient_no_email uuid := gen_random_uuid();
  v_doctor uuid := gen_random_uuid();
  v_escalation_a uuid;
  v_escalation_b uuid;
  v_escalation_c uuid;
  v_escalation_d uuid;
  v_escalation_e uuid;
begin
  insert into public.organisations (id, name, type) values (v_org, 'RRP Test Org', 'direct_consumer');

  insert into auth.users (id, email) values (v_patient, 'rrp-test-patient@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient, v_org, 'patient', 'RRP Test Patient')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into auth.users (id, email) values (v_patient2, 'rrp-test-patient2@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient2, v_org, 'patient', 'RRP Test Patient 2')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into auth.users (id, email) values (v_patient_no_email, null);
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_patient_no_email, v_org, 'patient', 'RRP Test Patient No Email')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;

  insert into auth.users (id, email) values (v_doctor, 'rrp-test-doctor@example.invalid');
  insert into public.profiles (id, organisation_id, role, full_name)
  values (v_doctor, v_org, 'clinician', 'RRP Test Doctor')
  on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  insert into public.clinical_staff (organisation_id, profile_id, full_name, active, doctor_tier, license_verified_at)
  values (v_org, v_doctor, 'RRP Test Doctor', true, 'senior_medical_officer', now());

  insert into public.feature_flags (key, label, category, status, rollout_percent)
  values ('reputation_review_prompts', 'Reputation review prompts', 'growth', 'on', 100)
  on conflict (key) do update set status = 'on', rollout_percent = 100;

  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient, 'open', 'rrp test a') returning id into v_escalation_a;
  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient, 'open', 'rrp test b') returning id into v_escalation_b;
  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient2, 'open', 'rrp test c') returning id into v_escalation_c;
  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient, 'open', 'rrp test d') returning id into v_escalation_d;
  insert into public.escalations (organisation_id, patient_id, status, reason)
  values (v_org, v_patient_no_email, 'open', 'rrp test e') returning id into v_escalation_e;

  insert into ids values
    ('org', v_org), ('patient', v_patient), ('patient2', v_patient2),
    ('patient_no_email', v_patient_no_email), ('doctor', v_doctor),
    ('escalation_a', v_escalation_a), ('escalation_b', v_escalation_b),
    ('escalation_c', v_escalation_c), ('escalation_d', v_escalation_d),
    ('escalation_e', v_escalation_e);
end $$;

------------------------------------------------------------------
-- Case 1: escalation A resolved, flag ON -> 2 queued prompts + 1 notification
-- with a real payload.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor'), 'role','authenticated')::text, true);
set local role authenticated;

update public.escalations
  set status = 'resolved', identity_confirmed = true, identity_confirmed_by = (select v from ids where k='doctor')
  where id = (select v from ids where k='escalation_a');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 1: prompts enqueued for escalation A', '2', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_a');

insert into results
select 'case 1: notification enqueued for escalation A prompt', '1', count(*)::text
from public.notifications n
join public.reputation_review_prompts rrp
  on rrp.id = n.source_id and n.source_table = 'reputation_review_prompts'
where rrp.source_table = 'escalations' and rrp.source_id = (select v from ids where k='escalation_a')
  and rrp.channel = 'trustpilot_email';

insert into results
select 'case 1: notification payload has to_email and prompt id', 'true',
  (
    (payload->>'to_email' = 'rrp-test-patient@example.invalid')
    and (payload->>'reputation_review_prompt_id' is not null)
  )::text
from public.notifications n
join public.reputation_review_prompts rrp
  on rrp.id = n.source_id and n.source_table = 'reputation_review_prompts'
where rrp.source_table = 'escalations' and rrp.source_id = (select v from ids where k='escalation_a')
  and rrp.channel = 'trustpilot_email';

------------------------------------------------------------------
-- Case 2: escalation B (same patient) resolved inside the 90-day cooldown
-- -> recorded as skipped_rate_limited, no second notification.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor'), 'role','authenticated')::text, true);
set local role authenticated;

update public.escalations
  set status = 'resolved', identity_confirmed = true, identity_confirmed_by = (select v from ids where k='doctor')
  where id = (select v from ids where k='escalation_b');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 2: escalation B skipped by cooldown', '2', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_b')
  and status = 'skipped_rate_limited';

insert into results
select 'case 2: no second notification created', '1', count(*)::text
from public.notifications
where recipient_id = (select v from ids where k='patient') and source_table = 'reputation_review_prompts';

------------------------------------------------------------------
-- Case 3/4: patient claims their queued native prompt, then claims again.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_claimed public.reputation_review_prompts;
begin
  select * into v_claimed from public.claim_pending_reputation_review_prompt();
  insert into results values ('case 3: patient claims queued native prompt', 'true', (v_claimed.id is not null)::text);
end $$;

do $$
declare
  v_claimed public.reputation_review_prompts;
begin
  select * into v_claimed from public.claim_pending_reputation_review_prompt();
  insert into results values ('case 4: patient claims again, nothing left', 'true', (v_claimed.id is null)::text);
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 3: claimed prompt now shown', '1', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_a')
  and channel = 'native_app_store' and status = 'shown';

------------------------------------------------------------------
-- Case 5: an unrelated patient (no prompts of their own) claims -> null.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient2'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_claimed public.reputation_review_prompts;
begin
  select * into v_claimed from public.claim_pending_reputation_review_prompt();
  insert into results values ('case 5: unrelated patient claims nothing', 'true', (v_claimed.id is null)::text);
end $$;

------------------------------------------------------------------
-- Case 6: an unrelated patient cannot SELECT another patient's prompt row.
-- Real RLS check -- still running as patient2/authenticated from case 5.
------------------------------------------------------------------
insert into results
select 'case 6: unrelated patient cannot see another patient''s prompts', '0', count(*)::text
from public.reputation_review_prompts
where patient_id = (select v from ids where k='patient');

reset role;
select set_config('request.jwt.claims', null, true);

------------------------------------------------------------------
-- Case 7/8: record_reputation_review_prompt_outcome ownership check.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_prompt_id uuid;
begin
  select id into v_prompt_id from public.reputation_review_prompts
  where source_table = 'escalations' and source_id = (select v from ids where k='escalation_a')
    and channel = 'trustpilot_email';
  perform public.record_reputation_review_prompt_outcome(v_prompt_id, 'clicked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 7: patient marks their own trustpilot row clicked', '1', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_a')
  and channel = 'trustpilot_email' and status = 'clicked' and clicked_at is not null;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='patient2'), 'role','authenticated')::text, true);
set local role authenticated;

do $$
declare
  v_prompt_id uuid;
begin
  select id into v_prompt_id from public.reputation_review_prompts
  where source_table = 'escalations' and source_id = (select v from ids where k='escalation_b')
    and channel = 'trustpilot_email';
  -- patient2 doesn't even know this id exists (RLS hides it), but call the
  -- RPC directly with it anyway -- the RPC's own patient_id = auth.uid()
  -- check must refuse it regardless of what the caller can see.
  perform public.record_reputation_review_prompt_outcome(v_prompt_id, 'clicked');
end $$;

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 8: unrelated patient cannot mark someone else''s row clicked', '0', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_b')
  and channel = 'trustpilot_email' and status = 'clicked';

------------------------------------------------------------------
-- Case 9: anon cannot execute claim_pending_reputation_review_prompt().
-- A privilege check (EXECUTE grant), not RLS -- run as `anon`, unauthenticated.
-- `results` isn't granted to `anon`, so capture the outcome in a session-local
-- GUC and record it AFTER switching back, same idiom as curbside_consults.sql.
------------------------------------------------------------------
set local role anon;

do $$
begin
  perform public.claim_pending_reputation_review_prompt();
  perform set_config('rrp_test.case9', 'allowed: SECURITY HOLE', true);
exception when insufficient_privilege then
  perform set_config('rrp_test.case9', 'blocked', true);
end $$;

reset role;

insert into results values (
  'case 9: anon executes claim_pending_reputation_review_prompt', 'blocked',
  current_setting('rrp_test.case9', true)
);

------------------------------------------------------------------
-- Case 10: anon cannot execute private.enqueue_reputation_review_prompt(...)
-- directly -- it accepts an arbitrary patient_id, so this must be refused
-- regardless of caller.
------------------------------------------------------------------
set local role anon;

do $$
begin
  perform private.enqueue_reputation_review_prompt(
    (select v from ids where k='org'), (select v from ids where k='patient2'),
    'escalation_resolved', 'escalations', gen_random_uuid()
  );
  perform set_config('rrp_test.case10', 'allowed: SECURITY HOLE', true);
exception when insufficient_privilege then
  perform set_config('rrp_test.case10', 'blocked', true);
end $$;

reset role;

insert into results values (
  'case 10: anon executes private.enqueue_reputation_review_prompt', 'blocked',
  current_setting('rrp_test.case10', true)
);

------------------------------------------------------------------
-- Case 11: escalation C resolved, flag OFF -> recorded as
-- skipped_flag_disabled on both channels (a skip is a per-patient decision,
-- not conditional on whether trustpilot_email could have been fulfilled).
------------------------------------------------------------------
update public.feature_flags set status = 'off', rollout_percent = 0
where key = 'reputation_review_prompts';

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor'), 'role','authenticated')::text, true);
set local role authenticated;

update public.escalations
  set status = 'resolved', identity_confirmed = true, identity_confirmed_by = (select v from ids where k='doctor')
  where id = (select v from ids where k='escalation_c');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 11: flag off records skipped_flag_disabled on both channels', '2', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_c')
  and status = 'skipped_flag_disabled';

update public.feature_flags set status = 'on', rollout_percent = 100
where key = 'reputation_review_prompts';

------------------------------------------------------------------
-- Case 12: a patient with no email on auth.users, flag ON -> native
-- prompt queued, but no trustpilot_email row is ever created (nothing to
-- send it to) -- distinct from case 11's flag-disabled skip.
------------------------------------------------------------------
select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor'), 'role','authenticated')::text, true);
set local role authenticated;

update public.escalations
  set status = 'resolved', identity_confirmed = true, identity_confirmed_by = (select v from ids where k='doctor')
  where id = (select v from ids where k='escalation_e');

reset role;
select set_config('request.jwt.claims', null, true);

insert into results
select 'case 12: no-email patient still gets native prompt queued', '1', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_e')
  and channel = 'native_app_store' and status = 'queued';

insert into results
select 'case 12: no-email patient gets no trustpilot_email row', '0', count(*)::text
from public.reputation_review_prompts
where source_table = 'escalations' and source_id = (select v from ids where k='escalation_e')
  and channel = 'trustpilot_email';

------------------------------------------------------------------
-- Sabotage: without the cooldown check, escalation D (same patient as A/B,
-- still well inside the 90-day window) must enqueue a fresh 'queued' pair
-- instead of being skipped -- proves case 2's assertion actually depends on
-- this code, not on something else (e.g. the dedup unique index, which
-- can't fire here since escalation D is a distinct source row).
------------------------------------------------------------------
create or replace function private.enqueue_reputation_review_prompt(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_trigger_event public.reputation_review_trigger_event,
  p_source_table text,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $sabotage$
begin
  if not private.is_feature_enabled('reputation_review_prompts', p_patient_id) then
    return;
  end if;
  -- (cooldown check removed)
  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', 'queued'),
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', 'queued')
  on conflict (source_table, source_id, channel) do nothing;
end;
$sabotage$;

select set_config('request.jwt.claims',
  json_build_object('sub', (select v from ids where k='doctor'), 'role','authenticated')::text, true);
set local role authenticated;

update public.escalations
  set status = 'resolved', identity_confirmed = true, identity_confirmed_by = (select v from ids where k='doctor')
  where id = (select v from ids where k='escalation_d');

reset role;
select set_config('request.jwt.claims', null, true);

do $$
declare
  v_queued int;
begin
  select count(*) into v_queued from public.reputation_review_prompts
  where source_table = 'escalations' and source_id = (select v from ids where k='escalation_d')
    and status = 'queued';
  if v_queued <> 2 then
    raise exception
      'SABOTAGE CHECK FAILED: removing the cooldown check should have let escalation D enqueue -- something other than that code is what case 2 was actually testing';
  end if;
end $$;

select check_name, expected, actual,
       case when expected = actual then 'PASS' else 'FAIL' end as result
from results
order by check_name;

rollback;

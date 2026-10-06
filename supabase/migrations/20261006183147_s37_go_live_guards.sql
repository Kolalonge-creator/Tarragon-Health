-- S37: go-live guards (spec section 14, INV-14) and the PROPOSED-config sign-off record (spec section 17).
--
-- WHY A NEW TABLE AND NOT platform_modules (OQ-18 said to reuse it): platform_modules is switched by
-- set_platform_module(), which needs only a superadmin and a note and never looks at the data, and its row can be
-- updated by the table owner. A go-live guard has to be switchable ONLY by a function that evaluates its condition
-- against real data and records who, when and why in an append-only log. platform_modules is left exactly as it is
-- (it still serves the dormant payer, provider and NGO platforms). Recorded as OQ-180.
--
-- WHAT IS WIRED IN THIS MIGRATION, and nothing else:
--   clinical_operations_enabled -> hold_appointment_slot, confirm_appointment_booking, service_get_encounter_room
--                                  (consultations only: appointment types telemedicine and result_interpretation), and the
--                                  older video-visit request path (insert trigger on video_visit_requests,
--                                  accept_video_visit_request, select_video_visit_alternate_slot): without it a patient could
--                                  still reach a consultation around the booking functions. 0 rows ever in video_visit_requests.
--                                  NOT wired: lab_result_consult_requests (1 real cancelled request exists: a live flow,
--                                  left running; see OQ-184).
--   scribe_enabled              -> scribe_may_start
-- Every other guard is a recorded row whose conditions are evaluated for the dashboard but which blocks nothing yet.
-- Clinical tasks (S16), credentialing (S15) and the rota and paging (S18, S19) are live today and are deliberately NOT
-- put behind a guard here: that would switch off running behaviour. See docs/design/S37.md.
--
-- LIVE COUNTS CHECKED 2026-10-06 (read-only) BEFORE WRITING: appointments 0 rows ever, encounters 0, scribe consents 0,
-- scribe transcripts 0. So refusing a consultation hold while the guard is off changes no existing patient's behaviour.
-- Live conditions today: protocols 0 rows, triage rule sets 2 drafts and 0 approved, 1 active tier 2 SMO and 1 CMO,
-- no pharmacy partner active, rota empty. So clinical_operations_enabled and prescribing_enabled cannot be switched on yet.
--
-- TEST PAIR RULE: a booking where BOTH the patient and the clinician are is_test accounts passes the guard, so the
-- consultation flow can be exercised end to end with test accounts before the guard is on, and so the existing proofs
-- (which use test accounts only) keep their meaning. A real person is never reachable through it.
--
-- Read live definitions with pg_get_functiondef on 2026-10-06 before replacing hold_appointment_slot,
-- confirm_appointment_booking, service_get_encounter_room and scribe_may_start. Each repeats the live body plus one
-- change marked "S37".

-- ---------------------------------------------------------------------------
-- 1. The guards
-- ---------------------------------------------------------------------------
create table public.go_live_guards (
  key              text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label            text not null,
  blocks           text not null,
  condition_text   text not null,
  switch_role      text not null check (switch_role in ('admin', 'cmo')),
  enforced_in      text[] not null default '{}',
  not_enforced_in  text not null default '',
  is_on            boolean not null default false,
  changed_at       timestamptz,
  changed_by       uuid references public.profiles (id) on delete restrict,
  change_note      text,
  created_at       timestamptz not null default now(),
  constraint go_live_guards_on_has_attribution
    check (not is_on or (changed_at is not null and changed_by is not null and nullif(btrim(change_note), '') is not null))
);
comment on table public.go_live_guards is
  'S37 (INV-14, spec 14). One row per go-live guard. is_on, changed_at, changed_by and change_note change only through public.set_go_live_guard(), which evaluates the condition and writes go_live_guard_log in the same transaction; a trigger refuses any other change, including by the table owner.';

create table public.go_live_guard_log (
  id          bigint generated always as identity primary key,
  guard_key   text not null references public.go_live_guards (key) on delete restrict,
  action      text not null check (action in ('switched_on', 'switched_off')),
  actor_id    uuid not null references public.profiles (id) on delete restrict,
  actor_role  text not null check (actor_role in ('admin', 'cmo')),
  note        text,
  conditions  jsonb not null default '[]'::jsonb,
  txid        bigint not null default txid_current(),
  created_at  timestamptz not null default clock_timestamp(),
  constraint go_live_guard_log_on_needs_note check (action <> 'switched_on' or nullif(btrim(note), '') is not null)
);
comment on table public.go_live_guard_log is 'S37: append-only record of every guard switch: who, when, why, and the conditions as they stood. Update, delete and truncate are refused for every role.';
create index go_live_guard_log_key_idx on public.go_live_guard_log (guard_key, id desc);

create table public.go_live_attestations (
  id             bigint generated always as identity primary key,
  guard_key      text not null references public.go_live_guards (key) on delete restrict,
  condition_code text not null,
  met            boolean not null,
  note           text not null check (length(btrim(note)) >= 10),
  attested_by    uuid not null references public.profiles (id) on delete restrict,
  created_at     timestamptz not null default clock_timestamp()
);
comment on table public.go_live_attestations is
  'S37: append-only human assertion for a condition the database cannot see (a legal review, a configured vendor, an approved fee schedule). The latest row per guard and condition counts; a later met = false withdraws it. Nothing is seeded: an attestation is somebody''s judgement.';
create index go_live_attestations_idx on public.go_live_attestations (guard_key, condition_code, id desc);

create table public.proposed_config_signoffs (
  id             bigint generated always as identity primary key,
  config_key     text not null check (config_key ~ '^[a-z][a-z0-9_.]*$'),
  config_version integer not null check (config_version >= 1),
  value_hash     text not null check (value_hash ~ '^[0-9a-f]{64}$'),
  owner          text not null check (owner in ('CMO', 'Founder', 'Founder and counsel')),
  decision       text not null check (decision in ('confirmed', 'changes_requested')),
  note           text,
  signed_by      uuid not null references public.profiles (id) on delete restrict,
  signed_at      timestamptz not null default clock_timestamp(),
  constraint proposed_config_signoffs_changes_need_note check (decision <> 'changes_requested' or nullif(btrim(note), '') is not null)
);
comment on table public.proposed_config_signoffs is
  'S37: append-only record of a person confirming (or asking to change) a PROPOSED configuration value. value_hash is the sha-256 of the value as it stood in packages/shared proposed-config, so a later edit of the value no longer counts as confirmed. Writing is only through record_proposed_config_signoff(), by the value''s owner. Nothing is seeded.';
create index proposed_config_signoffs_idx on public.proposed_config_signoffs (config_key, config_version, id desc);

-- Table privileges. The project's default privileges hand `authenticated` insert, update and delete on a new table, so the
-- revoke is explicit. Nobody writes any of these four tables directly; the functions below are the only door.
revoke all on public.go_live_guards, public.go_live_guard_log, public.go_live_attestations, public.proposed_config_signoffs from public, anon, authenticated;
-- Signed-in roles read only what the app shell needs (key, label, is_on, what it blocks). Who changed a guard, why, and where it is
-- enforced stay behind the admin and CMO function. Nothing writes these tables from the service role either.
grant select (key, label, blocks, is_on) on public.go_live_guards to authenticated;
revoke insert, update, delete, truncate on public.go_live_guards, public.go_live_guard_log, public.go_live_attestations, public.proposed_config_signoffs from service_role;

alter table public.go_live_guards enable row level security;
alter table public.go_live_guard_log enable row level security;
alter table public.go_live_attestations enable row level security;
alter table public.proposed_config_signoffs enable row level security;

-- A guard is a deployment fact, not patient data (the same stance as platform_modules): every signed-in role may read the
-- rows so the app shell can ask. Admin and the Chief Medical Officer read the log, the attestations and the sign-offs.
create policy go_live_guards_read on public.go_live_guards for select to authenticated using (true);
grant select on public.go_live_guard_log, public.go_live_attestations, public.proposed_config_signoffs to authenticated;
create policy go_live_guard_log_read on public.go_live_guard_log for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
create policy go_live_attestations_read on public.go_live_attestations for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());
create policy proposed_config_signoffs_read on public.proposed_config_signoffs for select to authenticated
  using (private.is_admin() or private.credential_is_cmo());

-- ---------------------------------------------------------------------------
-- 2. Triggers: append-only logs, and the guard row that only the switch function can change
-- ---------------------------------------------------------------------------
create or replace function private.go_live_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception '% is append-only: a record is never changed or removed', tg_table_name using errcode = '42501';
end $$;

create trigger go_live_guard_log_append_only before update or delete on public.go_live_guard_log
  for each row execute function private.go_live_append_only();
create trigger go_live_guard_log_no_truncate before truncate on public.go_live_guard_log
  for each statement execute function private.go_live_append_only();
create trigger go_live_attestations_append_only before update or delete on public.go_live_attestations
  for each row execute function private.go_live_append_only();
create trigger go_live_attestations_no_truncate before truncate on public.go_live_attestations
  for each statement execute function private.go_live_append_only();
create trigger proposed_config_signoffs_append_only before update or delete on public.proposed_config_signoffs
  for each row execute function private.go_live_append_only();
create trigger proposed_config_signoffs_no_truncate before truncate on public.proposed_config_signoffs
  for each statement execute function private.go_live_append_only();

-- The guard row. A row is born off. is_on, changed_at, changed_by and change_note may change only when a log row written
-- in THIS transaction (txid) names the same guard and the same direction. A bare UPDATE, from any role including the table
-- owner that runs migrations, has no such log row and is refused. Forging one means inserting into go_live_guard_log, which
-- leaves a permanent, attributed record.
create or replace function private.go_live_guards_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'a go-live guard is never deleted' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' then
    if new.is_on or new.changed_at is not null or new.changed_by is not null or new.change_note is not null then
      raise exception 'a go-live guard is created switched off' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.key is distinct from old.key then
    raise exception 'a go-live guard cannot be renamed' using errcode = '42501';
  end if;
  if (new.is_on, new.changed_at, new.changed_by, new.change_note) is distinct from (old.is_on, old.changed_at, old.changed_by, old.change_note) then
    if not exists (
      select 1 from public.go_live_guard_log l
       where l.guard_key = new.key
         and l.txid = txid_current()
         and l.action = case when new.is_on then 'switched_on' else 'switched_off' end
    ) then
      raise exception 'a go-live guard changes only through set_go_live_guard()' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger go_live_guards_guard before insert or update or delete on public.go_live_guards
  for each row execute function private.go_live_guards_guard();
create trigger go_live_guards_no_truncate before truncate on public.go_live_guards
  for each statement execute function private.go_live_append_only();

-- ---------------------------------------------------------------------------
-- 3. Conditions
-- ---------------------------------------------------------------------------
create or replace function private.go_live_cond(p_code text, p_label text, p_met boolean, p_source text, p_detail text)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object('code', p_code, 'label', p_label, 'met', coalesce(p_met, false), 'source', p_source, 'detail', p_detail)
$$;

create or replace function private.go_live_attested(p_key text, p_code text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select a.met from public.go_live_attestations a
                    where a.guard_key = p_key and a.condition_code = p_code order by a.id desc limit 1), false)
$$;

-- Each condition says whether it is read from the data ('data'), recorded by a person ('attestation') or given by the
-- act of switching ('switch'). Spec 14 is the source of every line.
create or replace function private.go_live_conditions(p_key text, p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_n integer;
  v_gaps integer;
begin
  if p_key = 'clinical_operations_enabled' then
    -- public.protocols arrives with S24 (not on main-dev yet): read it dynamically so this migration and its functions work before and after it
    if to_regclass('public.protocols') is not null then
      execute 'select count(*) from public.protocols where status = ''approved'' and code ilike ''%hypertension%''' into v_n;
    else
      v_n := 0;
    end if;
    return jsonb_build_array(
      private.go_live_cond('hypertension_protocol_approved', 'An approved hypertension protocol', v_n > 0, 'data', v_n || ' approved'),
      private.go_live_cond('triage_rule_set_approved', 'An approved blood pressure triage rule set',
        exists (select 1 from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage'), 'data',
        (select count(*) from public.triage_rule_sets where status = 'approved' and code = 'bp_care_triage') || ' approved'),
      private.go_live_cond('tier2_clinician_active', 'At least one active tier 2 clinician',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) > 0, 'data',
        (select count(*) from public.clinical_staff where active and status = 'active' and credentialing_level >= 2 and is_test is not true) || ' active'),
      private.go_live_cond('admin_confirmation', 'Admin confirmation', true, 'switch', 'Given by an admin pressing the switch'));
  elsif p_key = 'on_call_cover_ok' then
    select count(*) into v_gaps from private.rota_gaps(p_org, now(), now() + interval '7 days');
    return jsonb_build_array(
      private.go_live_cond('rota_covers_next_7_days', 'The rota covers the next 7 days with a primary and an eligible backup', v_gaps = 0, 'data', v_gaps || ' gaps'));
  elsif p_key = 'lab_booking_enabled' then
    return jsonb_build_array(
      private.go_live_cond('synlab_active', 'SYNLAB is an active laboratory partner',
        exists (select 1 from public.lab_providers where is_active and name ilike 'synlab%'), 'data', null),
      private.go_live_cond('collection_sites', 'SYNLAB has at least one active collection site',
        exists (select 1 from public.lab_provider_locations l join public.lab_providers p on p.id = l.lab_provider_id where l.is_active and p.is_active and p.name ilike 'synlab%'), 'data', null),
      private.go_live_cond('results_flow_tested', 'The results flow has been tested end to end', private.go_live_attested(p_key, 'results_flow_tested'), 'attestation', null));
  elsif p_key = 'prescribing_enabled' then
    select count(*) into v_n from public.pharmacy_partners where is_active and onboarding_status = 'activated';
    return jsonb_build_array(
      private.go_live_cond('pharmacy_partner_active', 'At least one active pharmacy partner', v_n > 0, 'data', v_n || ' active'),
      private.go_live_cond('clinical_lead_signoff', 'Clinical lead sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
  elsif p_key = 'scribe_enabled' then
    return jsonb_build_array(
      private.go_live_cond('con001_legal_review_recorded', 'Legal review of consent text CON-001 recorded', private.go_live_attested(p_key, 'con001_legal_review_recorded'), 'attestation', null),
      private.go_live_cond('speech_provider_configured', 'A speech-to-text provider is configured', private.go_live_attested(p_key, 'speech_provider_configured'), 'attestation', null));
  elsif p_key = 'payouts_enabled' then
    return jsonb_build_array(
      private.go_live_cond('fee_schedule_approved', 'A fee schedule is approved', private.go_live_attested(p_key, 'fee_schedule_approved'), 'attestation', null),
      private.go_live_cond('paystack_transfers_configured', 'Paystack transfers are configured', private.go_live_attested(p_key, 'paystack_transfers_configured'), 'attestation', null));
  elsif p_key = 'public_signup_enabled' then
    return jsonb_build_array(
      private.go_live_cond('stage2_exit_criteria_met', 'The Stage 2 exit criteria are met', private.go_live_attested(p_key, 'stage2_exit_criteria_met'), 'attestation', null));
  end if;
  -- An unknown key has no conditions, and a guard with no conditions is never satisfied (fail closed).
  return jsonb_build_array(private.go_live_cond('unknown_guard', 'This guard has no defined condition', false, 'data', null));
end $$;

-- ---------------------------------------------------------------------------
-- 4. The reader the features call. Fail closed: an unknown key, or a guard that is off, is closed.
-- ---------------------------------------------------------------------------
create or replace function private.go_live_open(p_key text, p_patient uuid default null, p_clinician uuid default null)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select g.is_on from public.go_live_guards g where g.key = p_key), false)
      or (
        -- TEST PAIR RULE: only when a patient AND a clinician are both given and both are test accounts.
        p_patient is not null and p_clinician is not null
        and exists (select 1 from public.profiles where id = p_patient and is_test)
        and exists (select 1 from public.profiles where id = p_clinician and is_test)
      )
$$;

-- The client's courtesy check (INV-14: server and client). It answers for the signed-in person only, so it can be used to
-- show a calm "not open yet" state; the database functions above are what actually refuse.
create or replace function public.go_live_guard_is_open(p_key text) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    coalesce((select g.is_on from public.go_live_guards g where g.key = p_key), false)
    or exists (select 1 from public.profiles where id = (select auth.uid()) and is_test)
  )
$$;

-- ---------------------------------------------------------------------------
-- 5. The switch, the attestation, the dashboard read
-- ---------------------------------------------------------------------------
create or replace function private.go_live_actor_role() returns text
language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then 'admin' when private.credential_is_cmo() then 'cmo' else null end
$$;

create or replace function public.set_go_live_guard(p_key text, p_on boolean, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
  g public.go_live_guards;
  v_role text;
  v_conditions jsonb;
  v_unmet text;
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  v_role := private.go_live_actor_role();
  if v_role is null then raise exception 'only an admin or the Chief Medical Officer can switch a go-live guard' using errcode = '42501'; end if;
  select * into g from public.go_live_guards where key = p_key for update;
  if g.key is null then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  if p_on is null then raise exception 'say whether to switch it on or off' using errcode = '22023'; end if;
  if g.is_on = p_on then
    return jsonb_build_object('ok', true, 'key', g.key, 'is_on', g.is_on, 'changed', false);
  end if;
  v_conditions := private.go_live_conditions(p_key, private.caller_org());

  if p_on then
    -- Switching ON is the consequential direction: the right person, a reason, and every condition met right now.
    if g.switch_role = 'cmo' and not private.credential_is_cmo() then
      raise exception 'only the Chief Medical Officer can switch on %', g.label using errcode = '42501';
    end if;
    if g.switch_role = 'admin' and not private.is_admin() then
      raise exception 'only an admin can switch on %', g.label using errcode = '42501';
    end if;
    if nullif(btrim(p_note), '') is null then
      raise exception 'switching on % needs a note saying why', g.label using errcode = '22023';
    end if;
    select string_agg(c ->> 'label', '; ') into v_unmet from jsonb_array_elements(v_conditions) c where not (c ->> 'met')::boolean;
    if v_unmet is not null then
      raise exception 'cannot switch on %: not yet met: %', g.label, v_unmet using errcode = '22023';
    end if;
  end if;
  -- Switching OFF is the stop button and is never held up by paperwork: an admin or the CMO, a note optional.

  insert into public.go_live_guard_log (guard_key, action, actor_id, actor_role, note, conditions)
  values (p_key, case when p_on then 'switched_on' else 'switched_off' end, v_uid, v_role, nullif(btrim(p_note), ''), v_conditions);
  update public.go_live_guards
     set is_on = p_on,
         changed_at = now(),
         changed_by = v_uid,
         change_note = case when p_on then btrim(p_note) else nullif(btrim(p_note), '') end
   where key = p_key;
  perform private.log_audit(case when p_on then 'go_live_guard.switched_on' else 'go_live_guard.switched_off' end, 'go_live_guard', null,
    jsonb_build_object('key', p_key, 'role', v_role));
  return jsonb_build_object('ok', true, 'key', p_key, 'is_on', p_on, 'changed', true);
end $$;

create or replace function public.attest_go_live_condition(p_key text, p_code text, p_met boolean, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can record this' using errcode = '42501'; end if;
  if not exists (select 1 from public.go_live_guards where key = p_key) then raise exception 'no such go-live guard: %', p_key using errcode = '22023'; end if;
  if not exists (select 1 from jsonb_array_elements(private.go_live_conditions(p_key, private.caller_org())) c
                  where c ->> 'code' = p_code and c ->> 'source' = 'attestation') then
    raise exception 'that condition is read from the data, it cannot be attested' using errcode = '22023';
  end if;
  if p_met is null or length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'say what was checked and by whom, in a sentence' using errcode = '22023';
  end if;
  insert into public.go_live_attestations (guard_key, condition_code, met, note, attested_by)
  values (p_key, p_code, p_met, btrim(p_note), v_uid);
  perform private.log_audit('go_live_guard.condition_attested', 'go_live_guard', null, jsonb_build_object('key', p_key, 'code', p_code, 'met', p_met));
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.go_live_guard_status() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := private.caller_org();
begin
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can see this' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'key', g.key, 'label', g.label, 'blocks', g.blocks, 'condition_text', g.condition_text, 'switch_role', g.switch_role,
      'enforced_in', to_jsonb(g.enforced_in), 'not_enforced_in', g.not_enforced_in, 'is_on', g.is_on,
      'changed_at', g.changed_at, 'changed_by_name', (select p.full_name from public.profiles p where p.id = g.changed_by), 'change_note', g.change_note,
      'conditions', c.conds,
      'all_met', not exists (select 1 from jsonb_array_elements(c.conds) x where not (x ->> 'met')::boolean),
      'recent', coalesce((select jsonb_agg(jsonb_build_object('action', l.action, 'at', l.created_at, 'role', l.actor_role, 'note', l.note,
                  'by', (select p2.full_name from public.profiles p2 where p2.id = l.actor_id)) order by l.id desc)
                from (select * from public.go_live_guard_log where guard_key = g.key order by id desc limit 5) l), '[]'::jsonb)
    ) order by g.created_at, g.key)
    from public.go_live_guards g
    cross join lateral (select private.go_live_conditions(g.key, v_org) as conds) c
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 6. PROPOSED-config sign-off
-- ---------------------------------------------------------------------------
create or replace function public.record_proposed_config_signoff(
  p_key text, p_version integer, p_value_hash text, p_owner text, p_decision text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in' using errcode = '42501'; end if;
  if p_owner not in ('CMO', 'Founder', 'Founder and counsel') then raise exception 'unknown owner' using errcode = '22023'; end if;
  -- Only the value's owner confirms it. The founder is the admin account; the CMO is the Chief Medical Officer.
  if p_owner = 'CMO' and not private.credential_is_cmo() then
    raise exception 'only the Chief Medical Officer can confirm a value owned by the CMO' using errcode = '42501';
  end if;
  if p_owner in ('Founder', 'Founder and counsel') and not private.is_admin() then
    raise exception 'only the founder (admin) can confirm a value owned by the founder' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed', 'changes_requested') then raise exception 'unknown decision' using errcode = '22023'; end if;
  if p_decision = 'changes_requested' and nullif(btrim(p_note), '') is null then
    raise exception 'say what should change' using errcode = '22023';
  end if;
  if p_owner = 'Founder and counsel' and p_decision = 'confirmed' and length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'a value that needs counsel must say who advised and when' using errcode = '22023';
  end if;
  insert into public.proposed_config_signoffs (config_key, config_version, value_hash, owner, decision, note, signed_by)
  values (p_key, p_version, p_value_hash, p_owner, p_decision, nullif(btrim(p_note), ''), v_uid);
  perform private.log_audit('proposed_config.' || p_decision, 'proposed_config', null,
    jsonb_build_object('key', p_key, 'version', p_version, 'owner', p_owner));
  return jsonb_build_object('ok', true);
end $$;

-- The newest decision per value, as it stands against the value's current hash. Read by the sign-off screens.
create or replace function public.proposed_config_signoffs_current() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if private.go_live_actor_role() is null then raise exception 'only an admin or the Chief Medical Officer can see this' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('key', s.config_key, 'version', s.config_version, 'value_hash', s.value_hash, 'owner', s.owner,
             'decision', s.decision, 'note', s.note, 'signed_at', s.signed_at, 'signed_by_name', (select p.full_name from public.profiles p where p.id = s.signed_by)))
    from (select distinct on (config_key, config_version) * from public.proposed_config_signoffs order by config_key, config_version, id desc) s
  ), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------
-- 7. Function privileges: nothing for public or anon (anon inherits execute through PUBLIC, so revoke from public)
-- ---------------------------------------------------------------------------
revoke all on function private.go_live_append_only() from public;
revoke all on function private.go_live_guards_guard() from public;
revoke all on function private.go_live_cond(text, text, boolean, text, text) from public;
revoke all on function private.go_live_attested(text, text) from public;
revoke all on function private.go_live_conditions(text, uuid) from public;
revoke all on function private.go_live_open(text, uuid, uuid) from public;
revoke all on function private.go_live_actor_role() from public;
revoke all on function public.go_live_guard_is_open(text) from public, anon;
revoke all on function public.set_go_live_guard(text, boolean, text) from public, anon;
revoke all on function public.attest_go_live_condition(text, text, boolean, text) from public, anon;
revoke all on function public.go_live_guard_status() from public, anon;
revoke all on function public.record_proposed_config_signoff(text, integer, text, text, text, text) from public, anon;
revoke all on function public.proposed_config_signoffs_current() from public, anon;
grant execute on function public.go_live_guard_is_open(text) to authenticated;
grant execute on function public.set_go_live_guard(text, boolean, text) to authenticated;
grant execute on function public.attest_go_live_condition(text, text, boolean, text) to authenticated;
grant execute on function public.go_live_guard_status() to authenticated;
grant execute on function public.record_proposed_config_signoff(text, integer, text, text, text, text) to authenticated;
grant execute on function public.proposed_config_signoffs_current() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. The seven guards of spec section 14, all off
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('clinical_operations_enabled', 'Clinical operations', 'All clinical tasks, care pack sales, consultations',
   'Approved hypertension protocol and triage rule set; at least one active tier 2 clinician; admin confirmation', 'admin',
   array['hold_appointment_slot', 'confirm_appointment_booking', 'service_get_encounter_room', 'video_visit_requests insert', 'accept_video_visit_request', 'select_video_visit_alternate_slot', 'consultation booking screen'],
   'Clinical tasks (live since S16), lab result consult requests (a live flow) and care pack sales (not built) are not behind it.'),
  ('on_call_cover_ok', 'On-call cover', 'Care pack sales for uncovered hours', 'Rota covers the hours sold', 'admin', '{}',
   'Care pack sales are not built yet. Nothing is blocked by this guard today.'),
  ('lab_booking_enabled', 'Lab booking', 'Health check sales', 'SYNLAB partner active with collection sites and a tested results flow', 'admin', '{}',
   'Health check sales are not behind this guard yet. Nothing is blocked by it today.'),
  ('prescribing_enabled', 'Prescribing', 'Prescriptions', 'At least one active pharmacy partner; clinical lead sign-off', 'cmo', '{}',
   'Prescribing is not behind this guard yet (the prescription session is S24). Nothing is blocked by it today.'),
  ('scribe_enabled', 'AI scribe', 'AI scribe', 'Legal review of CON-001 recorded; speech provider configured', 'admin',
   array['scribe_may_start'], 'Only the start check is wired; no other scribe entry point exists yet.'),
  ('payouts_enabled', 'Payouts', 'Payout sending', 'Fee schedule approved; Paystack transfers configured', 'admin', '{}',
   'Payout sending is not built yet (S30). Nothing is blocked by this guard today.'),
  ('public_signup_enabled', 'Public sign-up', 'Sign-ups outside the pilot allow-list', 'Stage 2 exit criteria met', 'admin', '{}',
   'Sign-up is not behind this guard yet. Nothing is blocked by it today.');

-- ---------------------------------------------------------------------------
-- 9. Wiring (INV-14, server side). Live bodies read with pg_get_functiondef on 2026-10-06; each change is marked S37.
-- ---------------------------------------------------------------------------
create or replace function public.hold_appointment_slot(p_organisation_id uuid, p_clinician_id uuid, p_appointment_type appointment_type, p_consultation_method appointment_consultation_method, p_scheduled_for timestamp with time zone, p_ends_at timestamp with time zone, p_reason text DEFAULT NULL::text, p_service text DEFAULT NULL::text, p_location text DEFAULT NULL::text, p_specialist_referral_id uuid DEFAULT NULL::uuid, p_care_plan_id uuid DEFAULT NULL::uuid, p_patient_id uuid DEFAULT NULL::uuid, p_hold_minutes integer DEFAULT 10)
 returns appointments
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_patient uuid;
  v_org uuid;
  v_is_high_priority boolean := false;
  v_payment_status public.appointment_payment_status;
  v_result public.appointments;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  v_patient := coalesce(p_patient_id, v_uid);
  select organisation_id into v_org from public.profiles where id = v_uid;
  if v_org is distinct from p_organisation_id then
    raise exception 'not authorized for this organisation';
  end if;
  if v_patient <> v_uid
     and not private.is_org_staff(p_organisation_id)
     and not private.can_act_for(v_patient, 'book_appointments'::public.caregiver_permission) then
    raise exception 'only staff, or someone with permission to book appointments for this person, may book on their behalf';
  end if;

  -- S37 (INV-14): consultations stay closed until the clinical_operations_enabled guard is on (a test patient with a test clinician passes)
  if p_appointment_type in ('telemedicine', 'result_interpretation')
     and not private.go_live_open('clinical_operations_enabled', v_patient, p_clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21 (OQ-129): a remote consultation is for adults only; fail closed when the age is unknown
  if p_consultation_method = 'telemedicine' then
    perform private.assert_adult_for_consultation(v_patient);
  end if;
  -- S21 (OQ-124): a consultation is booked only from time the clinician has declared and the rota has confirmed
  if p_appointment_type = 'telemedicine' and not private.slot_is_open(p_clinician_id, v_patient, p_scheduled_for, p_ends_at) then
    raise exception 'that time is not open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if p_scheduled_for <= now() then
    raise exception 'that time has passed — pick another slot';
  end if;
  if p_ends_at <= p_scheduled_for then
    raise exception 'invalid time range';
  end if;

  if p_specialist_referral_id is not null then
    select (urgency in ('urgent', 'priority')) into v_is_high_priority
    from public.specialist_referrals
    where id = p_specialist_referral_id and organisation_id = p_organisation_id;
  end if;

  v_payment_status := case p_appointment_type
    when 'telemedicine' then 'pending'
    when 'result_interpretation' then 'pending'
    else 'not_required'
  end;

  begin
    insert into public.appointments (
      organisation_id, patient_id, clinician_id, appointment_type, consultation_method,
      scheduled_for, ends_at, status, reason, service, location,
      specialist_referral_id, care_plan_id, booked_by, is_high_priority, hold_expires_at,
      payment_status
    ) values (
      p_organisation_id, v_patient, p_clinician_id, p_appointment_type, p_consultation_method,
      p_scheduled_for, p_ends_at, 'held', p_reason, p_service, p_location,
      p_specialist_referral_id, p_care_plan_id, v_uid, coalesce(v_is_high_priority, false),
      now() + (p_hold_minutes * interval '1 minute'),
      v_payment_status
    )
    returning * into v_result;
  exception
    when exclusion_violation then
      raise exception 'that time was just taken — pick another slot';
  end;

  if v_patient <> v_uid then
    perform private.log_care_access(v_patient, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_result.id, 'stage', 'held'));
  end if;

  return v_result;
end;
$function$;

create or replace function public.confirm_appointment_booking(p_appointment_id uuid)
 returns appointments
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_appt public.appointments;
  v_product_code text;
  v_consult_context public.video_consultation_context;
  v_consult_id uuid;
begin
  select * into v_appt from public.appointments where id = p_appointment_id for update;
  if v_appt.id is null then
    raise exception 'appointment not found';
  end if;
  if v_appt.patient_id <> v_uid
     and not private.is_org_staff(v_appt.organisation_id)
     and not private.can_act_for(v_appt.patient_id, 'book_appointments'::public.caregiver_permission) then
    raise exception 'not authorized';
  end if;
  if v_appt.status not in ('held', 'booked') then
    raise exception 'appointment is not on hold';
  end if;
  if v_appt.status = 'held' and v_appt.hold_expires_at < now() then
    update public.appointments set status = 'expired', hold_expires_at = null where id = p_appointment_id;
    raise exception 'hold has expired — pick another slot';
  end if;

  -- S37 (INV-14): a hold made before the guard was switched off is not confirmed, and no credit is spent
  if v_appt.appointment_type in ('telemedicine', 'result_interpretation')
     and not private.go_live_open('clinical_operations_enabled', v_appt.patient_id, v_appt.clinician_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  -- S21: the time must still be open at the moment the credit is spent (the clinician may have cancelled the block, or gone on leave,
  -- since the hold was made). The hold itself is kept, so nothing is spent and the patient can choose again.
  if v_appt.appointment_type = 'telemedicine' and not private.slot_is_open(v_appt.clinician_id, v_appt.patient_id, v_appt.scheduled_for, v_appt.ends_at, true) then
    raise exception 'that time is no longer open for consultations: pick another slot' using errcode = 'P0001';
  end if;

  if v_appt.payment_status = 'pending' then
    v_product_code := case v_appt.appointment_type
      when 'telemedicine' then 'video_visit_credit'
      when 'result_interpretation' then 'result_interpretation_credit'
      else null
    end;
    if v_product_code is not null then
      begin
        perform public.redeem_available_service_purchase(
          v_appt.patient_id, v_product_code, 'appointment', v_appt.id
        );
        v_appt.payment_status := 'paid';
      exception when others then
        if sqlerrm not like 'no available%' then
          raise;
        end if;
      end;
    end if;
  end if;

  update public.appointments
    set payment_status = v_appt.payment_status,
        status = case when v_appt.payment_status in ('paid', 'not_required', 'waived')
                      then 'confirmed'::public.appointment_status
                      else 'booked'::public.appointment_status end,
        confirmed_at = case when v_appt.payment_status in ('paid', 'not_required', 'waived') then now() else confirmed_at end,
        hold_expires_at = null
    where id = p_appointment_id
    returning * into v_appt;

  if v_appt.status = 'confirmed'
     and v_appt.video_consultation_id is null
     and v_appt.appointment_type in ('telemedicine', 'result_interpretation') then
    v_consult_context := case v_appt.appointment_type
      when 'result_interpretation' then 'lab_result_consult'
      else 'general_checkin'
    end;

    insert into public.video_consultations
      (organisation_id, patient_id, context, initiated_by, status, scheduled_at)
    values
      (v_appt.organisation_id, v_appt.patient_id, v_consult_context, v_appt.patient_id, 'scheduled', v_appt.scheduled_for)
    returning id into v_consult_id;

    update public.appointments set video_consultation_id = v_consult_id where id = v_appt.id
    returning * into v_appt;
  end if;

  -- S21: the authoritative encounter and its room stub
  if v_appt.status = 'confirmed' then
    perform private.ensure_encounter_for_appointment(v_appt.id);
  end if;

  if v_appt.status = 'confirmed' then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (
      v_appt.organisation_id, v_appt.patient_id, private.patient_reminder_channel(v_appt.patient_id), 'pending', 'appointment_booking_confirmation',
      jsonb_build_object('appointment_id', v_appt.id, 'scheduled_for', v_appt.scheduled_for, 'appointment_type', v_appt.appointment_type),
      'non_clinical'
    );
  end if;

  if v_appt.patient_id <> v_uid then
    perform private.log_care_access(v_appt.patient_id, 'acted_for', 'booking', jsonb_build_object('appointment_id', v_appt.id, 'stage', v_appt.status::text));
  end if;

  return v_appt;
end;
$function$;

create or replace function public.service_get_encounter_room(p_encounter uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
declare
  e public.encounters;
  r public.encounter_rooms;
  c jsonb := private.consult_policy();
  v_opens timestamptz;
  v_closes timestamptz;
  v_open boolean;
begin
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then return null; end if;
  select * into r from public.encounter_rooms where encounter_id = e.id;
  v_opens := e.scheduled_at - ((c ->> 'joinOpensMinutesBefore')::integer * interval '1 minute');
  v_closes := e.scheduled_at + ((c ->> 'joinClosesMinutesAfter')::integer * interval '1 minute');
  -- S37 (INV-14): with the guard off the room is neither joinable nor described; the caller shows the calm "not open yet" state
  v_open := private.go_live_open('clinical_operations_enabled', e.patient_id, e.clinician_id);
  return jsonb_build_object(
    'encounter_id', e.id,
    'organisation_id', e.organisation_id,
    'patient_id', e.patient_id,
    'clinician_id', e.clinician_id,
    'type', e.type,
    'status', e.status,
    'scheduled_at', e.scheduled_at,
    'final_media_mode', e.final_media_mode,
    'is_test', e.is_test,
    'join_opens_at', v_opens,
    'join_closes_at', v_closes,
    'go_live_open', v_open,
    'joinable', v_open and e.status in ('scheduled', 'waiting', 'in_progress') and private.encounter_is_on(e) and now() >= v_opens and now() <= v_closes,
    'room', case when r.id is null or not v_open then null else jsonb_build_object(
      'provider', r.provider, 'provider_room_id', r.provider_room_id, 'state', r.state, 'expires_at', r.expires_at) end,
    'session_minutes', (c ->> 'sessionMinutes')::integer,
    'reconnect_grace_seconds', (c ->> 'reconnectGraceSeconds')::integer);
end;
$function$;

create or replace function public.scribe_may_start(p_encounter uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to ''
as $function$
  select (select auth.uid()) is not null
     and exists (
       select 1 from public.encounters e
         join public.consultation_scribe_consents c on c.encounter_id = e.id
        where e.id = p_encounter
          and e.clinician_id = (select auth.uid())
          and e.status = 'in_progress'
          and c.granted is true
          -- S37 (INV-14): the AI scribe stays off until the scribe_enabled guard is on (a test pair passes)
          and private.go_live_open('scribe_enabled', e.patient_id, e.clinician_id));
$function$;

-- ---------------------------------------------------------------------------
-- 9b. The older video-visit request path (second slot system, OQ-132). A request is created by the patient directly in the
-- table, and a clinician (accept) or the patient (pick an offered time) turns it into a consultation. All three points are
-- guarded; the insert is the one that matters (nothing is requested or paid for while closed), the other two cover a request
-- made before a switch-off. A request has no clinician yet, so the insert uses the patient-only test rule.
-- ---------------------------------------------------------------------------
create or replace function private.go_live_open_patient(p_key text, p_patient uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select g.is_on from public.go_live_guards g where g.key = p_key), false)
      or exists (select 1 from public.profiles where id = p_patient and is_test)
$$;
revoke all on function private.go_live_open_patient(text, uuid) from public;

create or replace function private.video_visit_requests_go_live_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not private.go_live_open_patient('clinical_operations_enabled', new.patient_id) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;
  return new;
end $$;
revoke all on function private.video_visit_requests_go_live_guard() from public;
create trigger video_visit_requests_go_live_guard before insert on public.video_visit_requests
  for each row execute function private.video_visit_requests_go_live_guard();

create or replace function public.accept_video_visit_request(p_request_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_staff uuid;
  v_req record;
  v_slot record;
  v_consult uuid;
begin
  select r.* into v_req from public.video_visit_requests r where r.id = p_request_id for update;
  if v_req.id is null then
    raise exception 'request not found';
  end if;

  select cs.id into v_staff
  from public.clinical_staff cs
  where cs.profile_id = (select auth.uid())
    and cs.organisation_id = v_req.organisation_id
    and cs.active
    and cs.doctor_tier is not null;
  if v_staff is null then
    raise exception 'only an active doctor on this organisation''s care team can accept a video visit'
      using errcode = '42501';
  end if;

  -- S37 (INV-14): no consultation is created while the guard is off (a test patient with a test clinician passes)
  if not private.go_live_open('clinical_operations_enabled', v_req.patient_id, (select auth.uid())) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  if v_req.status <> 'payment_confirmed' then
    raise exception 'this request is not awaiting acceptance (status: %)', v_req.status;
  end if;
  if v_req.slot_id is null then
    raise exception 'this request has no slot attached — decline it with a note instead';
  end if;

  select * into v_slot from public.consult_availability_slots where id = v_req.slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that slot is no longer available — decline and ask the patient to pick another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed — decline so the patient is refunded';
  end if;

  -- A video visit is paid at checkout (Paystack) before it reaches this point; there is nothing
  -- further to charge on acceptance.

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'general_checkin', v_req.patient_id, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = v_slot.id;

  update public.video_visit_requests
    set status = 'accepted',
        accepted_by = v_staff,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$function$;

create or replace function public.select_video_visit_alternate_slot(p_request_id uuid, p_slot_id uuid)
 returns uuid
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_req record;
  v_slot record;
  v_consult uuid;
begin
  select r.* into v_req
  from public.video_visit_requests r
  where r.id = p_request_id and r.patient_id = (select auth.uid())
  for update;
  if v_req.id is null then
    raise exception 'request not found' using errcode = '42501';
  end if;

  if v_req.status <> 'alternate_proposed' then
    raise exception 'this request has no offered times to pick from (status: %)', v_req.status;
  end if;
  if v_req.proposed_slot_ids is null or not (p_slot_id = any(v_req.proposed_slot_ids)) then
    raise exception 'that time was not one of the offered options';
  end if;

  -- S37 (INV-14): no consultation is created while the guard is off. The clinician is the one who proposed the times.
  if not private.go_live_open('clinical_operations_enabled', v_req.patient_id,
       (select cs.profile_id from public.clinical_staff cs where cs.id = v_req.proposed_by)) then
    raise exception 'consultations are not open yet' using errcode = 'P0001', hint = 'go_live_guard:clinical_operations_enabled';
  end if;

  select * into v_slot from public.consult_availability_slots where id = p_slot_id for update;
  if v_slot.id is null or v_slot.booked_consultation_id is not null then
    raise exception 'that time is no longer available -- ask your care team to offer another time';
  end if;
  if v_slot.slot_start <= now() then
    raise exception 'that time has already passed -- ask your care team to offer another time';
  end if;

  insert into public.video_consultations
    (organisation_id, patient_id, context, initiated_by, status, scheduled_at, patient_confirmed_at)
  values
    (v_req.organisation_id, v_req.patient_id, 'general_checkin', v_req.patient_id, 'scheduled', v_slot.slot_start, now())
  returning id into v_consult;

  update public.consult_availability_slots
    set booked_consultation_id = v_consult
    where id = v_slot.id;

  update public.video_visit_requests
    set status = 'accepted',
        slot_id = p_slot_id,
        accepted_by = v_req.proposed_by,
        accepted_at = now(),
        video_consultation_id = v_consult
    where id = v_req.id;

  return v_consult;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 10. Self-checks (a failed assertion aborts the migration)
-- ---------------------------------------------------------------------------
do $$
declare
  v_n integer;
begin
  if (select count(*) from public.go_live_guards) <> 7 then raise exception 'FAIL: expected the seven guards'; end if;
  if exists (select 1 from public.go_live_guards where is_on) then raise exception 'FAIL: a guard shipped switched on'; end if;
  if private.go_live_open('clinical_operations_enabled') or private.go_live_open('no_such_guard') then raise exception 'FAIL: a closed or unknown guard reads open'; end if;

  -- a bare UPDATE by the table owner (this migration's own role) is refused
  begin
    update public.go_live_guards set is_on = true where key = 'payouts_enabled';
    raise exception 'FAIL: the owner switched a guard on directly';
  exception when sqlstate '42501' then null; when check_violation then null; end;
  begin
    update public.go_live_guards set change_note = 'x' where key = 'payouts_enabled';
    raise exception 'FAIL: the owner edited a guard note directly';
  exception when sqlstate '42501' then null; end;
  begin
    delete from public.go_live_guards where key = 'payouts_enabled';
    raise exception 'FAIL: the owner deleted a guard';
  exception when sqlstate '42501' then null; end;
  begin
    insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, is_on, changed_at, changed_by, change_note)
    values ('born_on', 'x', 'x', 'x', 'admin', true, now(), (select id from public.profiles limit 1), 'x');
    raise exception 'FAIL: a guard was created switched on';
  exception when sqlstate '42501' then null; when check_violation then null; end;

  -- nobody has a table write privilege, and anon has no execute on the new functions
  if has_table_privilege('authenticated', 'public.go_live_guards', 'UPDATE') or has_table_privilege('authenticated', 'public.go_live_guards', 'INSERT') then
    raise exception 'FAIL: authenticated can write go_live_guards';
  end if;
  if has_table_privilege('anon', 'public.go_live_guards', 'SELECT') then raise exception 'FAIL: anon can read go_live_guards'; end if;
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('set_go_live_guard', 'attest_go_live_condition', 'go_live_guard_status', 'go_live_guard_is_open', 'record_proposed_config_signoff', 'proposed_config_signoffs_current')
     and (has_function_privilege('anon', p.oid, 'EXECUTE') or not has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if v_n > 0 then raise exception 'FAIL: % new function(s) with the wrong anon or authenticated execute', v_n; end if;
  if has_function_privilege('anon', 'private.go_live_open(text,uuid,uuid)', 'EXECUTE') then raise exception 'FAIL: anon can execute go_live_open'; end if;
  if has_table_privilege('service_role', 'public.go_live_guards', 'UPDATE') or has_table_privilege('service_role', 'public.go_live_guard_log', 'INSERT') then
    raise exception 'FAIL: service_role can write the guard tables';
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'public.video_visit_requests'::regclass and tgname = 'video_visit_requests_go_live_guard') then
    raise exception 'FAIL: the video visit request trigger is missing';
  end if;
  raise notice 'PASS: S37 guards seeded off, owner-proof, wired';
end $$;

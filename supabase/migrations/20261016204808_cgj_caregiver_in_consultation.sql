-- CGJ: a patient can invite a Care Circle member into ONE consultation call (founder decision, settled). docs/design/CGJ.md.
--
-- What this adds, and what it deliberately does not:
--   1. A sixth Care Circle permission, `attend_consultation`. It is a permission to BE INVITED to a call, never a standing right to join
--      one: every call needs a fresh invite from the patient, and an invite is per call. Existing members hold nothing new.
--   2. `encounter_caregiver_passes`: one row per invite, per consultation. A pass is usable only while it is accepted, unexpired, its
--      consultation is live and inside its join window, and the circle member still holds the permission (active, unexpired, not paused).
--      The consultation ending, a removal or a revoked member each end it on the very next check, with no sweep needed.
--   3. Patient (or the proxy `private.encounter_visible` already admits) invites and cancels; the invited caregiver accepts or declines;
--      the assigned clinician removes (final for that call: no rejoin, no re-invite). Server-only functions give the join credential and
--      record presence. Every step is an append-only `encounter_events` row holding ids only.
--   4. Versioned PROPOSED config `consultation_caregiver_config` (invite expiry minutes, people per call, minimum age).
--
-- Not changed on purpose (each is proved in packages/db/tests/cgj_caregiver_in_consultation.sql):
--   - The caregiver gets NO policy on encounters, encounter_events, notes, results or the summary. They read only what two definer
--     functions return. Nothing in S29's supporter view or any clinical read path is touched, `private.can_read_clinical` is not called
--     (so the overload-ambiguity lesson cannot apply) and reproductive_health is not involved.
--   - Scribe consent: open_scribe_prompt / record_scribe_consent still demand auth.uid() = the patient. A caregiver cannot give or withdraw.
--   - Recording stays pinned off in encounter_rooms.
--   - report_encounter_event and service_record_encounter_event still refuse every caregiver kind (their whitelists are not widened).
-- Row counts at writing: encounter_events 0 rows live, care_circle_members hold none of the new permission, so no data is converted.

-- ---------------------------------------------------------------------------
-- 1. The permission
-- ---------------------------------------------------------------------------
create or replace function private.circle_permissions_valid(p text[]) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(cardinality(p) between 1 and 6
         and p <@ array['adherence_summary', 'weekly_bp_trend', 'appointments', 'red_alerts', 'pay_for_care', 'attend_consultation']::text[]
         and cardinality(p) = (select count(distinct x) from unnest(p) x), false)
$$;
revoke all on function private.circle_permissions_valid(text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Config (versioned, PROPOSED). Mirrored in packages/shared as consultations.caregiver_join.
-- ---------------------------------------------------------------------------
create function private.caregiver_rules_valid(r jsonb) returns boolean
language plpgsql immutable set search_path = ''
as $$
declare k text;
begin
  if jsonb_typeof(r) is distinct from 'object' then return false; end if;
  foreach k in array array['inviteExpiryMinutes', 'maxCaregiversPerCall', 'minAgeYears'] loop
    if jsonb_typeof(r -> k) is distinct from 'number' or (r ->> k) !~ '^[0-9]+$' then return false; end if;
  end loop;
  if jsonb_typeof(r -> 'requireDateOfBirth') is distinct from 'boolean' then return false; end if;
  return (r ->> 'inviteExpiryMinutes')::integer between 5 and 1440
     and (r ->> 'maxCaregiversPerCall')::integer between 1 and 3
     and (r ->> 'minAgeYears')::integer between 16 and 99;
end $$;
revoke all on function private.caregiver_rules_valid(jsonb) from public, anon, authenticated;

create table public.consultation_caregiver_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (private.caregiver_rules_valid(rules)),
  created_at     timestamptz not null default now()
);
create unique index consultation_caregiver_config_one_active on public.consultation_caregiver_config (is_active) where is_active;
alter table public.consultation_caregiver_config enable row level security;
create policy consultation_caregiver_config_read on public.consultation_caregiver_config for select to authenticated using (true);
revoke all on public.consultation_caregiver_config from public, anon, authenticated;
grant select on public.consultation_caregiver_config to authenticated;
comment on table public.consultation_caregiver_config is
  'CGJ PROPOSED rules for a caregiver invited into one consultation: inviteExpiryMinutes, maxCaregiversPerCall, minAgeYears, requireDateOfBirth. Mirrored as consultations.caregiver_join. A change is a new row (INV-16).';

-- caregiver-join-begin
insert into public.consultation_caregiver_config (version, is_active, effective_from, rules) values (1, true, '2026-10-16', $json$
{ "inviteExpiryMinutes": 240, "maxCaregiversPerCall": 1, "minAgeYears": 18, "requireDateOfBirth": false }
$json$::jsonb);
-- caregiver-join-end

create function private.caregiver_rules() returns jsonb
language sql stable security definer set search_path = ''
as $$ select rules from public.consultation_caregiver_config where is_active $$;
revoke all on function private.caregiver_rules() from public, anon, authenticated;

create function private.caregiver_rules_version() returns integer
language sql stable security definer set search_path = ''
as $$ select version from public.consultation_caregiver_config where is_active $$;
revoke all on function private.caregiver_rules_version() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Event vocabulary: the actor role `caregiver` and seven kinds of their own
-- ---------------------------------------------------------------------------
-- Their own kinds, so the patient/clinician 'joined' logic that starts a call and decides a no-show cannot be moved by a caregiver.
do $$
declare v_name text;
begin
  select c.conname into v_name from pg_constraint c
   where c.conrelid = 'public.encounter_events'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%room_created%';
  if v_name is null then raise exception 'CGJ: encounter_events kind check not found'; end if;
  execute format('alter table public.encounter_events drop constraint %I', v_name);
  alter table public.encounter_events add constraint encounter_events_kind_check check (kind = any (array[
    'room_created', 'joined', 'left', 'quality', 'mode_changed', 'fallback_offered', 'phone_requested', 'phone_connected',
    'reconnect_grace_started', 'no_show_marked', 'completed', 'cancelled', 'credit_returned', 'scribe_consent_asked',
    'scribe_consent_changed', 'host_key_issued', 'call_extended', 'longer_call_requested',
    'caregiver_invited', 'caregiver_invite_cancelled', 'caregiver_accepted', 'caregiver_declined', 'caregiver_joined',
    'caregiver_left', 'caregiver_removed']));

  select c.conname into v_name from pg_constraint c
   where c.conrelid = 'public.encounter_events'::regclass and c.contype = 'c' and pg_get_constraintdef(c.oid) like '%actor_role%';
  if v_name is null then raise exception 'CGJ: encounter_events actor_role check not found'; end if;
  execute format('alter table public.encounter_events drop constraint %I', v_name);
  alter table public.encounter_events add constraint encounter_events_actor_role_check
    check (actor_role in ('patient', 'clinician', 'system', 'caregiver'));
end $$;

-- ---------------------------------------------------------------------------
-- 4. The pass
-- ---------------------------------------------------------------------------
create table public.encounter_caregiver_passes (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  encounter_id    uuid not null references public.encounters (id) on delete cascade,
  patient_id      uuid not null references public.profiles (id) on delete restrict,
  caregiver_id    uuid not null references public.profiles (id) on delete cascade,
  circle_member_id uuid references public.care_circle_members (id) on delete set null,
  -- the Care Circle's own label ("Daughter"), copied so the clinician sees it and nothing else about the person
  relationship    text not null check (char_length(btrim(relationship)) between 1 and 40),
  state           text not null default 'invited' check (state in ('invited', 'accepted', 'declined', 'cancelled', 'removed')),
  expires_at      timestamptz not null,
  invited_by      uuid references public.profiles (id) on delete set null,
  accepted_at     timestamptz,
  removed_at      timestamptz,
  removed_by      uuid references public.profiles (id) on delete set null,
  config_version  integer not null,
  is_test         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint caregiver_pass_not_the_patient check (caregiver_id <> patient_id),
  check (state <> 'accepted' or accepted_at is not null),
  check (state <> 'removed' or (removed_at is not null and removed_by is not null))
);
-- one live invite per person per call; a removed or declined row stays as the record
create unique index encounter_caregiver_passes_one_live on public.encounter_caregiver_passes (encounter_id, caregiver_id)
  where state in ('invited', 'accepted');
create index encounter_caregiver_passes_encounter_idx on public.encounter_caregiver_passes (encounter_id, state);
create index encounter_caregiver_passes_caregiver_idx on public.encounter_caregiver_passes (caregiver_id) where state in ('invited', 'accepted');
create trigger encounter_caregiver_passes_set_updated_at before update on public.encounter_caregiver_passes
  for each row execute function private.set_updated_at();
comment on table public.encounter_caregiver_passes is
  'CGJ: one invite of a Care Circle member into ONE consultation. No standing access: usable only while accepted, unexpired, the consultation is live and in its join window, and the circle member still holds attend_consultation. Written only by definer functions.';

alter table public.encounter_caregiver_passes enable row level security;
-- The patient reads the passes they made, and only these columns (never who removed one, or the circle row). The caregiver, a proxy and the
-- clinician read nothing from this table: they go through consultation_caregivers() and my_consultation_invites(), which say what each may
-- know. In particular a caregiver is not told they were removed (a "you were removed" message can cause conflict at home, S29).
create policy encounter_caregiver_passes_patient on public.encounter_caregiver_passes for select to authenticated
  using (patient_id = (select auth.uid()));
revoke all on public.encounter_caregiver_passes from public, anon, authenticated;
grant select (id, organisation_id, encounter_id, patient_id, caregiver_id, relationship, state, expires_at, accepted_at, removed_at, created_at)
  on public.encounter_caregiver_passes to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Helpers
-- ---------------------------------------------------------------------------
create function private.encounter_join_closes_at(e public.encounters) returns timestamptz
language sql stable security definer set search_path = ''
as $$ select e.scheduled_at + (((private.consult_policy()) ->> 'joinClosesMinutesAfter')::integer * interval '1 minute') $$;
revoke all on function private.encounter_join_closes_at(public.encounters) from public, anon, authenticated;

create function private.encounter_join_opens_at(e public.encounters) returns timestamptz
language sql stable security definer set search_path = ''
as $$ select e.scheduled_at - (((private.consult_policy()) ->> 'joinOpensMinutesBefore')::integer * interval '1 minute') $$;
revoke all on function private.encounter_join_opens_at(public.encounters) from public, anon, authenticated;

-- True while the circle member behind a pass is still a member who may be invited: active, unexpired, holds the permission, the circle is
-- not paused, and the supporter's account is active.
create function private.caregiver_member_ok(p_member uuid, p_patient uuid, p_supporter uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.care_circle_members m
      join public.profiles s on s.id = m.supporter_id and s.is_active
     where m.id = p_member and m.patient_id = p_patient and m.supporter_id = p_supporter
       and m.state = 'active' and m.expires_at > now()
       and 'attend_consultation' = any (m.permissions)
       and not private.circle_paused(m.patient_id))
$$;
revoke all on function private.caregiver_member_ok(uuid, uuid, uuid) from public, anon, authenticated;

-- The one gate every use of a pass goes through (answer, credential, presence, lists). `p_window` is the ENTRY test (the credential): the
-- join window must be open. Without it, it is the "still in force" test the pages use.
--   - An invite waiting for an answer must be answered before it expires and before the join window closes.
--   - Once accepted, a pass lasts for the call: its expiry is set to the close of the join window at that moment, and a call that is in
--     progress keeps its guest past the window (a call can be extended), so a guest is never dropped mid-call by a clock.
--   - An ended, cancelled, no-show or rescheduled consultation is not live, so a pass dies with its consultation without a sweep.
create function private.caregiver_pass_usable(p_pass uuid, p_states text[], p_window boolean) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  p public.encounter_caregiver_passes;
  e public.encounters;
  v_closes timestamptz;
begin
  select * into p from public.encounter_caregiver_passes where id = p_pass;
  if p.id is null or not (p.state = any (p_states)) then return false; end if;
  select * into e from public.encounters where id = p.encounter_id;
  if e.id is null or e.status not in ('scheduled', 'waiting', 'in_progress') or not private.encounter_is_on(e) then return false; end if;
  v_closes := private.encounter_join_closes_at(e);
  if p_window then
    -- entering: the invite is in date and the join window is open
    if p.expires_at <= now() or now() > v_closes or now() < private.encounter_join_opens_at(e) then return false; end if;
  elsif p.state = 'accepted' then
    if not (now() <= v_closes or e.status = 'in_progress') then return false; end if;
  else
    if p.expires_at <= now() or now() > v_closes then return false; end if;
  end if;
  return private.caregiver_member_ok(p.circle_member_id, p.patient_id, p.caregiver_id);
end $$;
revoke all on function private.caregiver_pass_usable(uuid, text[], boolean) from public, anon, authenticated;

-- A caregiver is an adult. A KNOWN age under the minimum is refused. An unknown age (a supporter-only account is never asked for a date of
-- birth) is refused only when the config says a date of birth is required, and always when the account is a dependant's (OQ-CGJ-4).
create function private.caregiver_age_ok(p_supporter uuid, p_cfg jsonb) returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare v_age integer := private.patient_age_years(p_supporter);
begin
  if exists (select 1 from public.profiles where id = p_supporter and coalesce(is_dependent_account, false)) then return false; end if;
  if v_age is null then return not coalesce((p_cfg ->> 'requireDateOfBirth')::boolean, true); end if;
  return v_age >= (p_cfg ->> 'minAgeYears')::integer;
end $$;
revoke all on function private.caregiver_age_ok(uuid, jsonb) from public, anon, authenticated;

-- Who may act for the patient on a consultation: the patient, or the proxy that private.encounter_visible already admits.
create function private.caregiver_invite_actor_ok(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select (select auth.uid()) is not null and (
       p_patient = (select auth.uid())
    or private.can_act_for(p_patient, 'book_appointments'::public.caregiver_permission))
$$;
revoke all on function private.caregiver_invite_actor_ok(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Invite, cancel, answer, remove (signed-in functions)
-- ---------------------------------------------------------------------------
create function public.invite_caregiver_to_consultation(p_encounter uuid, p_member uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  m public.care_circle_members;
  cfg jsonb := private.caregiver_rules();
  v_pass public.encounter_caregiver_passes;
  v_expires timestamptz;
  v_stale uuid;
begin
  if v_uid is null then raise exception 'caregiver_invite_not_allowed' using errcode = '42501'; end if;
  -- the row is locked so two invites made at the same moment (the patient and a proxy, two devices) are counted one after the other
  select * into e from public.encounters where id = p_encounter for update;
  -- an unknown consultation, someone else's consultation and a stranger all get the same answer
  if e.id is null or not private.caregiver_invite_actor_ok(e.patient_id) then
    raise exception 'caregiver_invite_not_allowed' using errcode = '42501';
  end if;
  if cfg is null then raise exception 'caregiver_invite_not_configured' using errcode = 'P0001'; end if;
  if e.status not in ('scheduled', 'waiting', 'in_progress') or not private.encounter_is_on(e) or now() > private.encounter_join_closes_at(e) then
    raise exception 'caregiver_invite_call_not_live' using errcode = 'P0001';
  end if;

  select * into m from public.care_circle_members where id = p_member and patient_id = e.patient_id;
  if m.id is null or not private.caregiver_member_ok(m.id, e.patient_id, m.supporter_id) then
    raise exception 'caregiver_invite_not_permitted' using errcode = 'P0001';
  end if;
  -- the care team's own doctor is never "a caregiver"; and a caregiver is an adult, fail closed when the age is unknown (OQ-CGJ-4)
  if m.supporter_id = e.clinician_id then raise exception 'caregiver_invite_not_permitted' using errcode = 'P0001'; end if;
  if not private.caregiver_age_ok(m.supporter_id, cfg) then raise exception 'caregiver_invite_not_permitted' using errcode = 'P0001'; end if;

  -- a removal is final for this call: the same person cannot be invited back
  if exists (select 1 from public.encounter_caregiver_passes where encounter_id = e.id and caregiver_id = m.supporter_id and state = 'removed') then
    raise exception 'caregiver_invite_removed_for_this_call' using errcode = 'P0001';
  end if;
  -- this person's own unanswered invite that has run out of time is cleared (and logged), so it cannot block a fresh one
  select id into v_stale from public.encounter_caregiver_passes
   where encounter_id = e.id and caregiver_id = m.supporter_id and state = 'invited' and expires_at <= now();
  if v_stale is not null then
    update public.encounter_caregiver_passes set state = 'cancelled' where id = v_stale;
    perform private.log_encounter_event(e.id, 'caregiver_invite_cancelled', null, 'system', jsonb_build_object('pass_id', v_stale, 'reason_code', 'expired'));
  end if;
  if exists (select 1 from public.encounter_caregiver_passes where encounter_id = e.id and caregiver_id = m.supporter_id and state in ('invited', 'accepted')) then
    raise exception 'caregiver_invite_already_sent' using errcode = 'P0001';
  end if;
  -- only invites still in force count against the cap: one that ran out of time frees its place
  if (select count(*) from public.encounter_caregiver_passes where encounter_id = e.id and state in ('invited', 'accepted') and expires_at > now())
       >= (cfg ->> 'maxCaregiversPerCall')::integer then
    raise exception 'caregiver_invite_call_full' using errcode = 'P0001';
  end if;

  v_expires := least(now() + ((cfg ->> 'inviteExpiryMinutes')::integer * interval '1 minute'), private.encounter_join_closes_at(e));
  insert into public.encounter_caregiver_passes (organisation_id, encounter_id, patient_id, caregiver_id, circle_member_id, relationship,
                                                 expires_at, invited_by, config_version, is_test)
  values (e.organisation_id, e.id, e.patient_id, m.supporter_id, m.id, m.relationship, v_expires, v_uid,
          private.caregiver_rules_version(), e.is_test)
  returning * into v_pass;

  perform private.log_encounter_event(e.id, 'caregiver_invited', v_uid, 'patient', jsonb_build_object('pass_id', v_pass.id));
  -- Neutral, in-app and push, empty payload (INV-07). Nothing depends on a send succeeding: the invite is on the caregiver's own page.
  perform private.circle_notify(m.supporter_id, e.organisation_id, 'circle_consultation_invite', 'encounter_caregiver_passes', v_pass.id,
                                array['in_app', 'push'], 'routine', e.is_test);
  return jsonb_build_object('pass_id', v_pass.id, 'expires_at', v_pass.expires_at);
end $$;
revoke all on function public.invite_caregiver_to_consultation(uuid, uuid) from public, anon;
grant execute on function public.invite_caregiver_to_consultation(uuid, uuid) to authenticated;

create function public.cancel_caregiver_invite(p_pass uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  p public.encounter_caregiver_passes;
begin
  select * into p from public.encounter_caregiver_passes where id = p_pass for update;
  if p.id is null or not private.caregiver_invite_actor_ok(p.patient_id) then
    raise exception 'caregiver_invite_not_allowed' using errcode = '42501';
  end if;
  if p.state not in ('invited', 'accepted') then return false; end if;
  update public.encounter_caregiver_passes set state = 'cancelled' where id = p.id;
  perform private.log_encounter_event(p.encounter_id, 'caregiver_invite_cancelled', (select auth.uid()), 'patient', jsonb_build_object('pass_id', p.id));
  return true;
end $$;
revoke all on function public.cancel_caregiver_invite(uuid) from public, anon;
grant execute on function public.cancel_caregiver_invite(uuid) to authenticated;

create function public.respond_caregiver_consultation_invite(p_pass uuid, p_accept boolean) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.encounter_caregiver_passes;
begin
  if v_uid is null or p_accept is null then raise exception 'caregiver_invite_unavailable' using errcode = '42501'; end if;
  select * into p from public.encounter_caregiver_passes where id = p_pass and caregiver_id = v_uid for update;
  -- only the invited person; an unknown, expired, ended or already answered invite all read the same
  if p.id is null or not private.caregiver_pass_usable(p.id, array['invited'], false) then
    raise exception 'caregiver_invite_unavailable' using errcode = 'P0001';
  end if;
  -- the invite had to be answered in time (inviteExpiryMinutes); once accepted it lasts for the call, up to the close of its join window
  update public.encounter_caregiver_passes
     set state = case when p_accept then 'accepted' else 'declined' end,
         accepted_at = case when p_accept then now() else null end,
         expires_at = case when p_accept then (select private.encounter_join_closes_at(e) from public.encounters e where e.id = p.encounter_id) else expires_at end
   where id = p.id;
  perform private.log_encounter_event(p.encounter_id, case when p_accept then 'caregiver_accepted' else 'caregiver_declined' end,
                                      v_uid, 'caregiver', jsonb_build_object('pass_id', p.id));
  return true;
end $$;
revoke all on function public.respond_caregiver_consultation_invite(uuid, boolean) from public, anon;
grant execute on function public.respond_caregiver_consultation_invite(uuid, boolean) to authenticated;

-- The assigned clinician removes a caregiver from THIS call. Final: the pass can never be used again and the person cannot be re-invited
-- to the call. The caregiver is told nothing (a "you were removed" message can cause conflict at home, S29); their page just says the call
-- is not available. Someone already inside the video room is removed in the vendor's own participant list (OQ-CGJ-2).
create function public.remove_caregiver_from_consultation(p_pass uuid, p_reason_code text default null) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.encounter_caregiver_passes;
  e public.encounters;
  v_reason text := nullif(btrim(coalesce(p_reason_code, '')), '');
begin
  if v_uid is null then raise exception 'caregiver_remove_not_allowed' using errcode = '42501'; end if;
  select * into p from public.encounter_caregiver_passes where id = p_pass for update;
  if p.id is not null then select * into e from public.encounters where id = p.encounter_id; end if;
  if p.id is null or e.id is null or e.clinician_id is distinct from v_uid then
    raise exception 'caregiver_remove_not_allowed' using errcode = '42501';
  end if;
  if v_reason is not null and v_reason !~ '^[a-z_]{1,40}$' then raise exception 'caregiver_remove_reason_invalid' using errcode = '22023'; end if;
  if p.state = 'removed' then return true; end if;
  if p.state not in ('invited', 'accepted') then return false; end if;
  update public.encounter_caregiver_passes set state = 'removed', removed_at = now(), removed_by = v_uid where id = p.id;
  perform private.log_encounter_event(p.encounter_id, 'caregiver_removed', v_uid, 'clinician',
                                      jsonb_strip_nulls(jsonb_build_object('pass_id', p.id, 'reason_code', v_reason)));
  return true;
end $$;
revoke all on function public.remove_caregiver_from_consultation(uuid, text) from public, anon;
grant execute on function public.remove_caregiver_from_consultation(uuid, text) to authenticated;

-- The caregiver's own client says they left. Best effort; only for a pass that was accepted.
create function public.report_caregiver_left(p_encounter uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  p public.encounter_caregiver_passes;
begin
  if v_uid is null then raise exception 'caregiver_invite_unavailable' using errcode = '42501'; end if;
  select * into p from public.encounter_caregiver_passes
   where encounter_id = p_encounter and caregiver_id = v_uid and state = 'accepted' limit 1;
  if p.id is null then return false; end if;
  -- only a person recorded as being in the call can be recorded as leaving it, once per join (the log cannot be filled by repeating this)
  if coalesce((select ev.kind from public.encounter_events ev
                where ev.encounter_id = p.encounter_id and ev.kind in ('caregiver_joined', 'caregiver_left') and ev.payload ->> 'pass_id' = p.id::text
                order by ev.created_at desc, ev.id desc limit 1), '') <> 'caregiver_joined' then
    return false;
  end if;
  perform private.log_encounter_event(p.encounter_id, 'caregiver_left', v_uid, 'caregiver', jsonb_build_object('pass_id', p.id));
  return true;
end $$;
revoke all on function public.report_caregiver_left(uuid) from public, anon;
grant execute on function public.report_caregiver_left(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Reads: what the patient, the clinician and the caregiver may see (relationship label and state only)
-- ---------------------------------------------------------------------------
create function public.consultation_caregivers(p_encounter uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  e public.encounters;
  cfg jsonb := private.caregiver_rules();
  v_clin boolean;
  v_pat boolean;
  v_live boolean;
begin
  if v_uid is null then return null; end if;
  select * into e from public.encounters where id = p_encounter;
  if e.id is null then return null; end if;
  v_clin := v_uid = e.clinician_id;
  v_pat := private.caregiver_invite_actor_ok(e.patient_id);
  if not (v_clin or v_pat) then return null; end if;
  v_live := e.status in ('scheduled', 'waiting', 'in_progress') and private.encounter_is_on(e) and now() <= private.encounter_join_closes_at(e);
  return jsonb_build_object(
    'role', case when v_clin then 'clinician' else 'patient' end,
    'live', v_live,
    'max', (cfg ->> 'maxCaregiversPerCall')::integer,
    'passes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'pass_id', p.id,
               'relationship', p.relationship,
               'state', p.state,
               'expires_at', p.expires_at,
               -- in the call now = the latest of their joined and left events is a join
               'present', p.state = 'accepted' and coalesce((
                   select ev.kind = 'caregiver_joined' from public.encounter_events ev
                    where ev.encounter_id = p.encounter_id and ev.kind in ('caregiver_joined', 'caregiver_left')
                      and ev.payload ->> 'pass_id' = p.id::text
                    order by ev.created_at desc, ev.id desc limit 1), false),
               'removable', v_clin and p.state in ('invited', 'accepted'),
               -- a patient knows who they invited; the clinician is given the relationship label and nothing else
               'name', case when v_clin then null else coalesce(nullif(btrim(s.full_name), ''), 'A supporter') end)
             order by p.created_at)
        from public.encounter_caregiver_passes p join public.profiles s on s.id = p.caregiver_id
       where p.encounter_id = e.id
         and ((p.state in ('invited', 'accepted') and (p.expires_at > now() or e.status = 'in_progress'))
              or (p.state = 'declined' and not v_clin)
              or p.state = 'removed')), '[]'::jsonb),
    'invitable', case when v_clin or not v_live or cfg is null then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('member_id', m.id, 'name', coalesce(nullif(btrim(s.full_name), ''), 'A supporter'),
                                          'relationship', m.relationship) order by m.created_at)
        from public.care_circle_members m join public.profiles s on s.id = m.supporter_id
       where m.patient_id = e.patient_id
         and private.caregiver_member_ok(m.id, m.patient_id, m.supporter_id)
         and m.supporter_id is distinct from e.clinician_id
         and private.caregiver_age_ok(m.supporter_id, cfg)
         and not exists (select 1 from public.encounter_caregiver_passes p
                          where p.encounter_id = e.id and p.caregiver_id = m.supporter_id
                            and (p.state = 'removed' or (p.state in ('invited', 'accepted') and p.expires_at > now())))), '[]'::jsonb) end);
end $$;
revoke all on function public.consultation_caregivers(uuid) from public, anon;
grant execute on function public.consultation_caregivers(uuid) to authenticated;

-- The caregiver's own invites: the supporter page lists them and the room page reads its one row. Only a first name, a time and a state.
create function public.my_consultation_invites() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'pass_id', p.id, 'encounter_id', p.encounter_id, 'patient_id', p.patient_id,
           'patient_first_name', coalesce(nullif(split_part(btrim(pt.full_name), ' ', 1), ''), 'Someone'),
           'relationship', p.relationship, 'state', p.state, 'scheduled_at', e.scheduled_at, 'expires_at', p.expires_at,
           'join_opens_at', private.encounter_join_opens_at(e), 'join_closes_at', private.encounter_join_closes_at(e),
           'joinable', p.state = 'accepted' and now() >= private.encounter_join_opens_at(e) and now() <= private.encounter_join_closes_at(e),
           'final_media_mode', e.final_media_mode) order by e.scheduled_at), '[]'::jsonb)
    from public.encounter_caregiver_passes p
    join public.encounters e on e.id = p.encounter_id
    join public.profiles pt on pt.id = p.patient_id
   where p.caregiver_id = (select auth.uid())
     and private.caregiver_pass_usable(p.id, array['invited', 'accepted'], false)
$$;
revoke all on function public.my_consultation_invites() from public, anon;
grant execute on function public.my_consultation_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Server-only: the credential check and presence (service_role alone)
-- ---------------------------------------------------------------------------
-- Mirrors how the two people on a call are found: the server action has checked the signed-in id, and passes it here. Answers a pass only
-- when it can be used RIGHT NOW to enter the call; nothing about the person.
create function public.service_get_caregiver_pass(p_encounter uuid, p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare p public.encounter_caregiver_passes;
begin
  select * into p from public.encounter_caregiver_passes
   where encounter_id = p_encounter and caregiver_id = p_user and state = 'accepted' limit 1;
  if p.id is null or not private.caregiver_pass_usable(p.id, array['accepted'], true) then return null; end if;
  return jsonb_build_object('pass_id', p.id);
end $$;
revoke all on function public.service_get_caregiver_pass(uuid, uuid) from public, anon, authenticated;
grant execute on function public.service_get_caregiver_pass(uuid, uuid) to service_role;

-- Every pass of a consultation, in any state: the webhook checks a key against these, and a removed pass must still verify as itself so
-- a re-entry can be seen and refused rather than looking like an unknown key.
create function public.service_caregiver_pass_ids(p_encounter uuid) returns uuid[]
language sql stable security definer set search_path = ''
as $$ select coalesce(array_agg(id order by created_at), '{}'::uuid[]) from public.encounter_caregiver_passes where encounter_id = p_encounter $$;
revoke all on function public.service_caregiver_pass_ids(uuid) from public, anon, authenticated;
grant execute on function public.service_caregiver_pass_ids(uuid) to service_role;

create function public.service_record_caregiver_event(p_pass uuid, p_kind text, p_mode text default 'unknown') returns text
language plpgsql security definer set search_path = ''
as $$
declare
  p public.encounter_caregiver_passes;
  v_mode text := case when p_mode in ('video', 'audio_only') then p_mode else 'unknown' end;
begin
  if p_kind not in ('caregiver_joined', 'caregiver_left') then raise exception 'that event cannot be recorded here' using errcode = '22023'; end if;
  select * into p from public.encounter_caregiver_passes where id = p_pass for update;
  if p.id is null then raise exception 'caregiver invite not found' using errcode = 'P0002'; end if;
  if p_kind = 'caregiver_joined' then
    if p.state = 'removed' then return 'refused_removed'; end if;
    if not private.caregiver_pass_usable(p.id, array['accepted'], true) then return 'refused'; end if;
    perform private.log_encounter_event(p.encounter_id, 'caregiver_joined', p.caregiver_id, 'caregiver', jsonb_build_object('pass_id', p.id, 'mode', v_mode));
    return 'recorded';
  end if;
  -- leaving is always recordable for a person who was let in, even after a removal or the end of the call
  if p.state not in ('accepted', 'removed') then return 'refused'; end if;
  perform private.log_encounter_event(p.encounter_id, 'caregiver_left', p.caregiver_id, 'caregiver', jsonb_build_object('pass_id', p.id));
  return 'recorded';
end $$;
revoke all on function public.service_record_caregiver_event(uuid, text, text) from public, anon, authenticated;
grant execute on function public.service_record_caregiver_event(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- 9. Self-check: this migration proves what it promised
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.service_get_caregiver_pass(uuid,uuid)', 'public.service_caregiver_pass_ids(uuid)', 'public.service_record_caregiver_event(uuid,text,text)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'CGJ: % is callable by a signed-in or anonymous user', f;
    end if;
    if not has_function_privilege('service_role', f, 'EXECUTE') then raise exception 'CGJ: service_role cannot call %', f; end if;
  end loop;
  foreach f in array array[
    'public.invite_caregiver_to_consultation(uuid,uuid)', 'public.cancel_caregiver_invite(uuid)',
    'public.respond_caregiver_consultation_invite(uuid,boolean)', 'public.remove_caregiver_from_consultation(uuid,text)',
    'public.report_caregiver_left(uuid)', 'public.consultation_caregivers(uuid)', 'public.my_consultation_invites()'] loop
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'CGJ: anon can execute %', f; end if;
    if not has_function_privilege('authenticated', f, 'EXECUTE') then raise exception 'CGJ: authenticated cannot execute %', f; end if;
  end loop;
  if has_table_privilege('anon', 'public.encounter_caregiver_passes', 'SELECT') or has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'INSERT')
     or has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'UPDATE') or has_table_privilege('authenticated', 'public.encounter_caregiver_passes', 'DELETE') then
    raise exception 'CGJ: a pass table privilege is wider than read-only for signed-in users';
  end if;
  if has_column_privilege('authenticated', 'public.encounter_caregiver_passes', 'removed_by', 'SELECT') or has_column_privilege('authenticated', 'public.encounter_caregiver_passes', 'invited_by', 'SELECT') then
    raise exception 'CGJ: who invited or removed is readable by a signed-in user';
  end if;
  if not has_column_privilege('authenticated', 'public.encounter_caregiver_passes', 'state', 'SELECT') then raise exception 'CGJ: authenticated cannot read the pass state'; end if;
  if not private.circle_permissions_valid(array['attend_consultation']) or private.circle_permissions_valid(array['attend_consultation', 'attend_consultation']) then
    raise exception 'CGJ: the permission list is wrong';
  end if;
  if (select count(*) from public.consultation_caregiver_config where is_active) <> 1 then raise exception 'CGJ: exactly one active config row expected'; end if;
end $$;

-- Front Desk M2: the follow-up engine (spec F6 to F10).
--
-- WHAT THIS ADDS. Everything that turns "a sign-up stalled" into "the right email, once, at a sensible hour, to someone who may be
-- emailed" without a person in the loop:
--   * service_fd_detect()          F7  finds contacts to follow up (new accounts, stalled onboarding, risk check not done, silent for 7
--                                       days), creates their contact + consent rows, derives funnel events, schedules a run per step, and
--                                       cancels runs whose goal has since been reached. Runs on pg_cron every 15 minutes.
--   * service_fd_claim_runs()      F8  applies EVERY sending rule in one place (kill switch, dry-run, quiet hours, consent, suppression,
--                                       goal reached, weekly cap, minimum gap, approved wording, staleness) and hands the Edge Function
--                                       only what may be sent. The Edge Function (fd-followup-dispatcher) renders and sends.
--   * service_fd_finish_run()      F8  records the outcome; a failure retries after an hour, at most 3 attempts.
--   * service_fd_record_event()    F6  app events (pricing viewed, checkout started, ...) that cancel runs whose goal they are.
--   * private.fd_suppress_contact  F9/F10  a bounce or complaint (via notification_email_suppressions) or an unsubscribe suppresses the
--                                       contact, withdraws every consent and cancels scheduled runs, at once.
--   * admin RPCs: fd_followup_overview() for the console, fd_rearm_dry_run_runs() to go live without losing what dry-run held back.
--
-- DESIGN DECISIONS.
--   * DETECTION, NOT TRIGGERS. Nothing is attached to profiles, orders or auth.users: a bug here must never be able to slow or break
--     signup, checkout or the risk check. The detector reads those tables every 15 minutes instead, and the dispatcher re-checks the
--     goal against the live tables at send time, so "completion stops it" is true to the second, not to the last 15 minutes.
--   * FAIL SAFE DRY-RUN. Anything other than an explicit JSON false in followups_dry_run is treated as dry-run.
--   * NOTHING FLUSHES ON GO-LIVE. A run more than 3 days overdue is skipped as stale, and dry-run holds back runs as skipped/dry_run
--     (visible, counted) that fd_rearm_dry_run_runs() puts back only if still fresh. Switching dry-run off therefore sends the recent
--     backlog once, not a stale flood.
--   * A STALL FOUND LATE IS TREATED AS STALLING NOW. A sign-up found stalled a week after it began is anchored at "now minus the stall
--     window", so its first email goes out straight away instead of being born stale. This is the person who started twice and was
--     never answered.
--   * ONE EMAIL PER CONTACT PER 12 HOURS, and at most weekly_send_cap per rolling 7 days (spec: 3). Over the cap a run is skipped.
--   * Account-setup reminders to someone with an account rest on basis 'contract' (consent row 'service_followup'); marketing sequences
--     are enrolled only for a contact with a live 'marketing' consent. The wording hash recorded is of the text below, for the DPO.
--   * Email only, English only (FD-1, FD-2).

alter table public.fd_followup_runs add column if not exists claimed_at timestamptz;

-- When one contact has several runs due, the lower number goes first (the others wait behind the 12 hour gap). Data, not code: a stalled
-- sign-up must hear "finish setting up" before the welcome series tells them to "start the risk check".
alter table public.fd_sequences add column if not exists priority smallint not null default 50 check (priority between 1 and 100);
update public.fd_sequences set priority = case key
  when 'finish_signup' then 10 when 'risk_check_nudge' then 20 when 'welcome' then 30 when 'post_enquiry' then 30
  when 'reengage_7d' then 60 when 'health_check_interest' then 70 else priority end
 where organisation_id = '00000000-0000-0000-0000-000000000001';
create index if not exists fd_followup_runs_sending_idx on public.fd_followup_runs (claimed_at) where state = 'sending';

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 1. Small helpers
-- ---------------------------------------------------------------------------------------------------------------------------------
create function private.fd_cfg(p_key text) returns jsonb language sql stable security definer set search_path = '' as $$
  select value from public.fd_app_config where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_key
$$;

create function private.fd_cfg_int(p_key text, p_default integer) returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((select case when jsonb_typeof(value) = 'number' then (value #>> '{}')::numeric::integer end
                     from public.fd_app_config where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_key), p_default)
$$;

-- True inside the configured quiet window (default 21:00 to 07:00 Africa/Lagos). A missing or malformed setting means quiet: fail safe.
create function private.fd_in_quiet_hours(p_at timestamptz default now()) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare q jsonb := private.fd_cfg('quiet_hours'); s time; e time; t time;
begin
  if q is null then return true; end if;
  begin
    s := (q ->> 'start')::time; e := (q ->> 'end')::time; t := (p_at at time zone (q ->> 'timezone'))::time;
  exception when others then
    return true;
  end;
  if s is null or e is null or t is null then return true; end if;
  if s > e then return t >= s or t < e; end if;
  return t >= s and t < e;
end $$;

create function private.fd_email_ok(p_email text) returns boolean language sql immutable set search_path = '' as $$
  select p_email is not null and p_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' and char_length(p_email) <= 200
$$;

-- The contact for this person: matched by app user first, then by email. Never creates a second contact for one email.
create function private.fd_ensure_contact(p_email text, p_name text, p_app_user uuid, p_source text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_org constant uuid := '00000000-0000-0000-0000-000000000001'; v_email text := lower(btrim(p_email));
begin
  select id into v_id from public.fd_contacts
   where organisation_id = v_org and ((p_app_user is not null and app_user_id = p_app_user) or email = v_email)
   order by (app_user_id = p_app_user) desc nulls last limit 1;
  if v_id is null then
    insert into public.fd_contacts (email, name, app_user_id, source, lifecycle_stage)
    values (v_email, nullif(btrim(p_name), ''), p_app_user, p_source, case when p_app_user is null then 'enquiry' else 'signed_up' end)
    returning id into v_id;
  else
    update public.fd_contacts
       set app_user_id = coalesce(app_user_id, p_app_user), name = coalesce(name, nullif(btrim(p_name), '')),
           email = coalesce(email, v_email),
           lifecycle_stage = case when p_app_user is not null and lifecycle_stage = 'enquiry' then 'signed_up' else lifecycle_stage end,
           updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

create function private.fd_record_consent(p_contact uuid, p_channel text, p_purpose text, p_basis text, p_version text, p_wording text, p_source text)
returns void language sql security definer set search_path = '' as $$
  insert into public.fd_consents (contact_id, channel, purpose, lawful_basis, evidence_hash, wording_version, source)
  values (p_contact, p_channel, p_purpose, p_basis, encode(sha256(convert_to(p_wording, 'UTF8')), 'hex'), p_version, p_source)
  on conflict (contact_id, channel, purpose) where withdrawn_at is null do nothing
$$;

create function private.fd_has_consent(p_contact uuid, p_purpose text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.fd_consents where contact_id = p_contact and channel = 'email' and purpose = p_purpose and withdrawn_at is null)
$$;

-- Has this contact already done what the sequence exists to make them do? Reads the LIVE tables (and app events), so it is true to the second.
create function private.fd_goal_reached(p_contact uuid, p_stops text[], p_since timestamptz) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p_stops, '{}') <> '{}' and exists (
    select 1 from public.fd_contacts c
     where c.id = p_contact
       and (
         ('onboarding_completed' = any (p_stops) and c.app_user_id is not null
            and exists (select 1 from public.profiles p where p.id = c.app_user_id and p.onboarding_completed_at is not null))
         or ('risk_check_done' = any (p_stops) and c.app_user_id is not null
            and exists (select 1 from public.patient_risk_scores s where s.patient_id = c.app_user_id))
         or ('paid' = any (p_stops) and c.app_user_id is not null
            and exists (select 1 from public.orders o where o.buyer_profile_id = c.app_user_id and o.state = 'paid'))
         or ('app_active' = any (p_stops) and c.app_user_id is not null
            and exists (select 1 from auth.users u where u.id = c.app_user_id and u.last_sign_in_at > p_since))
         or ('account_created' = any (p_stops) and c.app_user_id is not null)
         or exists (select 1 from public.fd_funnel_events e
                     where e.contact_id = c.id and e.event_type = any (p_stops) and e.occurred_at >= p_since)
       ))
$$;

-- Schedules one run per step of a sequence. Needs a usable, unsuppressed contact with live consent for the sequence's purpose, otherwise
-- schedules nothing (a marketing sequence is never started for someone who has not agreed to marketing). Idempotent per enrolment key.
create function private.fd_enrol(p_contact uuid, p_sequence_key text, p_anchor timestamptz, p_enrolment_key text) returns integer
language plpgsql security definer set search_path = '' as $$
declare s record; c record; n integer;
begin
  select * into s from public.fd_sequences where organisation_id = '00000000-0000-0000-0000-000000000001' and key = p_sequence_key and active;
  if not found then return 0; end if;
  select * into c from public.fd_contacts where id = p_contact;
  if not found or c.suppressed or not private.fd_email_ok(c.email) then return 0; end if;
  if not private.fd_has_consent(p_contact, s.purpose) then return 0; end if;
  insert into public.fd_followup_runs (contact_id, sequence_id, step_id, enrolment_key, state, scheduled_for, skip_reason)
  select p_contact, s.id, st.id, p_enrolment_key,
         case when p_anchor + make_interval(mins => st.delay_minutes) < now() - interval '3 days' then 'skipped' else 'scheduled' end,
         p_anchor + make_interval(mins => st.delay_minutes),
         case when p_anchor + make_interval(mins => st.delay_minutes) < now() - interval '3 days' then 'stale' end
    from public.fd_sequence_steps st where st.sequence_id = s.id
  on conflict (contact_id, step_id, enrolment_key) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- Suppress: stop everything for this contact, now. Used by unsubscribe, STOP, bounces and complaints.
create function private.fd_suppress_contact(p_contact uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.fd_contacts set suppressed = true, suppressed_reason = p_reason, updated_at = now() where id = p_contact;
  update public.fd_consents set withdrawn_at = now() where contact_id = p_contact and withdrawn_at is null;
  update public.fd_followup_runs set state = 'cancelled' where contact_id = p_contact and state in ('scheduled', 'sending');
  perform private.fd_audit('suppress', 'fd_contacts', p_contact::text, jsonb_build_object('reason', p_reason), 'system');
end $$;

create function private.fd_suppress_email(p_email text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  for v_id in select id from public.fd_contacts where email = lower(btrim(p_email)) and not suppressed loop
    perform private.fd_suppress_contact(v_id, p_reason);
  end loop;
end $$;

-- F9: a bounce or complaint recorded by the Resend webhook (notification_email_suppressions) also suppresses the front desk contact.
-- It must never stop the webhook from recording the suppression, so a failure here is a warning, not an error.
create function private.fd_on_email_suppressed() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform private.fd_suppress_email(new.email, case new.reason when 'complained' then 'complained' else 'bounced' end);
  return new;
exception when others then
  raise warning 'fd: could not suppress front desk contact for a suppressed address: %', sqlerrm;
  return new;
end $$;
create trigger fd_on_email_suppressed after insert on public.notification_email_suppressions
  for each row execute function private.fd_on_email_suppressed();

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 2. F7: the detector
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_detect() returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; v_contact uuid;
  v_new int := 0; v_events int := 0; v_welcome int := 0; v_risk int := 0; v_stall int := 0; v_inactive int := 0; v_cancelled int := 0; v_n int;
  v_stall_min int := private.fd_cfg_int('stall_minutes', 60);
  v_inactive_days int := private.fd_cfg_int('inactive_days', 7);
  v_wording constant text := 'TarragonHealth account terms: we may email you about setting up and using your account.';
begin
  if not pg_try_advisory_xact_lock(7771001) then return jsonb_build_object('skipped', 'locked'); end if;
  if private.fd_cfg('followups_enabled') is distinct from 'true'::jsonb then return jsonb_build_object('skipped', 'followups_disabled'); end if;

  -- (a) New accounts with a confirmed email: a contact, an account-follow-up consent (basis: contract), the account_created event, the welcome sequence.
  for r in
    select p.id as uid, p.full_name, p.created_at, lower(u.email) as email
      from public.profiles p join auth.users u on u.id = p.id
     where p.role = 'patient' and p.is_active and not p.is_test
       and p.created_at > now() - interval '30 days'
       and u.email_confirmed_at is not null and private.fd_email_ok(lower(u.email))
       and not exists (select 1 from public.fd_contacts c where c.app_user_id = p.id)
  loop
    v_contact := private.fd_ensure_contact(r.email, r.full_name, r.uid, 'app_signup');
    perform private.fd_record_consent(v_contact, 'email', 'service_followup', 'contract', 'account-followup-v1', v_wording, 'account_signup');
    v_new := v_new + 1;
  end loop;

  -- (b) Derived funnel events for app users who have a contact (idempotent by dedupe key).
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, occurred_at, dedupe_key)
  select c.id, c.app_user_id, 'account_created', p.created_at, 'account_created:' || p.id
    from public.fd_contacts c join public.profiles p on p.id = c.app_user_id
  on conflict (organisation_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_events := v_events + v_n;
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, occurred_at, dedupe_key)
  select c.id, c.app_user_id, 'onboarding_completed', p.onboarding_completed_at, 'onboarding_completed:' || p.id
    from public.fd_contacts c join public.profiles p on p.id = c.app_user_id where p.onboarding_completed_at is not null
  on conflict (organisation_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_events := v_events + v_n;
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, occurred_at, dedupe_key)
  select c.id, c.app_user_id, 'risk_check_done', min(s.computed_at), 'risk_check_done:' || c.app_user_id
    from public.fd_contacts c join public.patient_risk_scores s on s.patient_id = c.app_user_id group by c.id, c.app_user_id
  on conflict (organisation_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_events := v_events + v_n;
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, occurred_at, dedupe_key)
  select c.id, c.app_user_id, 'paid', min(o.paid_at), 'paid:' || c.app_user_id
    from public.fd_contacts c join public.orders o on o.buyer_profile_id = c.app_user_id and o.state = 'paid' and o.paid_at is not null
   group by c.id, c.app_user_id
  on conflict (organisation_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_events := v_events + v_n;
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, occurred_at, dedupe_key)
  select c.id, c.app_user_id, 'app_active', u.last_sign_in_at, 'app_active:' || c.app_user_id || ':' || to_char(u.last_sign_in_at at time zone 'UTC', 'YYYY-MM-DD')
    from public.fd_contacts c join auth.users u on u.id = c.app_user_id where u.last_sign_in_at is not null
  on conflict (organisation_id, dedupe_key) do nothing;
  get diagnostics v_n = row_count; v_events := v_events + v_n;

  -- Lifecycle stage follows the furthest event reached.
  update public.fd_contacts c set updated_at = now(), lifecycle_stage = case
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'paid') then 'paying'
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'risk_check_done') then 'risk_checked'
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'onboarding_completed') then 'onboarded'
      else c.lifecycle_stage end
   where c.app_user_id is not null
     and c.lifecycle_stage <> case
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'paid') then 'paying'
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'risk_check_done') then 'risk_checked'
      when exists (select 1 from public.fd_funnel_events e where e.contact_id = c.id and e.event_type = 'onboarding_completed') then 'onboarded'
      else c.lifecycle_stage end;

  -- (c) Welcome for contacts created from an account in the last 30 days.
  for r in
    select c.id as cid, p.id as uid, p.created_at from public.fd_contacts c join public.profiles p on p.id = c.app_user_id
     where p.created_at > now() - interval '30 days' and not c.suppressed
  loop
    v_welcome := v_welcome + private.fd_enrol(r.cid, 'welcome', r.created_at, 'welcome:' || r.uid);
  end loop;

  -- (d) Onboarded in the last 45 days, no risk check yet: the risk check reminder, counted from completion.
  for r in
    select c.id as cid, p.id as uid, p.onboarding_completed_at as at from public.fd_contacts c join public.profiles p on p.id = c.app_user_id
     where p.onboarding_completed_at is not null and p.onboarding_completed_at > now() - interval '45 days' and not c.suppressed
       and not exists (select 1 from public.patient_risk_scores s where s.patient_id = p.id)
  loop
    v_risk := v_risk + private.fd_enrol(r.cid, 'risk_check_nudge', r.at, 'risk:' || r.uid);
  end loop;

  -- (e) Stalled: no onboarding completion after the stall window, account under 30 days old. A stall found late is treated as stalling NOW.
  for r in
    select c.id as cid, p.id as uid, p.created_at from public.fd_contacts c join public.profiles p on p.id = c.app_user_id
     where p.onboarding_completed_at is null and p.is_active and not c.suppressed
       and p.created_at <= now() - make_interval(mins => v_stall_min) and p.created_at > now() - interval '30 days'
  loop
    v_stall := v_stall + private.fd_enrol(r.cid, 'finish_signup', greatest(r.created_at, now() - make_interval(mins => v_stall_min)), 'stall:' || r.uid);
  end loop;

  -- (f) Silent for inactive_days (last sign-in), onboarded, silent for under 60 days: re-engage, at most once a quarter.
  for r in
    select c.id as cid, p.id as uid from public.fd_contacts c
      join public.profiles p on p.id = c.app_user_id join auth.users u on u.id = p.id
     where p.onboarding_completed_at is not null and not c.suppressed
       and coalesce(u.last_sign_in_at, p.onboarding_completed_at) < now() - make_interval(days => v_inactive_days)
       and coalesce(u.last_sign_in_at, p.onboarding_completed_at) > now() - interval '60 days'
  loop
    v_inactive := v_inactive + private.fd_enrol(r.cid, 'reengage_7d', now(), 'reengage:' || r.uid || ':' || to_char(date_trunc('quarter', now()), 'YYYY"Q"Q'));
  end loop;

  -- (g) Cancel scheduled runs whose goal has since been reached (a person who finished needs no more nudges).
  update public.fd_followup_runs fr set state = 'cancelled'
    from public.fd_sequences s
   where fr.sequence_id = s.id and fr.state = 'scheduled' and private.fd_goal_reached(fr.contact_id, s.stop_events, fr.created_at);
  get diagnostics v_cancelled = row_count;

  return jsonb_build_object('new_contacts', v_new, 'events', v_events, 'welcome_runs', v_welcome, 'risk_check_runs', v_risk,
                            'stall_runs', v_stall, 'reengage_runs', v_inactive, 'cancelled', v_cancelled);
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 3. F8: claim what may be sent (all the rules, in one place)
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_claim_runs(p_limit integer default 25)
returns table (run_id uuid, contact_id uuid, email text, first_name text, sequence_key text, step_key text, subject text, body_text text, attempt integer)
language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  r record; v_cap int; v_dry boolean; v_reason text;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then p_limit := 25; end if;
  -- Kill switch and quiet hours: nothing is claimed, nothing is changed (runs wait for the next tick).
  if private.fd_cfg('followups_enabled') is distinct from 'true'::jsonb then return; end if;
  if private.fd_in_quiet_hours() then return; end if;
  v_cap := private.fd_cfg_int('weekly_send_cap', 3);
  -- Dry-run unless explicitly, deliberately false.
  v_dry := private.fd_cfg('followups_dry_run') is distinct from 'false'::jsonb;

  update public.fd_followup_runs set state = 'failed', error = 'gave up after 3 attempts'
   where state = 'sending' and claimed_at < now() - interval '15 minutes' and attempts >= 3;

  for r in
    select fr.id as rid, fr.contact_id as cid, fr.scheduled_for as due, fr.created_at as enrolled_at, fr.attempts as tries,
           c.email as em, c.name as nm, c.suppressed as supp,
           s.key as skey, s.purpose as purp, s.stop_events as stops, st.step_key as stkey, st.subject as sj, st.body_text as bt
      from public.fd_followup_runs fr
      join public.fd_contacts c on c.id = fr.contact_id
      join public.fd_sequences s on s.id = fr.sequence_id
      join public.fd_sequence_steps st on st.id = fr.step_id
     where ((fr.state = 'scheduled' and fr.scheduled_for <= now())
            or (fr.state = 'sending' and fr.claimed_at < now() - interval '15 minutes' and fr.attempts < 3))
       -- Deferred, not dropped, so they cannot starve the batch: a paused sequence, wording nobody has approved, or a contact mailed in the last 12 hours.
       and s.active and not s.paused and st.status = 'approved'
       and not exists (select 1 from public.fd_followup_runs x
                        where x.contact_id = fr.contact_id and x.id <> fr.id and x.state in ('sent', 'sending')
                          and coalesce(x.sent_at, x.claimed_at) > now() - interval '12 hours')
     order by s.priority, fr.scheduled_for
     limit p_limit
       for update of fr skip locked
  loop
    v_reason := case
      when r.due < now() - interval '3 days' then 'stale'
      when r.supp or exists (select 1 from public.notification_email_suppressions z where z.email = r.em) then 'suppressed'
      when not private.fd_email_ok(r.em) then 'no_email'
      when not private.fd_has_consent(r.cid, r.purp) then 'no_consent'
      when private.fd_goal_reached(r.cid, r.stops, r.enrolled_at) then 'goal_reached'
      when (select count(*) from public.fd_followup_runs x where x.contact_id = r.cid and x.state = 'sent' and x.sent_at > now() - interval '7 days') >= v_cap then 'weekly_cap'
      else null end;

    if v_reason is not null then
      update public.fd_followup_runs set state = 'skipped', skip_reason = v_reason where id = r.rid;
      continue;
    end if;
    -- Two due runs for one contact in the same batch: the first claim makes the second wait (minimum gap).
    if exists (select 1 from public.fd_followup_runs x where x.contact_id = r.cid and x.id <> r.rid and x.state in ('sent', 'sending')
                  and coalesce(x.sent_at, x.claimed_at) > now() - interval '12 hours') then
      continue;
    end if;
    if v_dry then
      update public.fd_followup_runs set state = 'skipped', skip_reason = 'dry_run', dry_run = true where id = r.rid;
      continue;
    end if;
    update public.fd_followup_runs set state = 'sending', attempts = attempts + 1, claimed_at = now() where id = r.rid;
    run_id := r.rid; contact_id := r.cid; email := r.em; first_name := split_part(coalesce(r.nm, ''), ' ', 1);
    sequence_key := r.skey; step_key := r.stkey; subject := r.sj; body_text := r.bt; attempt := r.tries + 1;
    return next;
  end loop;
end $$;

create function public.service_fd_finish_run(p_run uuid, p_ok boolean, p_message_id text, p_error text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid;
begin
  update public.fd_followup_runs
     set state = case when p_ok then 'sent' when attempts >= 3 then 'failed' else 'scheduled' end,
         sent_at = case when p_ok then now() else sent_at end,
         provider_message_id = case when p_ok then p_message_id else provider_message_id end,
         scheduled_for = case when not p_ok and attempts < 3 then now() + interval '1 hour' else scheduled_for end,
         error = case when p_ok then null else left(coalesce(p_error, 'unknown'), 300) end
   where id = p_run and state = 'sending'
  returning contact_id into v_contact;
  if p_ok and v_contact is not null then
    update public.fd_contacts set last_contacted_at = now() where id = v_contact;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 4. F6 / F10: app events and unsubscribe
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.service_fd_record_event(p_user uuid, p_type text, p_step text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_contact uuid; v_cancelled int := 0;
begin
  if p_type not in ('onboarding_step', 'pricing_viewed', 'checkout_started', 'app_active') then
    return jsonb_build_object('recorded', false, 'reason', 'event_type_not_accepted');
  end if;
  select id into v_contact from public.fd_contacts where organisation_id = '00000000-0000-0000-0000-000000000001' and app_user_id = p_user;
  insert into public.fd_funnel_events (contact_id, app_user_id, event_type, step, dedupe_key)
  values (v_contact, p_user, p_type, left(p_step, 60), left(coalesce(p_key, p_type || ':' || p_user || ':' || to_char(now(), 'YYYY-MM-DD')), 200))
  on conflict (organisation_id, dedupe_key) do nothing;
  if v_contact is not null then
    update public.fd_followup_runs fr set state = 'cancelled'
      from public.fd_sequences s
     where fr.sequence_id = s.id and fr.contact_id = v_contact and fr.state = 'scheduled' and p_type = any (s.stop_events);
    get diagnostics v_cancelled = row_count;
  end if;
  return jsonb_build_object('recorded', true, 'cancelled', v_cancelled);
end $$;

create function public.service_fd_unsubscribe(p_contact uuid) returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.fd_contacts where id = p_contact) then return false; end if;
  perform private.fd_suppress_contact(p_contact, 'unsubscribed');
  return true;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 5. Console: overview and "go live without losing what dry-run held back"
-- ---------------------------------------------------------------------------------------------------------------------------------
create function public.fd_followup_overview() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.fd_require_staff();
  return jsonb_build_object(
    'followups_enabled', private.fd_cfg('followups_enabled'),
    'followups_dry_run', private.fd_cfg('followups_dry_run'),
    'in_quiet_hours', private.fd_in_quiet_hours(),
    'approved_steps', (select count(*) from public.fd_sequence_steps where status = 'approved'),
    'total_steps', (select count(*) from public.fd_sequence_steps),
    'by_state', coalesce((select jsonb_object_agg(state, n) from (select state, count(*) n from public.fd_followup_runs group by state) q), '{}'::jsonb),
    'skipped_last_7d', coalesce((select jsonb_object_agg(skip_reason, n) from (
        select skip_reason, count(*) n from public.fd_followup_runs where state = 'skipped' and created_at > now() - interval '7 days' group by skip_reason) q), '{}'::jsonb),
    'sent_last_7d', (select count(*) from public.fd_followup_runs where state = 'sent' and sent_at > now() - interval '7 days'),
    'contacts', (select count(*) from public.fd_contacts),
    'suppressed', (select count(*) from public.fd_contacts where suppressed),
    'recent', coalesce((select jsonb_agg(to_jsonb(q) order by q.at desc) from (
        select fr.id, st.step_key, fr.state, fr.skip_reason, fr.dry_run, fr.scheduled_for as at,
               left(c.email, 2) || '***@' || split_part(c.email, '@', 2) as who
          from public.fd_followup_runs fr
          join public.fd_sequence_steps st on st.id = fr.step_id join public.fd_contacts c on c.id = fr.contact_id
         order by fr.scheduled_for desc limit 30) q), '[]'::jsonb));
end $$;

create function public.fd_rearm_dry_run_runs() returns integer language plpgsql security definer set search_path = '' as $$
declare v_n int;
begin
  perform private.fd_require_admin();
  update public.fd_followup_runs set state = 'scheduled', skip_reason = null, dry_run = false
   where state = 'skipped' and skip_reason = 'dry_run' and scheduled_for > now() - interval '3 days';
  get diagnostics v_n = row_count;
  perform private.fd_audit('rearm_dry_run_runs', 'fd_followup_runs', null, jsonb_build_object('rearmed', v_n));
  return v_n;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 6. Grants
-- ---------------------------------------------------------------------------------------------------------------------------------
revoke all on function private.fd_cfg(text) from public, anon, authenticated;
revoke all on function private.fd_cfg_int(text, integer) from public, anon, authenticated;
revoke all on function private.fd_in_quiet_hours(timestamptz) from public, anon, authenticated;
revoke all on function private.fd_email_ok(text) from public, anon, authenticated;
revoke all on function private.fd_ensure_contact(text, text, uuid, text) from public, anon, authenticated;
revoke all on function private.fd_record_consent(uuid, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function private.fd_has_consent(uuid, text) from public, anon, authenticated;
revoke all on function private.fd_goal_reached(uuid, text[], timestamptz) from public, anon, authenticated;
revoke all on function private.fd_enrol(uuid, text, timestamptz, text) from public, anon, authenticated;
revoke all on function private.fd_suppress_contact(uuid, text) from public, anon, authenticated;
revoke all on function private.fd_suppress_email(text, text) from public, anon, authenticated;
revoke all on function private.fd_on_email_suppressed() from public, anon, authenticated;
revoke all on function public.service_fd_detect() from public, anon, authenticated;
revoke all on function public.service_fd_claim_runs(integer) from public, anon, authenticated;
revoke all on function public.service_fd_finish_run(uuid, boolean, text, text) from public, anon, authenticated;
revoke all on function public.service_fd_record_event(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.service_fd_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.service_fd_detect() to service_role;
grant execute on function public.service_fd_claim_runs(integer) to service_role;
grant execute on function public.service_fd_finish_run(uuid, boolean, text, text) to service_role;
grant execute on function public.service_fd_record_event(uuid, text, text, text) to service_role;
grant execute on function public.service_fd_unsubscribe(uuid) to service_role;
revoke all on function public.fd_followup_overview() from public, anon;
revoke all on function public.fd_rearm_dry_run_runs() from public, anon;
grant execute on function public.fd_followup_overview() to authenticated;
grant execute on function public.fd_rearm_dry_run_runs() to authenticated;
-- fd_rearm_dry_run_runs() relies on the admin-only gate M1 defines; fail loudly if it is ever missing.
do $$
begin
  if to_regprocedure('private.fd_require_admin()') is null then
    raise exception 'fd M2: private.fd_require_admin() is missing (M1 defines it)';
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 7. Schedules. The dispatcher call fails closed until the Vault secret fd_followup_secret exists and the function has the same value as
--    FD_FOLLOWUP_SECRET. It does nothing while the master switch is off.
-- ---------------------------------------------------------------------------------------------------------------------------------
select cron.schedule('fd-detect', '*/15 * * * *', $$ select public.service_fd_detect(); $$);
select cron.schedule(
  'fd-dispatch',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/fd-followup-dispatcher',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-fd-followup-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'fd_followup_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 55000
  ) as request_id
  where private.fd_cfg('followups_enabled') = 'true'::jsonb;
  $$
);

-- ---------------------------------------------------------------------------------------------------------------------------------
-- 8. Self-check
-- ---------------------------------------------------------------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['public.service_fd_detect()', 'public.service_fd_claim_runs(integer)', 'public.service_fd_finish_run(uuid, boolean, text, text)',
                           'public.service_fd_record_event(uuid, text, text, text)', 'public.service_fd_unsubscribe(uuid)'] loop
    if has_function_privilege('anon', f, 'EXECUTE') or has_function_privilege('authenticated', f, 'EXECUTE') then
      raise exception 'fd M2: % is callable by a non service role', f;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.fd_followup_overview()', 'EXECUTE') then raise exception 'fd M2: anon can read the overview'; end if;
  if not exists (select 1 from cron.job where jobname = 'fd-detect') or not exists (select 1 from cron.job where jobname = 'fd-dispatch') then
    raise exception 'fd M2: the schedules were not created';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'fd_on_email_suppressed') then raise exception 'fd M2: the bounce trigger is missing'; end if;
end $$;

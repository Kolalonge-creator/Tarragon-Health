-- S03 (v5 1.6): assisted account recovery by the support team, as an audited two-person admin function.
-- Design: docs/design/S03.md (recovery half). Invariants: INV-10 (audit), INV-07 (neutral notices), INV-08 (no SMS).
--
-- Counted live 2026-09-30: 1 active admin profile (0 test). With one admin the two-person rule cannot be met, so this
-- feature is inert until a second admin exists. Deliberately NO sole-admin break-glass path: a path that lets one person
-- recover an account alone is exactly the silent takeover this table exists to prevent.
--
-- What the database does: state, authorisation, audit. It never sets a password, never stores or returns a secret, a full
-- phone, a full email or a date of birth. The secret-bearing Auth calls live in a Next.js server action.

create or replace function private.valid_identity_checks(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p) = 'object'
     and not exists (
           select 1 from jsonb_each(p) e
            where e.key not in ('date_of_birth','last_payment_reference','callback_to_verified_number',
                                'recent_appointment_detail','id_document_sighted')
               or jsonb_typeof(e.value) <> 'boolean')
     and (select count(*) from jsonb_each(p) e where e.value = 'true'::jsonb) >= 2;
$$;
revoke all on function private.valid_identity_checks(jsonb) from public, anon;

create table public.account_recovery_requests (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations(id) on delete restrict,
  created_at          timestamptz not null default now(),
  subject_user_id     uuid not null references auth.users(id) on delete restrict,
  requested_by        uuid not null references auth.users(id) on delete restrict,
  reason              text not null check (char_length(btrim(reason)) >= 20),
  identity_checks     jsonb not null check (private.valid_identity_checks(identity_checks)),
  method              text not null check (method in ('email_link_to_verified_email', 'new_phone_reverification')),
  state               text not null default 'requested' check (state in ('requested','approved','executed','rejected','expired')),
  sim_swap_risk       boolean not null default false,
  sim_swap_reviewed_by uuid references auth.users(id) on delete restrict,
  sim_swap_reviewed_at timestamptz,
  approved_by         uuid references auth.users(id) on delete restrict,
  approved_at         timestamptz,
  executed_by         uuid references auth.users(id) on delete restrict,
  executed_at         timestamptz,
  outcome             text check (outcome in ('delivered', 'failed')),
  outcome_at          timestamptz,
  rejected_by         uuid references auth.users(id) on delete restrict,
  rejected_reason     text,
  rejected_at         timestamptz,
  expires_at          timestamptz not null default (now() + interval '24 hours'),
  updated_at          timestamptz,
  -- Structural invariants (also enforced in the RPCs, which is where the friendly errors come from).
  constraint arr_requester_not_subject check (requested_by <> subject_user_id),
  constraint arr_approver_not_requester check (approved_by is null or approved_by <> requested_by),
  constraint arr_sim_reviewer_not_requester check (sim_swap_reviewed_by is null or sim_swap_reviewed_by <> requested_by),
  constraint arr_sim_swap_needs_second_step check (
    not (state in ('approved','executed') and sim_swap_risk and sim_swap_reviewed_at is null)),
  constraint arr_approved_shape check (state not in ('approved','executed') or (approved_by is not null and approved_at is not null)),
  constraint arr_executed_shape check (state <> 'executed' or (executed_by is not null and executed_at is not null)),
  constraint arr_rejected_shape check (state <> 'rejected' or (rejected_by is not null and char_length(btrim(coalesce(rejected_reason, ''))) >= 10)),
  constraint arr_expiry_after_creation check (expires_at > created_at)
);
create index account_recovery_requests_org_state_idx on public.account_recovery_requests (organisation_id, state, created_at desc);
create index account_recovery_requests_subject_idx on public.account_recovery_requests (subject_user_id, created_at desc);

comment on table public.account_recovery_requests is
  'v5 1.6 assisted recovery. Two-person rule: requester and approver are different admins, requester is never the subject. '
  'Holds no secret, no full phone/email, no DOB, no identity document: identity_checks records only WHICH checks were done. '
  'Written only by the SECURITY DEFINER RPCs; terminal states are immutable (trigger).';

create or replace function private.enforce_recovery_state()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organisation_id is distinct from old.organisation_id
     or new.subject_user_id is distinct from old.subject_user_id
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at
     or new.expires_at is distinct from old.expires_at
     or new.reason is distinct from old.reason
     or new.identity_checks is distinct from old.identity_checks
     or new.method is distinct from old.method
     or new.sim_swap_risk is distinct from old.sim_swap_risk then
    raise exception 'account_recovery_requests: subject, requester, method, reason and expiry are immutable' using errcode = '23514';
  end if;

  if new.state = old.state then
    if new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at
       or new.executed_by is distinct from old.executed_by or new.executed_at is distinct from old.executed_at
       or new.rejected_by is distinct from old.rejected_by or new.rejected_at is distinct from old.rejected_at
       or new.rejected_reason is distinct from old.rejected_reason then
      raise exception 'account_recovery_requests: approval, execution and rejection fields only change with the state' using errcode = '23514';
    end if;
    -- Only legal same-state change: stamp the SIM-swap review (requested), or the one-time delivery outcome (executed).
    if old.state = 'requested' and old.sim_swap_reviewed_at is null and new.sim_swap_reviewed_at is not null then
      null;
    elsif old.state = 'executed' and old.outcome is null and new.outcome is not null then
      null;
    elsif old.state in ('executed','rejected','expired') then
      raise exception 'account_recovery_requests: % is a terminal state', old.state using errcode = '23514';
    end if;
  else
    if old.state in ('executed','rejected','expired') then
      raise exception 'account_recovery_requests: % is a terminal state', old.state using errcode = '23514';
    end if;
    if not ((old.state = 'requested' and new.state in ('approved','rejected','expired'))
         or (old.state = 'approved'  and new.state in ('executed','rejected','expired'))) then
      raise exception 'account_recovery_requests: % to % is not allowed', old.state, new.state using errcode = '23514';
    end if;
    if new.state in ('approved','executed') and old.expires_at <= now() then
      raise exception 'account_recovery_requests: an expired request cannot be approved or executed' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function private.enforce_recovery_state() from public, anon;
create trigger account_recovery_requests_state_machine
  before update on public.account_recovery_requests
  for each row execute function private.enforce_recovery_state();

create trigger account_recovery_requests_no_delete
  before delete on public.account_recovery_requests
  for each row execute function private.reject_mutation();

alter table public.account_recovery_requests enable row level security;
create policy account_recovery_requests_admin_select on public.account_recovery_requests
  for select to authenticated
  using (private.is_admin() and organisation_id = private.current_org_id());
-- Read only. All writes go through the RPCs below.
grant select on public.account_recovery_requests to authenticated;
revoke all on public.account_recovery_requests from anon;
-- Default privileges hand authenticated every table privilege on a new table; take all but SELECT back.
revoke insert, update, delete, truncate, references, trigger on public.account_recovery_requests from authenticated;

-- ---------------------------------------------------------------------------
-- Helpers (not callable by any application role)
-- ---------------------------------------------------------------------------
create or replace function private.audit_recovery_event(
  p_org uuid, p_actor uuid, p_action text, p_request uuid, p_subject uuid, p_reason text, p_result text, p_event jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_log
    (organisation_id, actor_id, action, entity_type, entity_id, event, reason, result, subject_patient_id, ip)
  values (p_org, p_actor, p_action, 'account_recovery_request', p_request, coalesce(p_event, '{}'::jsonb),
          p_reason, p_result, p_subject, private.request_ip());
end;
$$;
revoke all on function private.audit_recovery_event(uuid, uuid, text, uuid, uuid, text, text, jsonb) from public, anon, authenticated;

-- Neutral wording (INV-07), in-app always, email only when an address is on file, never SMS (INV-08).
-- Returns the channels actually queued so the audit row can record "no notice could be queued".
create or replace function private.queue_recovery_notice(p_subject uuid, p_org uuid, p_kind text)
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_msg      text;
  v_tpl      text := 'security.assisted_recovery_' || p_kind;
  v_email    text;
  v_channels text[] := '{}';
begin
  v_msg := case p_kind
    when 'requested' then 'Our support team has started an account recovery on your Tarragon Health account. If you did not ask for this, please contact your care team right away.'
    else 'Our support team has completed an account recovery step on your Tarragon Health account. If you did not ask for this, please contact your care team right away.'
  end;
  if exists (select 1 from public.profiles where id = p_subject) then
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
    values (p_org, p_subject, 'in_app', 'pending', v_tpl, jsonb_build_object('message', v_msg, 'occurred_at', now()), 'non_clinical', 'critical');
    v_channels := array_append(v_channels, 'in_app'::text);
    select u.email into v_email from auth.users u where u.id = p_subject;
    if v_email is not null and btrim(v_email) <> '' then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class, priority)
      values (p_org, p_subject, 'email', 'pending', v_tpl, jsonb_build_object('message', v_msg, 'occurred_at', now()), 'non_clinical', 'critical');
      v_channels := array_append(v_channels, 'email'::text);
    end if;
  end if;
  return v_channels;
end;
$$;
revoke all on function private.queue_recovery_notice(uuid, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RPCs. Refusals (not admin, wrong org, wrong state, self-approval) return {ok:false,error} and are audited as
-- 'denied'; malformed input raises 22023. Nothing returned contains a full phone, email or DOB.
-- ---------------------------------------------------------------------------
create or replace function public.request_assisted_recovery(
  p_subject uuid, p_reason text, p_identity_checks jsonb, p_method text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_org   uuid := private.current_org_id();
  v_sub   record;
  v_email_ok boolean;
  v_swap  boolean;
  v_id    uuid;
  v_ch    text[];
begin
  if p_reason is null or char_length(btrim(p_reason)) < 20 then
    raise exception 'a reason of at least 20 characters is required' using errcode = '22023';
  end if;
  if p_method not in ('email_link_to_verified_email', 'new_phone_reverification') then
    raise exception 'unknown recovery method' using errcode = '22023';
  end if;
  if p_identity_checks is null or not private.valid_identity_checks(p_identity_checks) then
    raise exception 'at least two recognised identity checks must be recorded' using errcode = '22023';
  end if;
  if v_uid is null or not private.is_admin() then
    perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', null, p_subject, btrim(p_reason), 'denied', jsonb_build_object('why', 'not_admin'));
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;
  if p_subject = v_uid then
    perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', null, p_subject, btrim(p_reason), 'denied', jsonb_build_object('why', 'self'));
    return jsonb_build_object('ok', false, 'error', 'cannot_recover_own_account');
  end if;
  select p.id, p.organisation_id, p.role, p.full_name into v_sub from public.profiles p where p.id = p_subject;
  if v_sub.id is null or v_sub.organisation_id is distinct from v_org or v_sub.role <> 'patient' then
    perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', null, p_subject, btrim(p_reason), 'denied', jsonb_build_object('why', 'subject_not_eligible'));
    return jsonb_build_object('ok', false, 'error', 'subject_not_eligible');
  end if;
  if exists (select 1 from public.account_recovery_requests r where r.subject_user_id = p_subject and r.state in ('requested','approved') and r.expires_at > now()) then
    perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', null, p_subject, btrim(p_reason), 'denied', jsonb_build_object('why', 'already_open'));
    return jsonb_build_object('ok', false, 'error', 'request_already_open');
  end if;
  select (u.email is not null and u.email_confirmed_at is not null),
         (u.created_at < now() - interval '72 hours'
          and greatest(u.phone_change_sent_at, u.phone_confirmed_at) > now() - interval '72 hours')
    into v_email_ok, v_swap
    from auth.users u where u.id = p_subject;
  if p_method = 'email_link_to_verified_email' and not coalesce(v_email_ok, false) then
    perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', null, p_subject, btrim(p_reason), 'denied', jsonb_build_object('why', 'no_verified_email'));
    return jsonb_build_object('ok', false, 'error', 'no_verified_email_on_file');
  end if;

  insert into public.account_recovery_requests
    (organisation_id, subject_user_id, requested_by, reason, identity_checks, method, sim_swap_risk)
  values (v_org, p_subject, v_uid, btrim(p_reason), p_identity_checks, p_method, coalesce(v_swap, false))
  returning id into v_id;

  v_ch := private.queue_recovery_notice(p_subject, v_org, 'requested');
  perform private.audit_recovery_event(v_org, v_uid, 'admin.recovery_request', v_id, p_subject, btrim(p_reason), 'success',
    jsonb_build_object('method', p_method, 'sim_swap_risk', coalesce(v_swap, false),
                       'checks_done', (select coalesce(jsonb_agg(e.key order by e.key), '[]'::jsonb) from jsonb_each(p_identity_checks) e where e.value = 'true'::jsonb),
                       'notice_channels', to_jsonb(v_ch), 'notice_queued', cardinality(v_ch) > 0));
  return jsonb_build_object('ok', true, 'request_id', v_id, 'sim_swap_risk', coalesce(v_swap, false), 'notice_queued', cardinality(v_ch) > 0);
end;
$$;

-- Shared loader for the step RPCs: locks the row, applies the admin + org gate, lazily expires.
create or replace function private.recovery_step_gate(p_request uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_org uuid := private.current_org_id();
  r public.account_recovery_requests;
begin
  if v_uid is null or not private.is_admin() then
    perform private.audit_recovery_event(v_org, v_uid, p_action, p_request, null, p_reason, 'denied', jsonb_build_object('why', 'not_admin'));
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;
  select * into r from public.account_recovery_requests where id = p_request and organisation_id = v_org for update;
  if r.id is null then
    perform private.audit_recovery_event(v_org, v_uid, p_action, p_request, null, p_reason, 'denied', jsonb_build_object('why', 'not_found'));
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if r.state in ('requested','approved') and r.expires_at <= now() then
    update public.account_recovery_requests set state = 'expired' where id = r.id;
    perform private.audit_recovery_event(v_org, v_uid, p_action, r.id, r.subject_user_id, p_reason, 'denied', jsonb_build_object('why', 'expired'));
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  return null;
end;
$$;
revoke all on function private.recovery_step_gate(uuid, text, text) from public, anon, authenticated;

create or replace function public.confirm_sim_swap_review(p_request uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.account_recovery_requests;
  v_ref jsonb;
  v_uid uuid := (select auth.uid());
begin
  if p_note is null or char_length(btrim(p_note)) < 20 then
    raise exception 'a review note of at least 20 characters is required' using errcode = '22023';
  end if;
  v_ref := private.recovery_step_gate(p_request, 'admin.recovery_sim_swap_review', btrim(p_note));
  if v_ref is null then select * into v_r from public.account_recovery_requests where id = p_request; end if;
  if v_ref is not null then return v_ref; end if;
  if v_r.state <> 'requested' or not v_r.sim_swap_risk or v_r.sim_swap_reviewed_at is not null then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_sim_swap_review', v_r.id, v_r.subject_user_id, btrim(p_note), 'denied', jsonb_build_object('why', 'not_reviewable'));
    return jsonb_build_object('ok', false, 'error', 'not_reviewable');
  end if;
  if v_uid = v_r.requested_by then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_sim_swap_review', v_r.id, v_r.subject_user_id, btrim(p_note), 'denied', jsonb_build_object('why', 'requester_cannot_review'));
    return jsonb_build_object('ok', false, 'error', 'requester_cannot_review');
  end if;
  update public.account_recovery_requests set sim_swap_reviewed_by = v_uid, sim_swap_reviewed_at = now() where id = v_r.id;
  perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_sim_swap_review', v_r.id, v_r.subject_user_id, btrim(p_note), 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.approve_assisted_recovery(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.account_recovery_requests;
  v_ref jsonb;
  v_uid uuid := (select auth.uid());
begin
  v_ref := private.recovery_step_gate(p_request, 'admin.recovery_approve', 'approve');
  if v_ref is null then select * into v_r from public.account_recovery_requests where id = p_request; end if;
  if v_ref is not null then return v_ref; end if;
  if v_r.state <> 'requested' then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_approve', v_r.id, v_r.subject_user_id, v_r.reason, 'denied', jsonb_build_object('why', 'wrong_state', 'state', v_r.state));
    return jsonb_build_object('ok', false, 'error', 'wrong_state');
  end if;
  if v_uid = v_r.requested_by then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_approve', v_r.id, v_r.subject_user_id, v_r.reason, 'denied', jsonb_build_object('why', 'self_approval'));
    return jsonb_build_object('ok', false, 'error', 'requester_cannot_approve');
  end if;
  if v_r.sim_swap_risk and v_r.sim_swap_reviewed_at is null then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_approve', v_r.id, v_r.subject_user_id, v_r.reason, 'denied', jsonb_build_object('why', 'sim_swap_review_missing'));
    return jsonb_build_object('ok', false, 'error', 'sim_swap_review_required');
  end if;
  update public.account_recovery_requests set state = 'approved', approved_by = v_uid, approved_at = now() where id = v_r.id;
  perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_approve', v_r.id, v_r.subject_user_id, v_r.reason, 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.reject_assisted_recovery(p_request uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.account_recovery_requests;
  v_ref jsonb;
  v_uid uuid := (select auth.uid());
begin
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'a rejection reason of at least 10 characters is required' using errcode = '22023';
  end if;
  v_ref := private.recovery_step_gate(p_request, 'admin.recovery_reject', btrim(p_reason));
  if v_ref is null then select * into v_r from public.account_recovery_requests where id = p_request; end if;
  if v_ref is not null then return v_ref; end if;
  if v_r.state not in ('requested','approved') then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_reject', v_r.id, v_r.subject_user_id, btrim(p_reason), 'denied', jsonb_build_object('why', 'wrong_state'));
    return jsonb_build_object('ok', false, 'error', 'wrong_state');
  end if;
  update public.account_recovery_requests set state = 'rejected', rejected_by = v_uid, rejected_reason = btrim(p_reason), rejected_at = now() where id = v_r.id;
  perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_reject', v_r.id, v_r.subject_user_id, btrim(p_reason), 'success', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Marks the request executed and hands the SERVER the facts it needs. It sets no password and returns no secret;
-- the recipient address is deliberately NOT returned: the server action reads the address on file itself.
create or replace function public.execute_assisted_recovery(p_request uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.account_recovery_requests;
  v_ref jsonb;
  v_uid uuid := (select auth.uid());
  v_ch  text[];
begin
  v_ref := private.recovery_step_gate(p_request, 'admin.recovery_execute', 'execute');
  if v_ref is null then select * into v_r from public.account_recovery_requests where id = p_request; end if;
  if v_ref is not null then return v_ref; end if;
  if v_r.state <> 'approved' then
    perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_execute', v_r.id, v_r.subject_user_id, v_r.reason, 'denied', jsonb_build_object('why', 'wrong_state', 'state', v_r.state));
    return jsonb_build_object('ok', false, 'error', 'wrong_state');
  end if;
  update public.account_recovery_requests set state = 'executed', executed_by = v_uid, executed_at = now() where id = v_r.id;
  v_ch := private.queue_recovery_notice(v_r.subject_user_id, v_r.organisation_id, 'executed');
  perform private.audit_recovery_event(v_r.organisation_id, v_uid, 'admin.recovery_execute', v_r.id, v_r.subject_user_id, v_r.reason, 'success',
    jsonb_build_object('method', v_r.method, 'notice_channels', to_jsonb(v_ch), 'notice_queued', cardinality(v_ch) > 0));
  return jsonb_build_object('ok', true, 'request_id', v_r.id, 'method', v_r.method, 'subject_user_id', v_r.subject_user_id);
end;
$$;

-- Records whether the server-side Auth call succeeded (once, by whoever executed). No detail text is accepted, so no
-- secret or address can be smuggled into the audit trail.
create or replace function public.record_assisted_recovery_outcome(p_request uuid, p_ok boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.account_recovery_requests;
begin
  if v_uid is null or not private.is_admin() then
    perform private.audit_recovery_event(private.current_org_id(), v_uid, 'admin.recovery_outcome', p_request, null, 'outcome', 'denied', jsonb_build_object('why', 'not_admin'));
    return jsonb_build_object('ok', false, 'error', 'not_authorised');
  end if;
  select * into r from public.account_recovery_requests where id = p_request and organisation_id = private.current_org_id() for update;
  if r.id is null or r.state <> 'executed' or r.executed_by is distinct from v_uid or r.outcome is not null then
    perform private.audit_recovery_event(private.current_org_id(), v_uid, 'admin.recovery_outcome', p_request, r.subject_user_id, 'outcome', 'denied', jsonb_build_object('why', 'not_recordable'));
    return jsonb_build_object('ok', false, 'error', 'not_recordable');
  end if;
  update public.account_recovery_requests set outcome = case when p_ok then 'delivered' else 'failed' end, outcome_at = now() where id = r.id;
  perform private.audit_recovery_event(r.organisation_id, v_uid, 'admin.recovery_outcome', r.id, r.subject_user_id, r.reason, case when p_ok then 'success' else 'failed' end, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

-- Admin list with masked contact hints only (last 4 digits, first letter + domain). Never a full phone, email or DOB.
create or replace function public.list_assisted_recovery_requests(p_state text default null)
returns table (id uuid, created_at timestamptz, state text, method text, sim_swap_risk boolean, sim_swap_reviewed boolean,
               requested_by uuid, approved_by uuid, expires_at timestamptz, reason text, checks_done text[],
               subject_user_id uuid, subject_name text, phone_hint text, email_hint text, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.is_admin() then
    perform private.audit_recovery_event(private.current_org_id(), (select auth.uid()), 'admin.recovery_list', null, null, 'list', 'denied', jsonb_build_object('why', 'not_admin'));
    return;
  end if;
  return query
    select r.id, r.created_at,
           case when r.state in ('requested','approved') and r.expires_at <= now() then 'expired' else r.state end,
           r.method, r.sim_swap_risk, r.sim_swap_reviewed_at is not null,
           r.requested_by, r.approved_by, r.expires_at, r.reason,
           (select coalesce(array_agg(e.key order by e.key), '{}') from jsonb_each(r.identity_checks) e where e.value = 'true'::jsonb),
           r.subject_user_id, p.full_name,
           '****' || right(coalesce(p.phone, ''), 4),
           case when u.email is null then null else left(u.email, 1) || '***@' || split_part(u.email, '@', 2) end,
           r.outcome
      from public.account_recovery_requests r
      join public.profiles p on p.id = r.subject_user_id
      left join auth.users u on u.id = r.subject_user_id
     where r.organisation_id = private.current_org_id()
       and (p_state is null or r.state = p_state)
     order by r.created_at desc
     limit 100;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.request_assisted_recovery(uuid,text,jsonb,text)', 'public.confirm_sim_swap_review(uuid,text)',
    'public.approve_assisted_recovery(uuid)', 'public.reject_assisted_recovery(uuid,text)',
    'public.execute_assisted_recovery(uuid)', 'public.record_assisted_recovery_outcome(uuid,boolean)',
    'public.list_assisted_recovery_requests(text)'] loop
    execute format('revoke all on function %s from public', f);
    execute format('revoke all on function %s from anon', f);
    execute format('grant execute on function %s to authenticated', f);
    if has_function_privilege('anon', f, 'EXECUTE') then raise exception 'S03: anon can execute %', f; end if;
  end loop;
  foreach f in array array[
    'private.audit_recovery_event(uuid,uuid,text,uuid,uuid,text,text,jsonb)', 'private.queue_recovery_notice(uuid,uuid,text)',
    'private.recovery_step_gate(uuid,text,text)'] loop
    if has_function_privilege('authenticated', f, 'EXECUTE') or has_function_privilege('anon', f, 'EXECUTE') then
      raise exception 'S03: helper % is directly executable', f;
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.account_recovery_requests', 'INSERT')
     or has_table_privilege('authenticated', 'public.account_recovery_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.account_recovery_requests', 'DELETE')
     or has_table_privilege('anon', 'public.account_recovery_requests', 'SELECT') then
    raise exception 'S03: account_recovery_requests has a direct write or anon grant';
  end if;
end $$;

-- S26b: entitlement and refund hardening, and the refund reversal hook (closes OQ-184).
--
-- What this does (docs/research/S26-S30-competitor-review-and-build-plan.md, S26b):
--   1. Expiry reminders at 30, 7 and 1 day before the end, one row per step (entitlement_reminder_steps, unique on entitlement and step),
--      sent on the channel private.patient_reminder_channel() chooses. The step list and the grace length are PROPOSED values in
--      entitlement_policy_config (mirrored in packages/shared/src/proposed-config/registry.ts, with a drift test).
--   2. A 7-day read-only grace after an entitlement ends (my_entitlements reports phase 'grace'; consume_entitlement still refuses
--      anything that is not 'active', so grace gives no doctor time).
--   3. Refunds: a status timeline the patient can read (refund_status_events) with a message at each step, a stated decision SLA, a
--      required reason when a request is declined, a cooling-off window for every kind (not only Membership), and a state machine that
--      actually works end to end: the S26 record_refund_provider_result moved approved straight to completed, which the refunds state
--      trigger forbids, so a Paystack refund that succeeded could never be recorded. A refund is now claimed (approved to processing)
--      before the provider is called, so a crash can never send it twice, and a failed refund can be retried by an admin.
--   4. A weekly reconciliation hook (refunds_needing_reconcile, record_refund_reconcile, flag_refund_delays) used by the refund-reconcile
--      edge function: our state against Paystack's, mismatches and stuck refunds raised as ops incidents.
--   5. The reversal hook: when a refund is paid, (a) the deferred revenue that was never recognised is released (completes the S26
--      private.post_refund_reversal stub; the cash side stays with the existing refund.processed posting, so nothing posts twice), and
--      (b) every consultation share already in earnings_ledger for an encounter linked to that order gets a negative adjustment line
--      (append only, idempotent, old lines never touched).
--
-- Live counts (read-only): the live database did not answer when this was written (connection timed out), so none was read. The last
-- recorded counts (BUILD-PROGRESS, 2026-10-12) are orders 0 and refunds 0. Every change here is additive or a create-or-replace of the
-- definition read from the repo's latest migration, and the closing DO block asserts the result, so a non-empty table cannot change meaning.
-- The definitions of request_order_refund (20261013222300), decide_order_refund (20261013012113), my_entitlements (20261007231742)
-- and queue_entitlement_expiry_reminders (20261013003317) were taken from those files, NOT from pg_get_functiondef.
-- ROLLBACK: restore the four function bodies from those files; drop the new tables and columns; drop function public.entitlement_policy_public.

-- ---------------------------------------------------------------------------
-- 1. Versioned policy config (PROPOSED)
-- ---------------------------------------------------------------------------
create table public.entitlement_policy_config (
  id             uuid primary key default gen_random_uuid(),
  kind           text not null check (kind in ('lifecycle', 'refund_rules')),
  version        integer not null check (version > 0),
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null check (jsonb_typeof(rules) = 'object'),
  created_at     timestamptz not null default now(),
  unique (kind, version)
);
create unique index entitlement_policy_config_one_active on public.entitlement_policy_config (kind) where is_active;
alter table public.entitlement_policy_config enable row level security;
revoke all on public.entitlement_policy_config from public, anon, authenticated;

-- entitlements-lifecycle-begin (mirrored as entitlements.lifecycle in packages/shared/src/proposed-config/registry.ts)
insert into public.entitlement_policy_config (kind, version, is_active, effective_from, rules)
values ('lifecycle', 1, true, date '2026-10-16', $json${"reminder_days_before":[30,7,1],"grace_days":7}$json$::jsonb);
-- entitlements-lifecycle-end

-- refunds-order-rules-begin (mirrored as refunds.order_rules in packages/shared/src/proposed-config/registry.ts)
insert into public.entitlement_policy_config (kind, version, is_active, effective_from, rules)
values ('refund_rules', 1, true, date '2026-10-16',
        $json${"cooling_off_days":14,"decision_sla_days":3,"bank_days_min":5,"bank_days_max":10,"stuck_processing_hours":2,"earnings_rescan_days":60}$json$::jsonb);
-- refunds-order-rules-end

-- The active rules of one kind, or the shipped defaults when no row is active (a missing config never switches a rule off).
create function private.entitlement_policy(p_kind text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    (select rules from public.entitlement_policy_config where kind = p_kind and is_active),
    case p_kind
      when 'lifecycle' then '{"reminder_days_before":[30,7,1],"grace_days":7}'::jsonb
      else '{"cooling_off_days":14,"decision_sla_days":3,"bank_days_min":5,"bank_days_max":10,"stuck_processing_hours":2,"earnings_rescan_days":60}'::jsonb
    end)
$$;
revoke all on function private.entitlement_policy(text) from public, anon, authenticated;

create function private.entitlement_reminder_steps() returns integer[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(distinct d::integer order by d::integer desc), '{30,7,1}'::integer[])
    from jsonb_array_elements_text(private.entitlement_policy('lifecycle') -> 'reminder_days_before') d
   where d::integer > 0
$$;
revoke all on function private.entitlement_reminder_steps() from public, anon, authenticated;

create function private.entitlement_grace_days() returns integer
language sql stable security definer set search_path = ''
as $$ select greatest(coalesce((private.entitlement_policy('lifecycle') ->> 'grace_days')::integer, 7), 0) $$;
revoke all on function private.entitlement_grace_days() from public, anon, authenticated;

create function private.order_refund_cooling_off_days() returns integer
language sql stable security definer set search_path = ''
as $$ select greatest(coalesce((private.entitlement_policy('refund_rules') ->> 'cooling_off_days')::integer, 14), 0) $$;
revoke all on function private.order_refund_cooling_off_days() from public, anon, authenticated;

-- What the checkout, the receipt and the refund screens quote, so no screen hard-codes a number of days.
create function public.entitlement_policy_public() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'reminder_days_before', to_jsonb(private.entitlement_reminder_steps()),
    'grace_days', private.entitlement_grace_days(),
    'cooling_off_days', private.order_refund_cooling_off_days(),
    'membership_window_days', private.membership_refund_window_days(),
    'decision_sla_days', (private.entitlement_policy('refund_rules') ->> 'decision_sla_days')::integer,
    'bank_days_min', (private.entitlement_policy('refund_rules') ->> 'bank_days_min')::integer,
    'bank_days_max', (private.entitlement_policy('refund_rules') ->> 'bank_days_max')::integer)
$$;
revoke all on function public.entitlement_policy_public() from public, anon;
grant execute on function public.entitlement_policy_public() to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Reminders: one row per step, so each step sends once
-- ---------------------------------------------------------------------------
create table public.entitlement_reminder_steps (
  id              uuid primary key default gen_random_uuid(),
  entitlement_id  uuid not null references public.entitlements (id) on delete cascade,
  step_days       integer not null check (step_days > 0),
  outcome         text not null check (outcome in ('sent', 'skipped_overlap', 'skipped_short')),
  notification_id uuid references public.notifications (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (entitlement_id, step_days)
);
alter table public.entitlement_reminder_steps enable row level security;
revoke all on public.entitlement_reminder_steps from public, anon, authenticated;

create or replace function private.queue_entitlement_expiry_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_steps integer[] := private.entitlement_reminder_steps();
  v_top integer := v_steps[1];
  v_step integer;
  v_id uuid;
  v_notif uuid;
  v_when text;
  n integer := 0;
begin
  if v_top is null then return 0; end if;
  for r in
    select e.id, e.patient_id, e.organisation_id, e.kind, e.starts_at, e.ends_at
      from public.entitlements e
     where e.state = 'active'
       and e.ends_at is not null
       and e.ends_at > now()
       and e.ends_at <= now() + make_interval(days => v_top)
       and e.roster_member_id is null   -- an employer-paid seat is renewed by the employer
       and e.kind <> 'membership'       -- a Membership has its own reminders (membership_lapse_config)
  loop
    -- One bad row must not stop everyone else's reminder: each entitlement runs in its own sub-transaction, and a failure is logged and
    -- raised as an incident (once per entitlement) instead of rolling the whole run back.
    begin
      -- the tightest step this entitlement has already entered (steps are longest first)
      select min(s) into v_step from unnest(v_steps) s where r.ends_at <= now() + make_interval(days => s);

      -- longer steps that were never recorded are marked, not sent: a missed day must never produce two reminders at once
      insert into public.entitlement_reminder_steps (entitlement_id, step_days, outcome)
      select r.id, s, 'skipped_overlap' from unnest(v_steps) s where s > v_step
      on conflict (entitlement_id, step_days) do nothing;

      if exists (select 1 from public.entitlement_reminder_steps where entitlement_id = r.id and step_days = v_step) then continue; end if;

      -- a pack shorter than the step would be reminded the moment it was bought: record it as skipped
      if r.starts_at is not null and r.ends_at - r.starts_at <= make_interval(days => v_step) then
        insert into public.entitlement_reminder_steps (entitlement_id, step_days, outcome) values (r.id, v_step, 'skipped_short')
          on conflict (entitlement_id, step_days) do nothing;
        continue;
      end if;

      -- claim the step first (the unique key makes two overlapping runs send once), notify second
      v_id := null;
      insert into public.entitlement_reminder_steps (entitlement_id, step_days, outcome) values (r.id, v_step, 'sent')
        on conflict (entitlement_id, step_days) do nothing
        returning id into v_id;
      if v_id is null then continue; end if;

      v_when := case when v_step = 1 then 'tomorrow' else 'in ' || v_step || ' days' end;
      -- INV-07: the payload carries the date and the step only. It names no service and no kind: a lock-screen push or an email subject must not
      -- reveal what care someone bought.
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'entitlement_expiring_soon',
              jsonb_build_object('entitlement_id', r.id, 'step_days', v_step, 'when', v_when,
                                 'ends_at', to_char(r.ends_at at time zone 'Africa/Lagos', 'DD Mon YYYY'),
                                 'grace_days', private.entitlement_grace_days()))
      returning id into v_notif;
      update public.entitlement_reminder_steps set notification_id = v_notif where id = v_id;
      update public.entitlements set reminded_at = coalesce(reminded_at, now()) where id = r.id;
      n := n + 1;
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (r.organisation_id, 'entitlement_reminder.error', 'entitlement', r.id, jsonb_build_object('error', sqlerrm));
      perform private.order_incident(r.organisation_id, 'entitlement-reminder:' || r.id, 'An expiry reminder could not be queued',
        'Entitlement ' || r.id || ' could not be reminded (' || sqlerrm || '). Every other reminder was sent.');
    end;
  end loop;
  return n;
end $$;
revoke all on function private.queue_entitlement_expiry_reminders() from public, anon, authenticated;

-- The Vercel cron route calls these wrappers with the service role (PostgREST cannot reach the private schema).
create function public.service_run_entitlement_reminders() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return private.queue_entitlement_expiry_reminders();
end $$;
revoke all on function public.service_run_entitlement_reminders() from public, anon, authenticated;
grant execute on function public.service_run_entitlement_reminders() to service_role;

insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('entitlement_expiring_soon', 'en', 'in_app', 'Something you bought ends {{when}}',
   'Something you bought on TarragonHealth ends on {{ends_at}}. Nothing renews by itself. Open the app to renew in one tap. For {{grace_days}} days after it ends you can still see your records, and you can renew then too.'),
  ('entitlement_expiring_soon', 'en', 'push', 'A purchase ends {{when}}',
   'It ends on {{ends_at}}. Nothing renews by itself. Open the app to renew in one tap.'),
  ('entitlement_expiring_soon', 'en', 'email', 'Something you bought on TarragonHealth ends {{when}}',
   E'Hi there,\n\nSomething you bought on TarragonHealth ends on {{ends_at}}. Nothing renews by itself and you will not be charged unless you choose to renew. You can renew in one tap in the app. For {{grace_days}} days after it ends you can still see your records.\n\nYour care team')
on conflict (template_key, locale, channel) do update set subject = excluded.subject, body = excluded.body;

-- ---------------------------------------------------------------------------
-- 3. Grace: read-only for a short while after the end, one tap to renew, never doctor time
-- ---------------------------------------------------------------------------
create or replace function public.my_entitlements() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'kind', e.kind, 'state', e.state, 'starts_at', e.starts_at, 'ends_at', e.ends_at, 'remaining_uses', e.remaining_uses, 'name_key', i.name_key,
    'days_left', case when e.state = 'active' and e.ends_at is not null then greatest(ceil(extract(epoch from (e.ends_at - now())) / 86400.0), 0)::integer end,
    -- phase: 'grace' is an ended entitlement still inside the grace window. Only a pack bought by the person; a Membership and an employer seat have their own rules.
    'phase', case when e.state = 'expired' and e.ends_at is not null and e.kind <> 'membership' and e.roster_member_id is null
                       and e.ends_at + make_interval(days => private.entitlement_grace_days()) > now() then 'grace' else e.state end,
    'grace_days_left', case when e.state = 'expired' and e.ends_at is not null and e.kind <> 'membership' and e.roster_member_id is null
                                 and e.ends_at + make_interval(days => private.entitlement_grace_days()) > now()
                            then ceil(extract(epoch from (e.ends_at + make_interval(days => private.entitlement_grace_days()) - now())) / 86400.0)::integer end,
    'item_code', i.code,
    'source', case
        when o.sponsor_share_kobo > 0 and exists (select 1 from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                                   where sr.order_id = o.id and sp.eligibility = 'access_grant') then 'access_fund'
        when o.sponsor_share_kobo > 0 then 'sponsor'
        when o.buyer_profile_id <> o.beneficiary_patient_id then 'supporter'
        else 'paid' end,
    'sponsor_name', case when o.sponsor_share_kobo > 0 and not exists (select 1 from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                                                         where sr.order_id = o.id and sp.eligibility = 'access_grant')
                         then (select so.name from public.sponsor_reservations sr join public.sponsor_programmes sp on sp.id = sr.programme_id
                                 join public.organisations so on so.id = sp.sponsor_org_id where sr.order_id = o.id) end,
    'part_covered', o.sponsor_share_kobo > 0 and o.amount_kobo > 0) order by e.created_at desc), '[]'::jsonb)
    from public.entitlements e join public.orders o on o.id = e.order_id join public.catalog_items i on i.id = o.catalog_item_id
   where e.patient_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------------------
-- 4. Refunds: columns, state machine, status timeline
-- ---------------------------------------------------------------------------
alter table public.refunds
  add column attempts               integer not null default 0 check (attempts >= 0),
  add column last_error_code        text,
  add column processing_started_at  timestamptz,
  add column completed_at           timestamptz,
  add column provider_status        text check (provider_status is null or provider_status in ('matched', 'mismatch', 'not_found')),
  add column provider_checked_at    timestamptz,
  add column gl_released_at         timestamptz,
  add column earnings_reversed_at   timestamptz;

-- failed -> approved is the admin retry. Everything else is as S26 built it. completed, rejected stay terminal.
-- The buyer and the beneficiary read their own refund through RLS, but a table-wide SELECT also exposed the raw provider response, the
-- provider's refund id, the reconcile verdict and the retry counters. Narrow it to what the refund screen shows. A column added later is NOT
-- readable by authenticated until it is granted here on purpose (a loud "permission denied", never a silent exposure). Admins read the
-- operational columns through public.admin_refund_ops(), not through the table.
revoke select on public.refunds from authenticated;
grant select (id, organisation_id, order_id, amount_kobo, reason, state, provider, requested_by, decided_by, decided_at, decision_note,
              is_test, created_at, updated_at, completed_at)
  on public.refunds to authenticated;

create or replace function private.refunds_state_machine() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'refund_immutable' using errcode = 'P0001'; end if;
  if new.order_id is distinct from old.order_id or new.amount_kobo is distinct from old.amount_kobo then
    raise exception 'refund_immutable' using errcode = 'P0001';
  end if;
  if new.state is distinct from old.state and not (
       (old.state = 'pending'    and new.state in ('approved', 'rejected'))
    or (old.state = 'approved'   and new.state in ('processing', 'failed'))
    or (old.state = 'processing' and new.state in ('completed', 'failed'))
    or (old.state = 'failed'     and new.state = 'approved')
  ) then
    raise exception 'refund_bad_transition % to %', old.state, new.state using errcode = 'P0001';
  end if;
  new.updated_at := now();
  return new;
end $$;

create table public.refund_status_events (
  id              uuid primary key default gen_random_uuid(),
  refund_id       uuid not null references public.refunds (id) on delete cascade,
  organisation_id uuid not null references public.organisations (id) on delete restrict,
  step            text not null check (step in ('requested', 'approved', 'declined', 'sending', 'completed', 'problem', 'retrying')),
  -- clock_timestamp, not now(): steps taken inside one transaction must still sort in the order they happened
  created_at      timestamptz not null default clock_timestamp()
);
create index refund_status_events_refund_idx on public.refund_status_events (refund_id, created_at);
alter table public.refund_status_events enable row level security;
revoke all on public.refund_status_events from public, anon, authenticated;
grant select on public.refund_status_events to authenticated;
create policy refund_status_events_read on public.refund_status_events for select to authenticated
  using (exists (
    select 1 from public.refunds rf join public.orders o on o.id = rf.order_id
     where rf.id = refund_status_events.refund_id
       and (o.buyer_profile_id = (select auth.uid()) or o.beneficiary_patient_id = (select auth.uid())
            or (private.is_admin() and o.organisation_id = (select organisation_id from public.profiles where id = (select auth.uid()))))));

-- A message at each step. The decision reason (an admin's words) is read on the refund screen, never put in a notification (INV-07).
insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description)
values
  ('order_refund_requested', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'Step 1 of a refund: we have your request.'),
  ('order_refund_approved',  'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'Step 2 of a refund: approved, being sent back to the card.'),
  ('order_refund_declined',  'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'A refund was not approved. The reason is shown in the app.'),
  ('order_refund_problem',   'operational', 'important', 'patient', '{in_app,push,email}', 'immediate', 'The refund could not be sent yet. We are on it.')
on conflict (key) do nothing;

insert into public.notification_template_locales (template_key, locale, channel, subject, body)
values
  ('order_refund_requested', 'en', 'in_app', 'We have your refund request', 'We have your refund request. Your care team will answer within {{sla_days}} days.'),
  ('order_refund_requested', 'en', 'push',   'We have your refund request', 'Your care team will answer within {{sla_days}} days.'),
  ('order_refund_requested', 'en', 'email',  'We have your refund request', E'Hi there,\n\nWe have your refund request. Your care team will answer within {{sla_days}} days, and we will message you at each step.\n\nYour care team'),
  ('order_refund_approved',  'en', 'in_app', 'Your refund is approved', 'Your refund is approved and is being sent back to the card you paid with. It usually reaches your bank in {{bank_days}} business days.'),
  ('order_refund_approved',  'en', 'push',   'Your refund is approved', 'It is being sent back to the card you paid with.'),
  ('order_refund_approved',  'en', 'email',  'Your refund is approved', E'Hi there,\n\nYour refund is approved and is being sent back to the card you paid with. It usually reaches your bank in {{bank_days}} business days.\n\nYour care team'),
  ('order_refund_declined',  'en', 'in_app', 'Your refund was not approved', 'Your refund request was not approved. Open the app to read the reason from your care team.'),
  ('order_refund_declined',  'en', 'push',   'Your refund was not approved', 'Open the app to read the reason from your care team.'),
  ('order_refund_declined',  'en', 'email',  'Your refund was not approved', E'Hi there,\n\nYour refund request was not approved. Open the app to read the reason from your care team. If you disagree, you can reply to them there.\n\nYour care team'),
  ('order_refund_problem',   'en', 'in_app', 'Your refund is taking longer', 'Your refund could not be sent yet. We are looking at it and you do not need to do anything.'),
  ('order_refund_problem',   'en', 'push',   'Your refund is taking longer', 'We are looking at it. You do not need to do anything.'),
  ('order_refund_problem',   'en', 'email',  'Your refund is taking longer', E'Hi there,\n\nYour refund could not be sent yet. We are looking at it and you do not need to do anything. We will message you when it is sent.\n\nYour care team'),
  ('order_refund_completed', 'en', 'in_app', 'Your refund has been sent', 'Your refund of {{amount}} has been sent to the card you paid with. It usually reaches your bank in {{bank_days}} business days.'),
  ('order_refund_completed', 'en', 'push',   'Your refund has been sent', 'Your refund of {{amount}} has been sent.'),
  ('order_refund_completed', 'en', 'email',  'Your refund has been sent', E'Hi there,\n\nYour refund of {{amount}} has been sent to the card you paid with. It usually reaches your bank in {{bank_days}} business days.\n\nIf you have any questions, your care team is here to help.')
on conflict (template_key, locale, channel) do update set subject = excluded.subject, body = excluded.body;

create function private.refund_step_notice() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  o public.orders%rowtype;
  v_step text;
  v_template text;
  v_payload jsonb;
  v_rules jsonb := private.entitlement_policy('refund_rules');
  v_bank text := (v_rules ->> 'bank_days_min') || ' to ' || (v_rules ->> 'bank_days_max');
begin
  if tg_op = 'INSERT' then
    v_step := 'requested';
  elsif new.state is distinct from old.state then
    v_step := case
      when old.state = 'failed' and new.state = 'approved' then 'retrying'
      else case new.state when 'approved' then 'approved' when 'rejected' then 'declined' when 'processing' then 'sending'
                          when 'completed' then 'completed' when 'failed' then 'problem' end end;
  end if;
  if v_step is null then return null; end if;

  insert into public.refund_status_events (refund_id, organisation_id, step) values (new.id, new.organisation_id, v_step);

  v_template := case v_step when 'requested' then 'order_refund_requested' when 'approved' then 'order_refund_approved'
                            when 'declined' then 'order_refund_declined' when 'completed' then 'order_refund_completed'
                            when 'problem' then 'order_refund_problem' end;
  if v_template is not null then
    -- a message that cannot be queued must not stop the money state moving; it is logged where an admin looks
    begin
      select * into o from public.orders where id = new.order_id;
      v_payload := jsonb_build_object('refund_id', new.id, 'order_id', new.order_id, 'sla_days', (v_rules ->> 'decision_sla_days'), 'bank_days', v_bank,
                                      'amount', 'NGN ' || to_char(new.amount_kobo / 100.0, 'FM999,999,999,990.00'));
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (new.organisation_id, o.buyer_profile_id, private.patient_reminder_channel(o.buyer_profile_id), 'pending', v_template, v_payload);
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      values (new.organisation_id, 'refund.notify_error', 'refund', new.id, jsonb_build_object('step', v_step, 'error', sqlerrm));
    end;
  end if;
  return null;
end $$;
revoke all on function private.refund_step_notice() from public, anon, authenticated;
create trigger refunds_step_notice after insert or update of state on public.refunds
  for each row execute function private.refund_step_notice();

-- ---------------------------------------------------------------------------
-- 5. Refund RPCs
-- ---------------------------------------------------------------------------
-- request: S71's definition (covered_by_sponsor) plus the cooling-off window for every kind. Membership keeps its own window.
create or replace function public.request_order_refund(p_order uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  o public.orders%rowtype;
  v_refund uuid;
  v_member boolean;
  v_days integer;
begin
  if v_uid is null then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into o from public.orders where id = p_order and buyer_profile_id = v_uid;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if o.state <> 'paid' then return jsonb_build_object('result', 'order_not_paid', 'state', o.state); end if;
  if o.amount_kobo = 0 then return jsonb_build_object('result', 'covered_by_sponsor'); end if;
  v_member := exists (select 1 from public.catalog_items ci where ci.id = o.catalog_item_id and ci.kind = 'membership');
  v_days := case when v_member then private.membership_refund_window_days() else private.order_refund_cooling_off_days() end;
  if o.paid_at is null or now() > o.paid_at + make_interval(days => v_days) then
    return jsonb_build_object('result', 'outside_refund_window', 'window_days', v_days);
  end if;
  if length(coalesce(p_reason, '')) < 5 then return jsonb_build_object('result', 'reason_too_short'); end if;
  insert into public.refunds (organisation_id, order_id, amount_kobo, reason, requested_by, is_test)
  values (o.organisation_id, o.id, o.amount_kobo, p_reason, v_uid, o.is_test)
  on conflict (order_id) where state in ('pending', 'approved', 'processing', 'completed') do nothing
  returning id into v_refund;
  if v_refund is null then return jsonb_build_object('result', 'already_requested'); end if;
  return jsonb_build_object('result', 'requested', 'refund_id', v_refund,
                            'decision_sla_days', (private.entitlement_policy('refund_rules') ->> 'decision_sla_days')::integer);
end $$;
revoke all on function public.request_order_refund(uuid, text) from public, anon;
grant execute on function public.request_order_refund(uuid, text) to authenticated;

-- decide: the two-tier definition plus one rule: a decline needs a reason the patient can read.
create or replace function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
  m record;
  v_ended boolean := false;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;
  if not p_approved then
    if char_length(btrim(coalesce(p_note, ''))) < 5 then return jsonb_build_object('result', 'reason_needed'); end if;
    update public.refunds set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = btrim(p_note) where id = p_refund;
    return jsonb_build_object('result', 'rejected', 'refund_id', p_refund);
  end if;
  update public.refunds set state = 'approved', decided_by = v_uid, decided_at = now(), decision_note = p_note where id = p_refund;
  select * into o from public.orders where id = r.order_id;
  select * into e from public.entitlements where order_id = r.order_id and state = 'active';
  if e.id is not null then
    update public.entitlements set state = 'revoked' where id = e.id;
  end if;
  if o.state = 'paid' then
    update public.orders set state = 'refunded' where id = o.id;
  end if;
  -- Member access ends NOW. The 14 day grace is for a year that ends naturally, never for a refund. An organisation seat is not touched.
  if e.id is not null then
    for m in select id from public.patient_memberships
              where patient_id = o.beneficiary_patient_id and state = 'active' and source in ('purchase', 'voucher') loop
      v_ended := private.end_membership_now(m.id, v_uid, 'Membership refunded (refund ' || p_refund || ')') or v_ended;
    end loop;
  end if;
  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'membership_ended', v_ended, 'amount_kobo', r.amount_kobo,
                            'paystack_reference', o.paystack_reference);
end $$;
revoke all on function public.decide_order_refund(uuid, boolean, text) from public, anon;
grant execute on function public.decide_order_refund(uuid, boolean, text) to authenticated;

-- Claim an approved refund BEFORE the provider is called: approved -> processing in one locked step. Two overlapping sweeps can never both
-- send it, and a crash after the claim leaves a visible 'processing' row for the reconcile job instead of a second send.
create function public.claim_refund_for_provider(p_refund uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_ref text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'approved' then return jsonb_build_object('result', 'not_claimable', 'state', r.state); end if;
  select p.provider_reference into v_ref from public.payments p where p.order_id = r.order_id and p.status = 'success' and p.provider = 'paystack' limit 1;
  if v_ref is null then return jsonb_build_object('result', 'no_payment'); end if;
  update public.refunds set state = 'processing', attempts = attempts + 1, processing_started_at = now(), last_error_code = null where id = p_refund;
  return jsonb_build_object('result', 'claimed', 'refund_id', r.id, 'order_id', r.order_id, 'organisation_id', r.organisation_id,
                            'amount_kobo', r.amount_kobo, 'charge_reference', v_ref, 'is_test', r.is_test);
end $$;
revoke all on function public.claim_refund_for_provider(uuid) from public, anon, authenticated;
grant execute on function public.claim_refund_for_provider(uuid) to service_role;

-- The S26 version moved approved -> completed, which the state trigger refuses, so a refund Paystack accepted was never recorded.
-- This one moves processing -> completed | failed, then runs the reversal hook. Replaying it on a settled refund changes nothing.
create function private.apply_refund_provider_result(p_refund uuid, p_success boolean, p_reference text, p_response jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
begin
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state in ('completed', 'failed') then return jsonb_build_object('result', 'replay', 'state', r.state); end if;
  if r.state <> 'processing' then return jsonb_build_object('result', 'wrong_state', 'state', r.state); end if;

  if p_success then
    update public.refunds set state = 'completed', provider_reference = p_reference, provider_response = coalesce(p_response, '{}'::jsonb),
                              completed_at = now(), last_error_code = null where id = p_refund;
    perform private.complete_refund_side_effects(p_refund);
    return jsonb_build_object('result', 'completed', 'refund_id', p_refund);
  end if;
  update public.refunds set state = 'failed', provider_response = coalesce(p_response, '{}'::jsonb),
         last_error_code = left(coalesce(nullif(p_response ->> 'error_code', ''), 'provider_error'), 40)
   where id = p_refund;
  return jsonb_build_object('result', 'failed', 'refund_id', p_refund);
end $$;
revoke all on function private.apply_refund_provider_result(uuid, boolean, text, jsonb) from public, anon, authenticated;

-- The S26 version moved approved -> completed, which the state trigger refuses, so a refund Paystack accepted was never recorded.
-- This one moves processing -> completed | failed, then runs the reversal hook. Replaying it on a settled refund changes nothing.
create or replace function public.record_refund_provider_result(p_refund uuid, p_success boolean, p_reference text default null, p_response jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  return private.apply_refund_provider_result(p_refund, p_success, p_reference, p_response);
end $$;
revoke all on function public.record_refund_provider_result(uuid, boolean, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_refund_provider_result(uuid, boolean, text, jsonb) to service_role;

-- A refund stuck in 'processing' (Paystack took it but the result was never written, or Paystack gave no clear answer) is finished by a
-- person who has looked at the Paystack dashboard. Only after the stuck window, only an admin, and a paid settle also reminds finance
-- that the cash posting (a TypeScript path) did not run.
create function public.admin_settle_processing_refund(p_refund uuid, p_paid boolean, p_reference text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v_stuck integer := (private.entitlement_policy('refund_rules') ->> 'stuck_processing_hours')::integer;
  v jsonb;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'processing' then return jsonb_build_object('result', 'not_processing', 'state', r.state); end if;
  if r.processing_started_at > now() - make_interval(hours => v_stuck) then return jsonb_build_object('result', 'too_soon'); end if;
  v := private.apply_refund_provider_result(p_refund, p_paid, case when p_paid then coalesce(nullif(btrim(p_reference), ''), 'settled-by-hand') end,
         jsonb_build_object('settled_by_admin', true, 'error_code', 'settled_not_sent'));
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (r.organisation_id, (select auth.uid()), 'refund.settled_by_hand', 'refund', r.id, jsonb_build_object('paid', p_paid));
  if p_paid then
    perform private.order_incident(r.organisation_id, 'refund-cash-post:' || r.id, 'A refund was settled by hand: post its cash entry',
      'Refund ' || r.id || ' was marked sent by an admin. The automatic cash posting did not run: post Dr 4900 / Cr 1020 for ' || r.amount_kobo || ' kobo.');
  end if;
  return v;
end $$;
revoke all on function public.admin_settle_processing_refund(uuid, boolean, text) from public, anon;
grant execute on function public.admin_settle_processing_refund(uuid, boolean, text) to authenticated;

-- What an admin needs to act on, read through a function because the operational columns are not readable through the table.
create function public.admin_refund_ops() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid;
  v_stuck integer := (private.entitlement_policy('refund_rules') ->> 'stuck_processing_hours')::integer;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select organisation_id into v_org from public.profiles where id = (select auth.uid());
  return jsonb_build_object(
    'failed', coalesce((select jsonb_agg(jsonb_build_object('id', rf.id, 'order_id', rf.order_id, 'amount_kobo', rf.amount_kobo, 'attempts', rf.attempts,
                 'last_error_code', rf.last_error_code, 'provider_status', rf.provider_status, 'updated_at', rf.updated_at,
                 'patient_name', p.full_name, 'name_key', ci.name_key, 'code', ci.code) order by rf.updated_at)
          from public.refunds rf join public.orders o on o.id = rf.order_id join public.catalog_items ci on ci.id = o.catalog_item_id
          left join public.profiles p on p.id = o.beneficiary_patient_id
         where rf.organisation_id = v_org and rf.is_test = false and rf.state = 'failed'), '[]'::jsonb),
    'stuck', coalesce((select jsonb_agg(jsonb_build_object('id', rf.id, 'order_id', rf.order_id, 'amount_kobo', rf.amount_kobo, 'attempts', rf.attempts,
                 'processing_started_at', rf.processing_started_at, 'provider_status', rf.provider_status,
                 'patient_name', p.full_name, 'name_key', ci.name_key, 'code', ci.code) order by rf.processing_started_at)
          from public.refunds rf join public.orders o on o.id = rf.order_id join public.catalog_items ci on ci.id = o.catalog_item_id
          left join public.profiles p on p.id = o.beneficiary_patient_id
         where rf.organisation_id = v_org and rf.is_test = false and rf.state = 'processing'
           and rf.processing_started_at < now() - make_interval(hours => v_stuck)), '[]'::jsonb));
end $$;
revoke all on function public.admin_refund_ops() from public, anon;
grant execute on function public.admin_refund_ops() to authenticated;

-- A failed refund goes back to the queue by an admin's hand (never automatically: a person looks at why it failed first).
create function public.retry_failed_refund(p_refund uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'failed' then return jsonb_build_object('result', 'not_failed', 'state', r.state); end if;
  -- the weekly reconcile found Paystack disagreeing with us (for example it shows this refund as sent): a person checks the dashboard before it is sent again
  if r.provider_status = 'mismatch' then return jsonb_build_object('result', 'provider_mismatch'); end if;
  begin
    update public.refunds set state = 'approved' where id = p_refund;
  exception when unique_violation then
    return jsonb_build_object('result', 'another_refund_live');
  end;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
  values (r.organisation_id, (select auth.uid()), 'refund.retry', 'refund', r.id, jsonb_build_object('attempts', r.attempts));
  return jsonb_build_object('result', 'requeued', 'refund_id', p_refund);
end $$;
revoke all on function public.retry_failed_refund(uuid) from public, anon;
grant execute on function public.retry_failed_refund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. The reversal hook
-- ---------------------------------------------------------------------------
-- 6a. Which encounters an order paid for. Written by whatever consumes the entitlement for a consultation (service role).
create table public.order_encounter_links (
  encounter_id uuid primary key references public.encounters (id) on delete restrict,
  order_id     uuid not null references public.orders (id) on delete restrict,
  created_at   timestamptz not null default now()
);
create index order_encounter_links_order_idx on public.order_encounter_links (order_id);
alter table public.order_encounter_links enable row level security;
revoke all on public.order_encounter_links from public, anon, authenticated;

create function public.link_order_encounter(p_order uuid, p_encounter uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  insert into public.order_encounter_links (encounter_id, order_id) values (p_encounter, p_order) on conflict (encounter_id) do nothing;
  get diagnostics n = row_count;
  -- linked after the refund already completed: reverse its share now (the catch-up would do it within the hour; a failure is left to it)
  if n = 1 then
    begin
      perform private.reverse_consultation_shares_for_refund(rf.id) from public.refunds rf where rf.order_id = p_order and rf.state = 'completed';
    exception when others then
      insert into public.audit_log (organisation_id, action, entity_type, entity_id, event)
      select o.organisation_id, 'refund.link_reverse_error', 'order', o.id, jsonb_build_object('error', sqlerrm) from public.orders o where o.id = p_order;
    end;
  end if;
  return n = 1;
end $$;
revoke all on function public.link_order_encounter(uuid, uuid) from public, anon, authenticated;
grant execute on function public.link_order_encounter(uuid, uuid) to service_role;

-- 6b. GL: completes the S26 stub. It returns null when there is nothing to release, and that is final, not "try later": an order becomes 'refunded'
-- when the refund is approved, and private.post_order_to_ledger never posts a refunded order that has no journal yet (S25c), so a payment journal that
-- is missing now will not appear later. (The cash-out for such an order is still posted by the existing path: OQ-S26b-03.)
-- The cash side (Dr 4900 Refunds / Cr 1020 Cash) is posted by the existing refund.processed path
-- (recordRefundLedgerEntry), so this posts only what that path does not: the deferred revenue that was never recognised before the
-- schedule was cancelled (Dr 2000 / Cr 4900). Together: 4900 ends up holding exactly the revenue already recognised, 2000 holds nothing
-- for the order, cash is credited once. An order with no schedule (point-of-sale revenue, or never posted) has nothing deferred to release.
drop function if exists private.post_refund_reversal(uuid, bigint);
create function private.post_refund_reversal(p_refund uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  s public.revenue_recognition_schedules%rowtype;
  v_unrec bigint;
  v_date date := (now() at time zone 'Africa/Lagos')::date;
begin
  select * into r from public.refunds where id = p_refund;
  if not found then return null; end if;
  select * into s from public.revenue_recognition_schedules where source_kind = 'order' and source_id = r.order_id;
  if not found then return null; end if;
  if not exists (select 1 from public.finance_journal_entries where source = 'payment' and source_ref = 'order:' || r.order_id) then return null; end if;
  v_unrec := least(s.total_minor - s.recognized_minor, r.amount_kobo);
  if v_unrec <= 0 then return null; end if;
  return private.finance_post_journal(v_date, 'NGN', 'adjustment', 'refund_deferred_release:' || r.id, 'Refund: release unrecognised deferred revenue',
    jsonb_build_array(
      jsonb_build_object('account_code', '2000', 'debit_minor', v_unrec, 'credit_minor', 0, 'organisation_id', r.organisation_id),
      jsonb_build_object('account_code', '4900', 'debit_minor', 0, 'credit_minor', v_unrec, 'organisation_id', r.organisation_id)), null);
end $$;
revoke all on function private.post_refund_reversal(uuid) from public, anon, authenticated;

-- 6c. Earnings: a negative adjustment for each consultation share already posted for an encounter this order paid for. Old lines are never
-- touched. One reversal per refund and line (the ledger's unique key), never more than what is left of the line.
create function private.reverse_consultation_shares_for_refund(p_refund uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  o public.orders%rowtype;
  l public.earnings_ledger%rowtype;
  v_ref uuid;
  v_rev bigint;
  v_prior bigint;
  n integer := 0;
begin
  select * into r from public.refunds where id = p_refund;
  if not found or r.state <> 'completed' then return 0; end if;
  select * into o from public.orders where id = r.order_id;
  if not found or o.amount_kobo <= 0 then return 0; end if;
  for l in
    select el.* from public.earnings_ledger el
      join public.order_encounter_links ol on ol.encounter_id = el.reference_id
     where ol.order_id = r.order_id and el.kind = 'consultation' and el.amount_kobo > 0
     order by el.earned_at, el.id
  loop
    v_ref := private.earnings_ref('refund_reversal:' || r.id || ':' || l.id);
    continue when exists (select 1 from public.earnings_ledger where clinician_id = l.clinician_id and kind = 'adjustment' and reference_id = v_ref);
    v_rev := case when r.amount_kobo >= o.amount_kobo then l.amount_kobo else (l.amount_kobo * r.amount_kobo) / o.amount_kobo end;
    select coalesce(sum(-a.amount_kobo), 0) into v_prior from public.earnings_ledger a
     where a.clinician_id = l.clinician_id and a.kind = 'adjustment' and a.calculation ->> 'corrects' = l.id::text and a.calculation ? 'refund_id';
    v_rev := least(v_rev, l.amount_kobo - v_prior);
    continue when v_rev <= 0;
    perform private.ledger_insert(l.organisation_id, l.clinician_id, 'adjustment', 'refund_reversal', v_ref, -v_rev, null,
      jsonb_build_object('reason', 'The patient payment for this consultation was refunded', 'corrects', l.id, 'refund_id', r.id,
                         'order_id', r.order_id, 'reversal_kobo', v_rev, 'line_kobo', l.amount_kobo, 'line_already_paid', l.payout_id is not null),
      now(), l.is_test, 'Refund reversal of a consultation share (refund ' || r.id || ')', r.decided_by);
    perform private.credential_notify(l.clinician_id, l.organisation_id, 'A correction was added to your earnings',
      'A correction was added to your earnings statement because a patient payment was refunded. You can read it under Earnings in your console.',
      jsonb_build_object('refund_id', r.id), false);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.reverse_consultation_shares_for_refund(uuid) from public, anon, authenticated;

-- 6d. Run both halves. A failure never undoes the money state (the refund really was paid); it raises an incident and the catch-up retries.
create function private.complete_refund_side_effects(p_refund uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.refunds%rowtype;
begin
  select * into r from public.refunds where id = p_refund;
  if not found or r.state <> 'completed' then return; end if;
  if r.gl_released_at is null then
    begin
      perform private.post_refund_reversal(p_refund);
      update public.refunds set gl_released_at = now() where id = p_refund and gl_released_at is null;
    exception when others then
      perform private.order_incident(r.organisation_id, 'refund-gl:' || r.id, 'A refund could not release its deferred revenue',
        'Refund ' || r.id || ' was paid but the ledger release failed (' || sqlerrm || '). The hourly catch-up retries it; check the accounting period.');
    end;
  end if;
  if r.earnings_reversed_at is null then
    begin
      perform private.reverse_consultation_shares_for_refund(p_refund);
      -- A consultation share can be linked or posted AFTER the refund completes (the doctor finishes the visit later). So the reversal is
      -- re-run on every catch-up for the rescan window and only then stamped; it is idempotent, so a repeat posts nothing twice.
      if r.completed_at < now() - make_interval(days => coalesce((private.entitlement_policy('refund_rules') ->> 'earnings_rescan_days')::integer, 60)) then
        update public.refunds set earnings_reversed_at = now() where id = p_refund and earnings_reversed_at is null;
      end if;
    exception when others then
      perform private.order_incident(r.organisation_id, 'refund-earnings:' || r.id, 'A refund could not reverse a clinician consultation share',
        'Refund ' || r.id || ' was paid but the earnings reversal failed (' || sqlerrm || '). The hourly catch-up retries it.');
    end;
  end if;
end $$;
revoke all on function private.complete_refund_side_effects(uuid) from public, anon, authenticated;

create function private.refund_catch_up() returns integer
language plpgsql security definer set search_path = '' as $$
declare x record; n integer := 0;
begin
  for x in select id from public.refunds where state = 'completed' and (gl_released_at is null or earnings_reversed_at is null)
            order by completed_at nulls first limit 200 loop
    perform private.complete_refund_side_effects(x.id);
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.refund_catch_up() from public, anon, authenticated;

create function public.service_run_refund_catch_up() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return private.refund_catch_up();
end $$;
revoke all on function public.service_run_refund_catch_up() from public, anon, authenticated;
grant execute on function public.service_run_refund_catch_up() to service_role;

-- ---------------------------------------------------------------------------
-- 7. Reconciliation against Paystack
-- ---------------------------------------------------------------------------
-- What a refund of each of our states should look like on Paystack's side. One place, so the edge function holds no rules.
create function private.refund_reconcile_verdict(p_state text, p_provider_status text, p_ours bigint, p_theirs bigint) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_provider_status is null or p_provider_status in ('not_found', 'none') then
      case when p_state in ('failed', 'approved') then 'matched' else 'not_found' end   -- never reached Paystack: right for these states
    when p_theirs is not null and p_theirs <> p_ours then 'mismatch'
    when p_state = 'completed'  and p_provider_status in ('pending', 'processing', 'processed') then 'matched'
    when p_state = 'processing' and p_provider_status in ('pending', 'processing', 'processed', 'needs-attention') then 'matched'
    when p_state = 'failed'     and p_provider_status = 'failed' then 'matched'    -- both sides say it did not go
    else 'mismatch'
  end
$$;
revoke all on function private.refund_reconcile_verdict(text, text, bigint, bigint) from public, anon, authenticated;

create function public.refunds_needing_reconcile(p_limit integer default 100)
returns table (id uuid, state text, amount_kobo bigint, provider_reference text, charge_reference text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return query
    select rf.id, rf.state, rf.amount_kobo, rf.provider_reference,
           (select p.provider_reference from public.payments p where p.order_id = rf.order_id and p.status = 'success' limit 1)
      from public.refunds rf
     where rf.is_test = false and rf.state in ('processing', 'completed', 'failed')
       and (rf.provider_status is distinct from 'matched' or rf.provider_checked_at < now() - interval '60 days')
     order by rf.provider_checked_at nulls first, rf.created_at
     limit greatest(least(coalesce(p_limit, 100), 500), 1);
end $$;
revoke all on function public.refunds_needing_reconcile(integer) from public, anon, authenticated;
grant execute on function public.refunds_needing_reconcile(integer) to service_role;

-- Record what Paystack said. A mismatch is an incident, once per refund (private.order_incident updates the open one instead of adding another).
create function public.record_refund_reconcile(p_refund uuid, p_provider_status text, p_provider_amount_kobo bigint default null) returns text
language plpgsql security definer set search_path = '' as $$
declare
  r public.refunds%rowtype;
  v text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return 'not_found'; end if;
  v := private.refund_reconcile_verdict(r.state, p_provider_status, r.amount_kobo, p_provider_amount_kobo);
  update public.refunds set provider_status = v, provider_checked_at = now() where id = p_refund;
  if v <> 'matched' then
    perform private.order_incident(r.organisation_id, 'refund-mismatch:' || r.id, 'A refund does not match Paystack',
      'Refund ' || r.id || ' is ' || r.state || ' here but Paystack reports ' || coalesce(p_provider_status, 'nothing') ||
      ' (ours ' || r.amount_kobo || ' kobo, theirs ' || coalesce(p_provider_amount_kobo::text, 'unknown') || '). A person must check the Paystack dashboard before anything is retried.');
  end if;
  return v;
end $$;
revoke all on function public.record_refund_reconcile(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_refund_reconcile(uuid, text, bigint) to service_role;

-- Refunds that sit too long: undecided past the SLA, approved but never sent, or stuck mid-send.
create function private.flag_refund_delays() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  x record;
  v_rules jsonb := private.entitlement_policy('refund_rules');
  v_sla integer := (v_rules ->> 'decision_sla_days')::integer;
  v_stuck integer := (v_rules ->> 'stuck_processing_hours')::integer;
  n integer := 0;
begin
  for x in
    select rf.id, rf.organisation_id, rf.state from public.refunds rf
     where rf.is_test = false and (
           (rf.state = 'pending'    and rf.created_at < now() - make_interval(days => v_sla))
        or (rf.state = 'approved'   and rf.decided_at < now() - interval '1 day')
        or (rf.state = 'processing' and rf.processing_started_at < now() - make_interval(hours => v_stuck))
        or (rf.state = 'failed'     and rf.updated_at < now() - interval '1 day'))
  loop
    perform private.order_incident(x.organisation_id, 'refund-delay:' || x.id, 'A refund is taking too long',
      'Refund ' || x.id || ' has been ' || x.state || ' longer than expected. Decide it, retry it, or check the Paystack dashboard.');
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.flag_refund_delays() from public, anon, authenticated;

create function public.service_flag_refund_delays() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  return private.flag_refund_delays();
end $$;
revoke all on function public.service_flag_refund_delays() from public, anon, authenticated;
grant execute on function public.service_flag_refund_delays() to service_role;

-- The sweep route raises this when a refund was paid at Paystack but its cash posting (recordRefundLedgerEntry, a TypeScript path) failed.
create function public.service_refund_incident(p_refund uuid, p_what text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.refunds%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund;
  if not found then return; end if;
  if p_what = 'record_failed' then
    perform private.order_incident(r.organisation_id, 'refund-record:' || r.id, 'A refund was sent to Paystack but not recorded',
      'Refund ' || r.id || ' was accepted by Paystack but the result could not be written here. It stays "processing". Check the Paystack dashboard, then settle it from the admin refunds screen.');
  elsif p_what = 'ambiguous_provider_outcome' then
    perform private.order_incident(r.organisation_id, 'refund-ambiguous:' || r.id, 'A refund may or may not have reached Paystack',
      'Refund ' || r.id || ' got no clear answer from Paystack (a timeout, a network failure or an already-reversed reply). It stays "processing" and is NOT retried. Check the Paystack dashboard, then settle it from the admin refunds screen.');
  else
    perform private.order_incident(r.organisation_id, 'refund-cash-post:' || r.id, 'A paid refund has no cash posting',
      'Refund ' || r.id || ' was sent to Paystack and recorded, but the cash posting failed (' || left(coalesce(p_what, 'unknown'), 200) || '). Post Dr 4900 / Cr 1020 by hand or re-run the refund.processed posting.');
  end if;
end $$;
revoke all on function public.service_refund_incident(uuid, text) from public, anon, authenticated;
grant execute on function public.service_refund_incident(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. Weekly schedule for the reconcile edge function (Mondays 03:30 Lagos = 02:30 UTC). Fails closed until the Vault secrets exist,
--    exactly like order-reconcile (S25): the Vault secret refund_reconcile_secret must exist and equal the function's REFUND_RECONCILE_SECRET.
-- ---------------------------------------------------------------------------
-- Hourly: flag refunds that are late or stuck and retry any reversal half that failed. Pure SQL, no HTTP, so it needs no secret.
select cron.schedule('refund-hourly-sweep', '17 * * * *', $$ select private.flag_refund_delays(); select private.refund_catch_up(); $$);

select cron.schedule(
  'refund-reconcile',
  '30 2 * * 1',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/refund-reconcile',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'edge_function_publishable_key'),
      'x-refund-reconcile-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'refund_reconcile_secret'),
      'Content-Type', 'application/json'
    ),
    timeout_milliseconds := 25000
  ) as request_id;
  $$
);

-- ---------------------------------------------------------------------------
-- 9. Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if private.entitlement_reminder_steps() <> array[30, 7, 1] then raise exception 'S26b: reminder steps are not 30, 7, 1'; end if;
  if private.entitlement_grace_days() <> 7 then raise exception 'S26b: grace is not 7 days'; end if;
  if private.order_refund_cooling_off_days() <> 14 then raise exception 'S26b: cooling off is not 14 days'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'refunds_step_notice') then raise exception 'S26b: refund step trigger missing'; end if;
  if private.refund_reconcile_verdict('completed', 'processed', 100, 100) <> 'matched'
     or private.refund_reconcile_verdict('completed', 'processed', 100, 90) <> 'mismatch'
     or private.refund_reconcile_verdict('completed', 'not_found', 100, null) <> 'not_found' then
    raise exception 'S26b: reconcile verdict is wrong';
  end if;
  if has_function_privilege('anon', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_refund_provider_result(uuid, boolean, text, jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_refund_provider_result(uuid, boolean, text, jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.retry_failed_refund(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.entitlement_policy_public()', 'EXECUTE')
     or has_function_privilege('anon', 'public.link_order_encounter(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.link_order_encounter(uuid, uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.refunds_needing_reconcile(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_refund_reconcile(uuid, text, bigint)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.service_run_entitlement_reminders()', 'EXECUTE')
     or has_function_privilege('anon', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_order_refund(uuid, text)', 'EXECUTE') then
    raise exception 'S26b: a refund function is callable by the wrong role';
  end if;
  if not has_function_privilege('service_role', 'public.claim_refund_for_provider(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.request_order_refund(uuid, text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.decide_order_refund(uuid, boolean, text)', 'EXECUTE') then
    raise exception 'S26b: a refund function lost a grant it needs';
  end if;
  if has_column_privilege('authenticated', 'public.refunds', 'provider_response', 'SELECT')
     or has_column_privilege('authenticated', 'public.refunds', 'last_error_code', 'SELECT')
     or has_column_privilege('authenticated', 'public.refunds', 'provider_status', 'SELECT') then
    raise exception 'S26b: a patient can read a refund operational column';
  end if;
  if not has_column_privilege('authenticated', 'public.refunds', 'decision_note', 'SELECT')
     or not has_column_privilege('authenticated', 'public.refunds', 'state', 'SELECT') then
    raise exception 'S26b: a patient cannot read the refund columns the refund screen needs';
  end if;
  if has_function_privilege('anon', 'public.admin_refund_ops()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_settle_processing_refund(uuid, boolean, text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.apply_refund_provider_result(uuid, boolean, text, jsonb)', 'EXECUTE') then
    raise exception 'S26b: an admin refund function is callable by the wrong role';
  end if;
  if exists (select 1 from pg_proc where proname = 'post_refund_reversal' and pronamespace = 'private'::regnamespace and pronargs = 2) then
    raise exception 'S26b: the old two-argument post_refund_reversal still exists';
  end if;
end $$;

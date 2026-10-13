-- Two tiers, nothing between (founder decisions 2026-10-12): Free, or Member. Two parts.
--
-- A. Nothing else is for sale. The 3-month care pack, every per-item doctor-time product, the paid credits and the doctor-supported
--    chronic pack are made non-sellable and KEPT: no table, row, enum value or price is deleted or repriced (history stays truthful),
--    and a CHECK stops anyone switching them back on without first dropping the constraint on purpose. Every purchase route reads
--    is_active (record_service_purchase_intent, create_sponsored_service_reservation, pin_video_visit_amount, public_price_list were
--    read from the live function bodies), so is_active = false closes them all; a credit someone already holds stays redeemable
--    because redeem_available_service_purchase and has_available_service_purchase do not read is_active.
--    LIVE COUNTS BEFORE (read-only, 2026-10-12): catalog_items other than the Membership: 0 (the 3-month care pack bp_care_pack_3m has
--    no row live); orders 0; entitlements 0; service_products matching the doctor-time rule 20, of which 8 active (prescription_renewal,
--    result_interpretation, async_consult, second_opinion, video_visit, chronic_care_review, medication_review credits and
--    written_result_interpretation); service_purchases of those products 1 (one active confidential_message_credit, which stays
--    redeemable); chronic_doctor_supported_pack already inactive. NOT touched because the founder did not name them:
--    ai_coach_daily_pass_30d and continuous_monitoring_90d (both active, 0 purchases of the pass, the 90 day monitoring pack is
--    unpurchased) and the already-inactive monitoring and weight-management packs; they are reported for a decision.
--
-- B. The Membership lifecycle. A year ends or is refunded, the person keeps Member status for a 14 day grace (grace_days, PROPOSED,
--    versioned in membership_lapse_config and mirrored as membership.lapse), is reminded 30, 14 and 7 days before the end (in-app, push
--    or email by their own preference; never SMS), and when grace ends the membership becomes 'lapsed': the person is Free again. Open
--    clinical tasks and booked follow-ups are not dropped: a neutral hand-off task goes to a doctor. Nothing is deleted. The single
--    question "is this person a Member" is private.patient_is_member (S22b); this migration is the only place that changes it, and the
--    Free red-event path (branch two-tier/free-red-path, private.patient_may_page_doctor) reads it, so there is no second definition.

-- ---------------------------------------------------------------------------
-- A. Non-sellable
-- ---------------------------------------------------------------------------
update public.catalog_items set active = false, updated_at = now() where kind <> 'membership' and active;
alter table public.catalog_items add constraint catalog_items_only_membership_sellable check (kind = 'membership' or not active);

update public.service_products set is_active = false
 where is_active and code ~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)';
alter table public.service_products add constraint service_products_doctor_time_not_sellable
  check (code !~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)' or not is_active);

-- ---------------------------------------------------------------------------
-- B1. Configuration: grace days and reminder days (PROPOSED)
-- ---------------------------------------------------------------------------
create table public.membership_lapse_config (
  id             uuid primary key default gen_random_uuid(),
  version        integer not null unique,
  is_active      boolean not null default false,
  effective_from date not null,
  rules          jsonb not null,
  created_at     timestamptz not null default now()
);
create unique index membership_lapse_config_one_active on public.membership_lapse_config (is_active) where is_active;
alter table public.membership_lapse_config enable row level security;
revoke all on public.membership_lapse_config from public, anon, authenticated;

-- membership-lapse-begin (mirrored as membership.lapse in packages/shared/src/proposed-config/registry.ts)
insert into public.membership_lapse_config (version, is_active, effective_from, rules)
values (1, true, date '2026-10-12', $json${"grace_days":14,"reminder_days_before":[30,14,7]}$json$::jsonb);
-- membership-lapse-end

create function private.membership_grace_days() returns integer language sql stable security definer set search_path = ''
as $$ select coalesce((select (rules ->> 'grace_days')::integer from public.membership_lapse_config where is_active), 14) $$;
revoke all on function private.membership_grace_days() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- B2. The one definition of "is a Member": the year, plus the grace after it. 'lapsed' is Free.
-- ---------------------------------------------------------------------------
alter table public.patient_memberships drop constraint if exists patient_memberships_state_check;
alter table public.patient_memberships add constraint patient_memberships_state_check check (state in ('active', 'ended', 'lapsed'));

create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m
                  where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= now()
                    and (m.ends_at is null or m.ends_at + make_interval(days => private.membership_grace_days()) > now()))
      or private.patient_has_feature_access(p_patient, 'async_doctor_visit');
$$;
revoke all on function private.patient_is_member(uuid) from public, anon, authenticated;

create or replace function public.my_membership() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid()); m public.patient_memberships%rowtype; v_grace integer := private.membership_grace_days();
begin
  if v_uid is null then raise exception 'order_not_authorised' using errcode = '42501'; end if;
  select * into m from public.patient_memberships
   where patient_id = v_uid and state = 'active' and starts_at <= now()
     and (ends_at is null or ends_at + make_interval(days => v_grace) > now())
   order by starts_at desc limit 1;
  if not found then return jsonb_build_object('is_member', false, 'ends_at', null, 'source', null, 'in_grace', false, 'grace_ends_at', null); end if;
  return jsonb_build_object('is_member', true, 'ends_at', m.ends_at, 'source', m.source,
    'in_grace', m.ends_at is not null and m.ends_at <= now(),
    'grace_ends_at', case when m.ends_at is null then null else m.ends_at + make_interval(days => v_grace) end);
end $$;

-- A refund starts the grace; it does not end the Membership on the spot (decide_order_refund otherwise as live on 2026-10-12).
create or replace function public.decide_order_refund(p_refund uuid, p_approved boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.refunds%rowtype;
  o public.orders%rowtype;
  e public.entitlements%rowtype;
begin
  if not private.is_admin() then raise exception 'refund_not_authorised' using errcode = '42501'; end if;
  select * into r from public.refunds where id = p_refund for update;
  if not found then return jsonb_build_object('result', 'not_found'); end if;
  if r.state <> 'pending' then return jsonb_build_object('result', 'already_decided', 'state', r.state); end if;
  if not p_approved then
    update public.refunds set state = 'rejected', decided_by = v_uid, decided_at = now(), decision_note = p_note where id = p_refund;
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
  if e.id is not null and exists (select 1 from public.patient_memberships where patient_id = o.beneficiary_patient_id and state = 'active') then
    update public.patient_memberships
       set ends_at = greatest(now(), starts_at + interval '1 second')
     where patient_id = o.beneficiary_patient_id and state = 'active' and (ends_at is null or ends_at > now());
    perform private.log_audit('membership.refund_grace_started', 'orders', o.id,
      jsonb_build_object('refund_id', p_refund, 'grace_days', private.membership_grace_days()));
  end if;
  return jsonb_build_object('result', 'approved', 'refund_id', p_refund, 'order_id', o.id,
                            'entitlement_revoked', e.id is not null, 'amount_kobo', r.amount_kobo,
                            'paystack_reference', o.paystack_reference);
end $$;
revoke all on function public.decide_order_refund(uuid, boolean, text) from public, anon;

-- ---------------------------------------------------------------------------
-- B3. Reminders, lapse, hand-off
-- ---------------------------------------------------------------------------
insert into public.task_types
  (code, version, priority_class, default_due_minutes, min_doctor_tier, required_competencies,
   lead_window_minutes, claim_timeout_minutes, pushable, creatable, source_task_keys, note) values
  ('membership_handoff', 1, 9, 4320, 'senior_medical_officer', '{}', 0, 30, false, true, '{}',
   'Created when a Membership lapses while the person still has open clinical tasks or booked follow-ups. A doctor decides what happens to each; nothing is dropped.');

insert into public.notification_templates (key, category, business_priority, audience, default_channels, timing, description) values
  ('membership_renewal_reminder', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
   'Sent 30, 14 and 7 days before a Membership year ends. Neutral wording, no clinical content; never SMS; never auto-renews.'),
  ('membership_employer_cover_ending', 'operational', 'important', 'patient', '{in_app,push,email}', 'scheduled',
   'Sent 30, 14 and 7 days before an employer-paid Membership ends. Does not ask the person to buy anything.'),
  ('membership_lapsed', 'operational', 'important', 'patient', '{in_app,push,email}', 'immediate',
   'Sent when the 14 day grace after a Membership has ended. The person is on the free plan; records are kept.')
on conflict (key) do nothing;
insert into public.notification_template_locales (template_key, locale, channel, subject, body) values
  ('membership_renewal_reminder', 'en', 'in_app', 'Your Membership ends soon', 'Your Membership ends on {{ends_at}}. You can renew it from the Membership page. Your records stay with you either way.'),
  ('membership_renewal_reminder', 'en', 'push', 'Your Membership ends soon', 'Your Membership ends on {{ends_at}}. You can renew it from the Membership page.'),
  ('membership_renewal_reminder', 'en', 'email', 'Your TarragonHealth Membership ends soon', E'Hi there,\n\nYour Membership ends on {{ends_at}}. You can renew it from the Membership page in the app. For 14 days after it ends you keep your Member access, and your records stay with you either way.\n\nYour care team'),
  ('membership_employer_cover_ending', 'en', 'in_app', 'Your Membership through work ends soon', 'Your Membership through your employer ends on {{ends_at}}. Please ask your employer whether it will be renewed. Your records stay with you either way.'),
  ('membership_employer_cover_ending', 'en', 'push', 'Your Membership through work ends soon', 'Your Membership through your employer ends on {{ends_at}}. Please ask your employer whether it will be renewed.'),
  ('membership_employer_cover_ending', 'en', 'email', 'Your TarragonHealth Membership through work ends soon', E'Hi there,\n\nYour Membership through your employer ends on {{ends_at}}. Please ask your employer whether it will be renewed. Your records stay with you either way.\n\nYour care team'),
  ('membership_lapsed', 'en', 'in_app', 'Your Membership has ended', 'Your Membership has ended and your account is on the free plan. Your records are all still here. You can join again from the Membership page.'),
  ('membership_lapsed', 'en', 'push', 'Your Membership has ended', 'Your account is on the free plan and your records are all still here.'),
  ('membership_lapsed', 'en', 'email', 'Your TarragonHealth Membership has ended', E'Hi there,\n\nYour Membership has ended and your account is on the free plan. Your records are all still here. You can join again from the Membership page in the app.\n\nYour care team')
on conflict (template_key, locale, channel) do nothing;

create table public.membership_renewal_reminders (
  membership_id uuid not null references public.patient_memberships (id) on delete cascade,
  days_before   integer not null check (days_before > 0),
  sent_at       timestamptz not null default now(),
  primary key (membership_id, days_before)
);
alter table public.membership_renewal_reminders enable row level security;
revoke all on public.membership_renewal_reminders from public, anon, authenticated;

create function private.queue_membership_renewal_reminders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_days integer[] := coalesce((select array(select jsonb_array_elements_text(rules -> 'reminder_days_before')::integer from public.membership_lapse_config where is_active)), '{30,14,7}');
  r record; v_due integer; n integer := 0;
begin
  for r in
    select m.id, m.patient_id, m.organisation_id, m.ends_at, m.source from public.patient_memberships m
     where m.state = 'active' and m.ends_at is not null and m.ends_at > now()
       and m.ends_at <= now() + make_interval(days => (select max(d) from unnest(v_days) d))
  loop
    select min(d) into v_due from unnest(v_days) d where r.ends_at <= now() + make_interval(days => d);
    -- one reminder per threshold; a membership found late sends only the nearest one, never a burst
    if exists (select 1 from public.membership_renewal_reminders x where x.membership_id = r.id and x.days_before <= v_due) then continue; end if;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
    values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending',
            case when r.source = 'employer' then 'membership_employer_cover_ending' else 'membership_renewal_reminder' end,
            jsonb_build_object('membership_id', r.id, 'ends_at', to_char(r.ends_at at time zone 'Africa/Lagos', 'FMDD Mon YYYY'), 'days_before', v_due));
    insert into public.membership_renewal_reminders (membership_id, days_before)
      select r.id, d from unnest(v_days) d where d >= v_due on conflict do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.queue_membership_renewal_reminders() from public, anon, authenticated;

create function private.lapse_expired_memberships() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0; v_open boolean;
begin
  for r in
    select m.* from public.patient_memberships m
     where m.state = 'active' and m.ends_at is not null
       and m.ends_at + make_interval(days => private.membership_grace_days()) <= now()
     order by m.ends_at for update skip locked
  loop
    begin
      v_open := exists (select 1 from public.clinical_tasks t where t.patient_id = r.patient_id and t.state::text not in ('completed', 'cancelled'))
             or exists (select 1 from public.appointments a where a.patient_id = r.patient_id and a.scheduled_for > now()
                          and a.status::text in ('scheduled', 'held', 'booked', 'confirmed'));
      if v_open then
        -- a person decides, not a job: one neutral task, deduplicated per membership
        perform private.create_clinical_task(r.patient_id, 'membership_handoff', null, 'membership_handoff:' || r.id);
      end if;
      update public.patient_memberships
         set state = 'lapsed', ended_at = now(), end_reason = 'Membership year ended and the grace period is over'
       where id = r.id;
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values (r.organisation_id, r.patient_id, private.patient_reminder_channel(r.patient_id), 'pending', 'membership_lapsed',
              jsonb_build_object('membership_id', r.id));
      n := n + 1;
    exception when others then
      -- leave the row active (it is already Free by the clock) and tell a person; the next run tries again
      perform private.order_incident(r.organisation_id, 'membership-lapse:' || r.id, 'A Membership could not be lapsed',
        'Membership ' || r.id || ' is past its grace period but could not be closed (' || left(sqlerrm, 300) || '). The daily job retries.');
    end;
  end loop;
  return n;
end $$;
revoke all on function private.lapse_expired_memberships() from public, anon, authenticated;

-- an employee who held their own Membership is offered the organisation's seat once that one ends
create function private.activate_pending_org_seats() returns integer
language plpgsql security definer set search_path = ''
as $$
declare r record; n integer := 0; v_result text;
begin
  for r in select id, claimed_profile_id from public.employer_roster_members where status = 'claimed' and seat_state = 'already_member' loop
    if not private.patient_is_member(r.claimed_profile_id) then
      v_result := private.grant_org_seat(r.id);
      if v_result = 'seat' then
        update public.employer_roster_members set seat_state = 'seat' where id = r.id;
        n := n + 1;
      end if;
    end if;
  end loop;
  return n;
end $$;
revoke all on function private.activate_pending_org_seats() from public, anon, authenticated;

create function private.run_membership_lifecycle() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_rem integer; v_lapsed integer; v_seats integer;
begin
  v_rem := private.queue_membership_renewal_reminders();
  v_lapsed := private.lapse_expired_memberships();
  v_seats := private.activate_pending_org_seats();
  return jsonb_build_object('reminders', v_rem, 'lapsed', v_lapsed, 'seats_started', v_seats);
end $$;
revoke all on function private.run_membership_lifecycle() from public, anon, authenticated;
select cron.schedule('membership-lifecycle-daily', '10 2 * * *', $$ select private.run_membership_lifecycle(); $$);

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
declare v_n integer;
begin
  if exists (select 1 from public.catalog_items where kind <> 'membership' and active) then raise exception 'two-tier: a non-membership catalogue item is still for sale'; end if;
  select count(*) into v_n from public.service_products
   where is_active and code ~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$)';
  if v_n <> 0 then raise exception 'two-tier: % doctor-time products are still for sale', v_n; end if;
  begin
    update public.service_products set is_active = true where code = 'video_visit_credit';
    if found then raise exception 'two-tier: the constraint did not refuse re-enabling video_visit_credit'; end if;
  exception when check_violation then null;
  end;
  if private.membership_grace_days() <> 14 then raise exception 'two-tier: grace is not 14 days'; end if;
  if has_function_privilege('anon', 'private.patient_is_member(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'private.run_membership_lifecycle()', 'EXECUTE') then
    raise exception 'two-tier: a private function is callable';
  end if;
  if not exists (select 1 from public.task_types where code = 'membership_handoff' and is_active) then raise exception 'two-tier: hand-off task type missing'; end if;
end $$;

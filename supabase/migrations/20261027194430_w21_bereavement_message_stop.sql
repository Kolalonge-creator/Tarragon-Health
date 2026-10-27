-- W-21 (innovation gap register): bereavement message-stop. Must exist before the first paid sponsor.
-- (Revised in place after code review, 2026-10-27, because nothing here is applied yet. Companion: 20261027195946_w21_death_record_reversal.sql.)
--
-- What happens when a patient is recorded as deceased
--   * profiles.profile_status becomes 'deceased'. That is the only fact on the widely readable profiles row. WHO recorded it, on what basis and
--     the evidence reference live in public.death_records, readable only by an admin, finance or the CMO of the same organisation.
--   * Who may record (public.record_patient_death / request_patient_death / confirm_patient_death), always inside the patient's organisation:
--       - a clinician with a real care relationship to the patient (private.clinician_has_patient_access, the repo's relationship helper) or
--         the Chief Medical Officer: one step, basis clinician_confirmed;
--       - next of kin: TWO steps. An admin requests it with an evidence reference; it takes effect only when a DIFFERENT admin or the CMO
--         confirms. An unconfirmed request lapses after 7 days (state expired, set by the sweep).
--     The patient, a supporter and a stranger can never record. No other write path to profile_status exists (guard trigger).
--   * private.on_patient_deceased (after update, same transaction, nothing swallowed):
--       - revokes every Care Circle membership of the person (as patient or supporter) and cancels pending circle invites;
--       - writes a goodwill_refund_requests row, state needs_finance, for each UNDELIVERED paid item (an active or reserved unexpired voucher;
--         an order whose entitlement is still active, unexpired and not used up), with the basis stored. HOOK ONLY: no money moves;
--       - HOLDS one gentle message per sponsor in bereavement_sponsor_notices, send_after = recorded_at + 48 hours. Sponsors are the people who
--         pay: a circle supporter holding pay_for_care, a voucher purchaser with an active/reserved voucher or one in the last 12 months,
--         a buyer of a paid order in the last 12 months. may_name records whether the sponsor already has the person in an active link.
--         Nothing is sent inside the death transaction; the sweep (in the companion migration) sends it only if the record still stands.
--   * Notifications to a deceased person are marked status 'suppressed' at insert (BEFORE INSERT trigger on notifications): the row exists,
--     so `insert ... returning id` still returns an id and nothing is lost to audit; the senders only pick up 'pending'. SAFETY notices are
--     exempt and land normally: priority 'critical', any escalation pathway or tier, security.* templates, and a named list of emergency,
--     red-flag and follow-up templates. Everything else (renewal and expiry reminders, referral prompts, nudges, reports) is suppressed.
--   * The sponsor reports that name a person stop at the source: private.queue_sponsor_monthly_reports, private.queue_sponsor_quiet_nudges and
--     private.notify_sponsors_care_reviewed each skip a deceased beneficiary (live bodies read 2026-10-27, re-read after review).
--
-- Table naming: the new tables use the standard patient_id column and organisation_id, and are registered with the under-18 dependant guard as
-- EXEMPT (a safety and rights record must be writable for a deceased child) via private.classify_minor_dependant_table, and in staff_read_scope
-- as organisation-wide with the reason, so the minor guard and the RLS shape gate both see them.

-- 1. status on profiles (only the status; the rest is in death_records)
alter table public.profiles
  add column profile_status text not null default 'active' check (profile_status in ('active', 'deceased'));
comment on column public.profiles.profile_status is
  'W-21. active or deceased. Written only through the death-record functions; basis, recorder and evidence are in death_records (restricted).';
create index profiles_deceased_idx on public.profiles (id) where profile_status = 'deceased';

create function private.profile_is_deceased(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.profiles where id = p_profile and profile_status = 'deceased') $$;
revoke all on function private.profile_is_deceased(uuid) from public, anon, authenticated;

-- the CMO check usable inside a policy (is_cmo_user itself is not executable by signed-in users)
create function private.caller_is_cmo() returns boolean
language sql stable security definer set search_path = ''
as $$ select private.is_cmo_user((select auth.uid())) $$;
revoke all on function private.caller_is_cmo() from public, anon;
grant execute on function private.caller_is_cmo() to authenticated;

-- 2. the guard: nobody writes the status except the death-record path (to deceased) and the reversal path (back to active)
create function private.guard_profile_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.profile_status <> 'active' then raise exception 'profile_status_not_writable' using errcode = '42501'; end if;
    return new;
  end if;
  if new.profile_status is distinct from old.profile_status then
    if old.profile_status = 'active' and new.profile_status = 'deceased'
       and coalesce(current_setting('tarragon.w21_deceased_path', true), '') = 'on' then
      return new;
    end if;
    if old.profile_status = 'deceased' and new.profile_status = 'active'
       and coalesce(current_setting('tarragon.w21_reversal_path', true), '') = 'on' then
      return new;
    end if;
    raise exception 'profile_status_not_writable' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_profile_status() from public, anon, authenticated;
create trigger profiles_02_guard_profile_status before insert or update on public.profiles
  for each row execute function private.guard_profile_status();

-- 3. tables
create table public.death_records (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  basis              text not null check (basis in ('clinician_confirmed', 'next_of_kin_verified')),
  evidence_reference text,
  recorded_by        uuid references public.profiles (id) on delete set null,
  confirmed_by       uuid references public.profiles (id) on delete set null,
  recorded_at        timestamptz not null default now(),
  state              text not null default 'active' check (state in ('active', 'reversed')),
  reversed_at        timestamptz,
  constraint death_records_next_of_kin_evidence check (basis <> 'next_of_kin_verified' or char_length(btrim(coalesce(evidence_reference, ''))) >= 5),
  constraint death_records_reversed_fields check ((state = 'reversed') = (reversed_at is not null))
);
create unique index death_records_one_active on public.death_records (patient_id) where state = 'active';
comment on table public.death_records is 'W-21. Who recorded a death, on what basis, with what evidence. Admin, finance and CMO of the same organisation read it; nobody writes it directly.';

create table public.death_record_requests (
  id                 uuid primary key default gen_random_uuid(),
  organisation_id    uuid not null references public.organisations (id) on delete restrict,
  patient_id         uuid not null references public.profiles (id) on delete cascade,
  evidence_reference text not null check (char_length(btrim(evidence_reference)) >= 5),
  requested_by       uuid not null references public.profiles (id) on delete restrict,
  requested_at       timestamptz not null default now(),
  state              text not null default 'requested' check (state in ('requested', 'confirmed', 'expired')),
  confirmed_by       uuid references public.profiles (id) on delete restrict,
  confirmed_at       timestamptz,
  constraint death_record_requests_two_people check (confirmed_by is null or confirmed_by <> requested_by),
  constraint death_record_requests_state_fields check ((state = 'confirmed') = (confirmed_by is not null and confirmed_at is not null))
);
create unique index death_record_requests_one_open on public.death_record_requests (patient_id) where state = 'requested';

create table public.bereavement_sponsor_notices (
  id                  uuid primary key default gen_random_uuid(),
  organisation_id     uuid not null references public.organisations (id) on delete restrict,
  patient_id          uuid not null references public.profiles (id) on delete cascade,
  sponsor_profile_id  uuid not null references public.profiles (id) on delete cascade,
  death_record_id     uuid not null references public.death_records (id) on delete cascade,
  kind                text not null check (kind in ('bereavement', 'correction')),
  state               text not null default 'held' check (state in ('held', 'sent', 'cancelled')),
  may_name            boolean not null default false,
  send_after          timestamptz not null,
  sent_at             timestamptz,
  notification_id     uuid,
  cancelled_at        timestamptz,
  cancel_reason       text,
  created_at          timestamptz not null default now(),
  unique (death_record_id, sponsor_profile_id, kind),
  constraint bereavement_notice_state_fields check ((state = 'sent') = (sent_at is not null) and (state = 'cancelled') = (cancelled_at is not null))
);
comment on table public.bereavement_sponsor_notices is 'W-21. One held, sent or cancelled message per sponsor per death record. Never deleted: a reversal cancels or corrects.';

create table public.goodwill_refund_requests (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null references public.organisations (id) on delete restrict,
  patient_id       uuid not null references public.profiles (id) on delete cascade,
  payer_profile_id uuid not null references public.profiles (id) on delete cascade,
  source_kind      text not null check (source_kind in ('order', 'care_voucher')),
  source_id        uuid not null,
  amount_kobo      bigint not null check (amount_kobo >= 0),
  basis            text not null check (basis in ('unused_voucher', 'undelivered_entitlement')),
  state            text not null default 'needs_finance' check (state in ('needs_finance', 'approved', 'declined', 'done')),
  reason           text not null default 'bereavement',
  created_at       timestamptz not null default now(),
  unique (source_kind, source_id)
);
comment on table public.goodwill_refund_requests is
  'W-21 hook for finance. One row per undelivered paid item of a person recorded as deceased. A request only: nothing here creates a refund or moves money.';

do $$
declare t text;
begin
  foreach t in array array['death_records', 'death_record_requests', 'bereavement_sponsor_notices', 'goodwill_refund_requests'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to authenticated', t);
    perform private.classify_minor_dependant_table(t, 'exempt', 'W-21 safety and rights record: must be writable for a deceased child');
    insert into public.staff_read_scope (table_name, mode, patient_expr, category, reason)
    values (t, 'org', 'patient_id', 'medical_history', 'W-21: read only by admin, finance and the CMO of the same organisation; holds no clinical content')
    on conflict (table_name) do nothing;
  end loop;
end $$;
create policy death_records_read on public.death_records for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (private.is_admin() or private.is_finance() or private.caller_is_cmo()));
create policy death_record_requests_read on public.death_record_requests for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (private.is_admin() or private.caller_is_cmo()));
create policy bereavement_sponsor_notices_read on public.bereavement_sponsor_notices for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (private.is_admin() or private.is_finance() or private.caller_is_cmo()));
create policy goodwill_refund_requests_read on public.goodwill_refund_requests for select to authenticated
  using (organisation_id = (select private.current_org_id()) and (private.is_admin() or private.is_finance()));

-- 4. who the sponsors are: a bounded look-back (active links, or an order or voucher in the last 12 months)
create function private.bereavement_sponsors(p_patient uuid) returns table (sponsor uuid, may_name boolean)
language sql stable security definer set search_path = ''
as $$
  with s as (
    select v.purchaser_profile_id as sponsor, (v.status in ('active', 'reserved')) as named from public.care_vouchers v
     where v.beneficiary_profile_id = p_patient and v.purchaser_profile_id is not null and v.purchaser_profile_id <> p_patient
       and (v.status in ('active', 'reserved') or v.created_at > now() - interval '12 months')
    union all
    select o.buyer_profile_id,
           exists (select 1 from public.entitlements e where e.order_id = o.id and e.state = 'active' and (e.ends_at is null or e.ends_at > now()))
      from public.orders o
     where o.beneficiary_patient_id = p_patient and o.buyer_profile_id <> p_patient and o.state = 'paid' and o.paid_at > now() - interval '12 months'
    union all
    select m.supporter_id, true from public.care_circle_members m
     where m.patient_id = p_patient and 'pay_for_care' = any (m.permissions) and m.state = 'active' and m.expires_at > now()
  )
  select sponsor, bool_or(named) from s where sponsor is not null group by sponsor
$$;
revoke all on function private.bereavement_sponsors(uuid) from public, anon, authenticated;

-- 5. the cascade
create function private.on_patient_deceased() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  dr public.death_records%rowtype;
  s record;
  v_sponsors integer := 0;
begin
  select * into dr from public.death_records where patient_id = new.id and state = 'active';
  if dr.id is null then raise exception 'death_record_missing' using errcode = 'P0002'; end if;

  -- sponsors first, while the circle still shows who pays
  for s in select * from private.bereavement_sponsors(new.id) loop
    insert into public.bereavement_sponsor_notices (organisation_id, patient_id, sponsor_profile_id, death_record_id, kind, may_name, send_after)
    values (new.organisation_id, new.id, s.sponsor, dr.id, 'bereavement', s.may_name, dr.recorded_at + interval '48 hours')
    on conflict (death_record_id, sponsor_profile_id, kind) do nothing;
    v_sponsors := v_sponsors + 1;
  end loop;

  update public.care_circle_members set state = 'revoked', revoked_at = now(), revoked_by = dr.recorded_by
   where (patient_id = new.id or supporter_id = new.id) and state = 'active';
  update public.care_circle_invites set state = 'cancelled' where patient_id = new.id and state = 'pending';

  insert into public.goodwill_refund_requests (organisation_id, patient_id, payer_profile_id, source_kind, source_id, amount_kobo, basis)
  select v.organisation_id, new.id, v.purchaser_profile_id, 'care_voucher', v.id, v.amount_paid_kobo, 'unused_voucher'
    from public.care_vouchers v
   where v.beneficiary_profile_id = new.id and v.purchaser_profile_id is not null and v.purchaser_profile_id <> new.id
     and v.status in ('active', 'reserved') and v.amount_paid_kobo > 0 and (v.expires_at is null or v.expires_at > now())
  on conflict (source_kind, source_id) do nothing;
  insert into public.goodwill_refund_requests (organisation_id, patient_id, payer_profile_id, source_kind, source_id, amount_kobo, basis)
  select o.organisation_id, new.id, o.buyer_profile_id, 'order', o.id, coalesce(o.total_kobo, 0), 'undelivered_entitlement'
    from public.orders o
   where o.beneficiary_patient_id = new.id and o.buyer_profile_id <> new.id and o.state = 'paid'
     and exists (select 1 from public.entitlements e
                  where e.order_id = o.id and e.state = 'active' and e.acceptance <> 'declined'
                    and (e.ends_at is null or e.ends_at > now()) and (e.remaining_uses is null or e.remaining_uses > 0))
  on conflict (source_kind, source_id) do nothing;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (new.organisation_id, dr.recorded_by, 'bereavement.recorded', 'profile', new.id,
          jsonb_build_object('basis', dr.basis, 'death_record_id', dr.id, 'sponsors_held', v_sponsors), new.id);
  return new;
end $$;
revoke all on function private.on_patient_deceased() from public, anon, authenticated;
create trigger profiles_zz_on_patient_deceased after update of profile_status on public.profiles
  for each row when (old.profile_status is distinct from new.profile_status and new.profile_status = 'deceased')
  execute function private.on_patient_deceased();

-- 6. notifications to a deceased person: suppressed, except safety notices
create function private.notifications_bereavement_stop() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.recipient_id is null then return new; end if;
  if not exists (select 1 from public.profiles p where p.id = new.recipient_id and p.profile_status = 'deceased') then return new; end if;
  -- SAFETY notices still land: critical priority, any escalation pathway or tier, security notices, and the named emergency templates
  if new.priority = 'critical' or new.escalation_pathway is not null or new.escalation_alert_tier is not null
     or new.template like 'security.%'
     or new.template in ('emergency_followup', 'emergency_contact_alert', 'emergency_event_clinician_alert', 'red_event_guidance_waiting',
                         'critical_notification_escalation_exhausted', 'vitals_monitoring_escalated', 'on_call_page', 'on_call_unfinished') then
    return new;
  end if;
  -- everything else: the row is kept (so a caller's `returning id` still works and the record exists) but never sent
  new.status := 'suppressed';
  new.last_error := 'bereavement: recipient is deceased';
  return new;
end $$;
revoke all on function private.notifications_bereavement_stop() from public, anon, authenticated;
create trigger notifications_00_bereavement_stop before insert on public.notifications
  for each row execute function private.notifications_bereavement_stop();

-- 7. the recording paths
create function private.apply_death_record(p_patient uuid, p_basis text, p_evidence text, p_by uuid, p_confirmed_by uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_org uuid; v_status text;
begin
  select organisation_id, profile_status into v_org, v_status from public.profiles where id = p_patient and role = 'patient';
  if v_status is null then raise exception 'death_record_not_found' using errcode = 'P0002'; end if;
  if v_status = 'deceased' then return jsonb_build_object('recorded', true, 'already', true); end if;
  insert into public.death_records (organisation_id, patient_id, basis, evidence_reference, recorded_by, confirmed_by)
  values (v_org, p_patient, p_basis, nullif(btrim(coalesce(p_evidence, '')), ''), p_by, p_confirmed_by);
  perform set_config('tarragon.w21_deceased_path', 'on', true);
  update public.profiles set profile_status = 'deceased' where id = p_patient;
  perform set_config('tarragon.w21_deceased_path', 'off', true);
  return jsonb_build_object('recorded', true, 'already', false);
end $$;
revoke all on function private.apply_death_record(uuid, text, text, uuid, uuid) from public, anon, authenticated;

-- clinician path: one step, in the patient's organisation, with a real care relationship (or the CMO)
create function public.record_patient_death(p_patient uuid, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller_org uuid; v_patient_org uuid;
begin
  select organisation_id into v_caller_org from public.profiles where id = v_uid and role = 'clinician' and is_active;
  select organisation_id into v_patient_org from public.profiles where id = p_patient and role = 'patient';
  if v_uid is null or v_uid = p_patient or v_caller_org is null or v_patient_org is null or v_caller_org <> v_patient_org
     or not (private.clinician_has_patient_access(p_patient) or private.is_cmo_user(v_uid)) then
    raise exception 'death_record_not_authorised' using errcode = '42501';
  end if;
  return private.apply_death_record(p_patient, 'clinician_confirmed', p_evidence, v_uid, null);
end $$;
revoke all on function public.record_patient_death(uuid, text) from public, anon;
grant execute on function public.record_patient_death(uuid, text) to authenticated;

-- next-of-kin path, step 1: an admin of the patient's organisation asks, with an evidence reference
create function public.request_patient_death(p_patient uuid, p_evidence text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_caller_org uuid; v_patient_org uuid; v_id uuid;
begin
  select organisation_id into v_caller_org from public.profiles where id = v_uid and role = 'admin' and is_active;
  select organisation_id into v_patient_org from public.profiles where id = p_patient and role = 'patient' and profile_status = 'active';
  if v_uid is null or v_uid = p_patient or v_caller_org is null or v_patient_org is null or v_caller_org <> v_patient_org then
    raise exception 'death_record_not_authorised' using errcode = '42501';
  end if;
  if p_evidence is null or char_length(btrim(p_evidence)) < 5 then raise exception 'death_evidence_required' using errcode = '22023'; end if;
  -- a lapsed request must not block a new one while the sweep has not run yet
  update public.death_record_requests set state = 'expired' where patient_id = p_patient and state = 'requested' and requested_at < now() - interval '7 days';
  insert into public.death_record_requests (organisation_id, patient_id, evidence_reference, requested_by)
  values (v_patient_org, p_patient, btrim(p_evidence), v_uid) returning id into v_id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (v_patient_org, v_uid, 'bereavement.requested', 'profile', p_patient, jsonb_build_object('request_id', v_id), p_patient);
  return v_id;
end $$;
revoke all on function public.request_patient_death(uuid, text) from public, anon;
grant execute on function public.request_patient_death(uuid, text) to authenticated;

-- step 2: a DIFFERENT admin, or the CMO, of the same organisation confirms; only then does it take effect
create function public.confirm_patient_death(p_request uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  r public.death_record_requests%rowtype;
  v_caller_org uuid; v_res jsonb;
begin
  select organisation_id into v_caller_org from public.profiles where id = v_uid and is_active and role in ('admin', 'clinician');
  select * into r from public.death_record_requests where id = p_request and state = 'requested' for update;
  if not found then raise exception 'death_request_not_found' using errcode = 'P0002'; end if;
  if v_uid is null or v_caller_org is null or v_caller_org <> r.organisation_id or r.requested_by = v_uid
     or not (exists (select 1 from public.profiles where id = v_uid and role = 'admin') or private.is_cmo_user(v_uid)) then
    raise exception 'death_record_not_authorised' using errcode = '42501';
  end if;
  if r.requested_at < now() - interval '7 days' then raise exception 'death_request_expired' using errcode = 'P0001'; end if;
  v_res := private.apply_death_record(r.patient_id, 'next_of_kin_verified', r.evidence_reference, r.requested_by, v_uid);
  update public.death_record_requests set state = 'confirmed', confirmed_by = v_uid, confirmed_at = now() where id = r.id;
  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (r.organisation_id, v_uid, 'bereavement.confirmed', 'profile', r.patient_id, jsonb_build_object('request_id', r.id), r.patient_id);
  return v_res;
end $$;
revoke all on function public.confirm_patient_death(uuid) from public, anon;
grant execute on function public.confirm_patient_death(uuid) to authenticated;

-- 8. sponsor reports that name a person skip a deceased beneficiary. Live bodies read 2026-10-27 (and re-read in review); one filter added to each.
-- Their existing grants are left exactly as they are (create or replace keeps them). NOTE for follow-up: queue_sponsor_monthly_reports is live-granted
-- EXECUTE to authenticated, which it should not be; not changed here.
-- queue_sponsor_monthly_reports live version: 20260731023543_sponsor_monthly_report + the dedupe guard from 20260828222906 + fix 20260731023625.
create or replace function private.queue_sponsor_monthly_reports() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_row record;
  v_recently_notified uuid[];
begin
  select coalesce(array_agg(distinct recipient_id), '{}')
    into v_recently_notified
    from public.notifications
   where template = 'sponsor_monthly_report'
     and created_at > now() - interval '20 days';

  for v_row in
    select
      v.purchaser_profile_id                                    as sponsor_id,
      v.beneficiary_profile_id                                  as beneficiary_id,
      min(v.organisation_id::text)::uuid                        as organisation_id,
      (select full_name from public.profiles p where p.id = v.beneficiary_profile_id) as beneficiary_name,
      count(*) filter (where v.status = 'active')               as ready_count,
      count(*) filter (where v.status = 'reserved')             as saving_count,
      count(*) filter (where v.status = 'redeemed'
                         and v.redeemed_at > now() - interval '1 month') as used_this_month,
      sum(v.amount_paid_kobo) filter (where v.created_at > now() - interval '1 month') as spent_kobo
    from public.care_vouchers v
    where v.purchaser_profile_id is not null
      and v.purchaser_profile_id <> v.beneficiary_profile_id
      and not private.profile_is_deceased(v.beneficiary_profile_id)   -- W-21
    group by v.purchaser_profile_id, v.beneficiary_profile_id
  loop
    if v_row.sponsor_id = any(v_recently_notified) then
      continue;
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    select v_row.organisation_id, v_row.sponsor_id, ch, 'sponsor_monthly_report',
           jsonb_build_object(
             'beneficiary_name', v_row.beneficiary_name,
             'ready_count', v_row.ready_count,
             'saving_count', v_row.saving_count,
             'used_this_month', v_row.used_this_month,
             'spent_naira', (coalesce(v_row.spent_kobo, 0) / 100)::text)
      from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  end loop;
end;
$$;

create or replace function private.queue_sponsor_quiet_nudges() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_org uuid;
  v_queued int := 0;
begin
  for r in
    select pa.grantee_user_id as sponsor,
           p.id as person,
           coalesce(nullif(trim(p.full_name), ''), 'someone you support') as person_name,
           (select max(v.taken_at) from private.vitals_readings_current v where v.patient_id = p.id) as last_reading
      from public.profile_access pa
      join public.profiles p on p.id = pa.profile_id
     where pa.clinical_access
       and p.profile_status = 'active'   -- W-21
       and exists (
         select 1 from public.care_plans cp
          where cp.patient_id = p.id and cp.status = 'active'
       )
  loop
    -- Never logged anything at all is a different problem (onboarding), not a
    -- lapse. Say nothing rather than something wrong.
    if r.last_reading is null or r.last_reading > now() - interval '21 days' then
      continue;
    end if;

    if exists (
      select 1 from public.notifications
       where recipient_id = r.sponsor
         and template = 'sponsor_person_quiet'
         and (payload->>'person_id') = r.person::text
         and created_at > now() - interval '30 days'
    ) then
      continue;
    end if;

    select organisation_id into v_org from public.profiles where id = r.sponsor;
    if v_org is null then continue; end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, r.sponsor, c.channel, 'sponsor_person_quiet',
           jsonb_build_object(
             'person_id', r.person,
             'person_name', r.person_name,
             'quiet_days', extract(day from now() - r.last_reading)::int
           ),
           'non_clinical'
      from (values ('in_app'::public.notification_channel),
                   ('email'::public.notification_channel)) as c(channel);

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

create or replace function private.notify_sponsors_care_reviewed() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_sponsor uuid;
  v_org uuid;
  v_name text;
begin
  -- Only the moment of first review. An edit to an already-acknowledged alert
  -- must not re-notify.
  if new.acknowledged_at is null or old.acknowledged_at is not null then
    return new;
  end if;
  -- W-21: nothing about a deceased person goes to a sponsor
  if private.profile_is_deceased(new.patient_id) then
    return new;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'someone you support')
    into v_name
    from public.profiles p where p.id = new.patient_id;

  for v_sponsor in
    select pa.grantee_user_id
      from public.profile_access pa
     where pa.profile_id = new.patient_id
       and pa.clinical_access
  loop
    select organisation_id into v_org from public.profiles where id = v_sponsor;
    if v_org is null then continue; end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class,
       source_table, source_id)
    select v_org, v_sponsor, c.channel, 'sponsor_care_reviewed',
           jsonb_build_object('person_name', v_name),
           'non_clinical', 'clinician_alerts', new.id
      from (values ('in_app'::public.notification_channel),
                   ('email'::public.notification_channel)) as c(channel);
  end loop;

  return new;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'public.record_patient_death(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.request_patient_death(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.confirm_patient_death(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'private.caller_is_cmo()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.on_patient_deceased()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.apply_death_record(uuid,text,text,uuid,uuid)', 'EXECUTE')
     then
    raise exception 'W-21: a function has the wrong privilege';
  end if;
  if exists (select 1 from public.profiles where profile_status <> 'active') then
    raise exception 'W-21: no profile may start deceased';
  end if;
  if exists (select 1 from private.minor_guard_gaps()) then
    raise exception 'W-21: a patient table escapes the under-18 scope guard classification: %',
      (select string_agg(g.table_name || ' (' || g.problem || ')', ', ') from private.minor_guard_gaps() g);
  end if;
  raise notice 'PASS: W-21 bereavement message-stop in place';
end $$;

-- W-21 (innovation gap register): bereavement message-stop. Must exist before the first paid sponsor.
--
-- What it does when a patient is recorded as deceased:
--   * profiles.profile_status becomes 'deceased' (with deceased_at, who recorded it, and the basis). No self-service: the column is
--     writable only through public.record_patient_death(), which a clinician (either basis) or an admin (next-of-kin basis only,
--     after the verification the admin did offline) may call, never the patient and never a supporter. A trigger refuses every other
--     write path, including a patient editing their own row, and refuses any attempt to undo it.
--   * private.on_patient_deceased (after update) then, in the SAME transaction (a failure rolls the record back so a clinician retries;
--     nothing is swallowed):
--       - collects the people who paid for this person's care (care voucher purchasers, paid-order buyers, circle supporters holding
--         pay_for_care), BEFORE revoking the circle;
--       - revokes every Care Circle membership of the person (as patient or as supporter) and cancels pending circle invites, so every
--         circle view, alert and monthly block stops (circle_member_for and the views read only state = 'active');
--       - sends each such sponsor exactly ONE gentle in-app message (template sponsor_bereavement, no name, no amounts, no health data;
--         unique per person and sponsor, so a re-run sends nothing);
--       - writes a goodwill_refund_requests row per unexpired voucher and per paid order, state needs_finance. HOOK ONLY: no refund is
--         created and no money moves; finance decides case by case.
--   * Notifications to a deceased person are dropped at insert (BEFORE INSERT trigger on notifications), each drop logged in audit_log.
--     That covers renewal and expiry reminders, referral prompts, nudges and any future sender, with no list of templates to maintain.
--   * private.queue_sponsor_monthly_reports (live body, read 2026-10-27) skips a beneficiary who is deceased.
--
-- NOT built here (reported): a reversal path for a mistaken record (built separately, support-only and two-person, in
-- 20261027195946_w21_death_record_reversal.sql); email for the sponsor message (in-app only, template edit follows); any change to a payer-facing report beyond the
-- monthly queue (sponsor_person_quiet, sponsor_care_reviewed carry the beneficiary only in their payload, so they are not matched).
--
-- Column names on the new tables use beneficiary_profile_id, not patient_id, so the under-18 dependant scope guard (S04b-1e)
-- does not refuse the rows for a deceased child.

alter table public.profiles
  add column profile_status text not null default 'active' check (profile_status in ('active', 'deceased')),
  add column deceased_at timestamptz,
  add column deceased_recorded_by uuid references public.profiles (id) on delete set null,
  add column deceased_basis text check (deceased_basis in ('clinician_confirmed', 'next_of_kin_verified')),
  add constraint profiles_deceased_fields check ((profile_status = 'deceased') = (deceased_at is not null));
comment on column public.profiles.profile_status is
  'W-21. active or deceased. Written only by public.record_patient_death; a deceased profile stops circle views, sponsor reports, reminders and prompts.';

create function private.profile_is_deceased(p_profile uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select coalesce((select profile_status = 'deceased' from public.profiles where id = p_profile), false) $$;
revoke all on function private.profile_is_deceased(uuid) from public, anon, authenticated;

-- 1. nobody but the recording path may write the status, and it can never be undone in-app
create function private.guard_profile_status() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.profile_status <> 'active' then raise exception 'profile_status_not_writable' using errcode = '42501'; end if;
    return new;
  end if;
  -- deceased_recorded_by is excluded: the foreign key may null it if the recorder's own profile is ever removed
  if (new.profile_status, new.deceased_at, new.deceased_basis)
       is distinct from (old.profile_status, old.deceased_at, old.deceased_basis)
     or (old.profile_status = 'active' and new.deceased_recorded_by is distinct from old.deceased_recorded_by) then
    if old.profile_status = 'deceased' then raise exception 'profile_status_final' using errcode = '42501'; end if;
    if coalesce(current_setting('tarragon.w21_deceased_path', true), '') <> 'on' then
      raise exception 'profile_status_not_writable' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_profile_status() from public, anon, authenticated;
create trigger profiles_02_guard_profile_status before insert or update on public.profiles
  for each row execute function private.guard_profile_status();

-- 2. tables the hook writes
create table public.bereavement_sponsor_notices (
  beneficiary_profile_id uuid not null references public.profiles (id) on delete cascade,
  sponsor_profile_id     uuid not null references public.profiles (id) on delete cascade,
  notification_id        uuid,
  created_at             timestamptz not null default now(),
  primary key (beneficiary_profile_id, sponsor_profile_id)
);
alter table public.bereavement_sponsor_notices enable row level security;
create policy bereavement_sponsor_notices_finance_read on public.bereavement_sponsor_notices for select to authenticated using (private.is_finance());
grant select on public.bereavement_sponsor_notices to authenticated;

create table public.goodwill_refund_requests (
  id                     uuid primary key default gen_random_uuid(),
  organisation_id        uuid not null references public.organisations (id) on delete restrict,
  beneficiary_profile_id uuid not null references public.profiles (id) on delete cascade,
  payer_profile_id       uuid not null references public.profiles (id) on delete cascade,
  source_kind            text not null check (source_kind in ('order', 'care_voucher')),
  source_id              uuid not null,
  amount_kobo            bigint not null check (amount_kobo >= 0),
  state                  text not null default 'needs_finance' check (state in ('needs_finance', 'approved', 'declined', 'done')),
  reason                 text not null default 'bereavement',
  created_at             timestamptz not null default now(),
  unique (source_kind, source_id)
);
comment on table public.goodwill_refund_requests is
  'W-21 hook for finance. One row per unexpired voucher or paid order of a person recorded as deceased. A request only: nothing here creates a refund or moves money.';
alter table public.goodwill_refund_requests enable row level security;
create policy goodwill_refund_requests_finance_read on public.goodwill_refund_requests for select to authenticated using (private.is_finance());
grant select on public.goodwill_refund_requests to authenticated;

-- 3. the cascade
create function private.on_patient_deceased() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  s record;
  v_notif uuid;
  v_sponsors uuid[];
begin
  select coalesce(array_agg(distinct x), '{}') into v_sponsors from (
    select purchaser_profile_id x from public.care_vouchers
     where beneficiary_profile_id = new.id and purchaser_profile_id is not null and purchaser_profile_id <> new.id
    union
    select buyer_profile_id from public.orders where beneficiary_patient_id = new.id and buyer_profile_id <> new.id and state = 'paid'
    union
    select supporter_id from public.care_circle_members
     where patient_id = new.id and 'pay_for_care' = any (permissions) and state = 'active' and expires_at > now()
  ) q where x is not null;

  -- every circle the person is in, either side: views, alerts and the monthly block read only state = 'active'
  update public.care_circle_members set state = 'revoked', revoked_at = now(), revoked_by = new.deceased_recorded_by
   where (patient_id = new.id or supporter_id = new.id) and state = 'active';
  update public.care_circle_invites set state = 'cancelled' where patient_id = new.id and state = 'pending';

  -- goodwill hook (no money moves)
  insert into public.goodwill_refund_requests (organisation_id, beneficiary_profile_id, payer_profile_id, source_kind, source_id, amount_kobo)
  select v.organisation_id, new.id, v.purchaser_profile_id, 'care_voucher', v.id, v.amount_paid_kobo
    from public.care_vouchers v
   where v.beneficiary_profile_id = new.id and v.purchaser_profile_id is not null and v.purchaser_profile_id <> new.id
     and v.status in ('active', 'reserved') and v.amount_paid_kobo > 0
  on conflict (source_kind, source_id) do nothing;
  insert into public.goodwill_refund_requests (organisation_id, beneficiary_profile_id, payer_profile_id, source_kind, source_id, amount_kobo)
  select o.organisation_id, new.id, o.buyer_profile_id, 'order', o.id, coalesce(o.total_kobo, 0)
    from public.orders o
   where o.beneficiary_patient_id = new.id and o.buyer_profile_id <> new.id and o.state = 'paid' and o.paid_at > now() - interval '400 days'
  on conflict (source_kind, source_id) do nothing;

  -- exactly one gentle message to each sponsor: no name, no amount, no health data
  for s in select p.id, p.organisation_id from public.profiles p where p.id = any (v_sponsors) and p.profile_status = 'active' loop
    if exists (select 1 from public.bereavement_sponsor_notices where beneficiary_profile_id = new.id and sponsor_profile_id = s.id) then continue; end if;
    insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload, content_class)
    values (s.organisation_id, s.id, 'in_app', 'pending', 'sponsor_bereavement', '{}'::jsonb, 'non_clinical')
    returning id into v_notif;
    insert into public.bereavement_sponsor_notices (beneficiary_profile_id, sponsor_profile_id, notification_id) values (new.id, s.id, v_notif);
  end loop;

  insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event, subject_patient_id)
  values (new.organisation_id, new.deceased_recorded_by, 'bereavement.recorded', 'profile', new.id,
          jsonb_build_object('basis', new.deceased_basis, 'sponsors_told', coalesce(array_length(v_sponsors, 1), 0)), new.id);
  return new;
end $$;
revoke all on function private.on_patient_deceased() from public, anon, authenticated;
create trigger profiles_zz_on_patient_deceased after update of profile_status on public.profiles
  for each row when (old.profile_status is distinct from new.profile_status and new.profile_status = 'deceased')
  execute function private.on_patient_deceased();

-- 4. nothing is sent to a deceased person
create function private.notifications_bereavement_stop() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if private.profile_is_deceased(new.recipient_id) then
    insert into public.audit_log (organisation_id, action, entity_type, entity_id, event, subject_patient_id)
    values (new.organisation_id, 'bereavement.notification_suppressed', 'profile', new.recipient_id,
            jsonb_build_object('template', new.template, 'channel', new.channel), new.recipient_id);
    return null;
  end if;
  return new;
end $$;
revoke all on function private.notifications_bereavement_stop() from public, anon, authenticated;
create trigger notifications_00_bereavement_stop before insert on public.notifications
  for each row execute function private.notifications_bereavement_stop();

-- 5. the recording path
create function public.record_patient_death(p_patient uuid, p_basis text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_role text;
  v_status text;
begin
  select role::text into v_role from public.profiles where id = v_uid and is_active;
  if v_uid is null or v_uid = p_patient
     or v_role is null or v_role not in ('clinician', 'admin')
     or p_basis not in ('clinician_confirmed', 'next_of_kin_verified')
     or (v_role = 'admin' and p_basis <> 'next_of_kin_verified') then
    raise exception 'death_record_not_authorised' using errcode = '42501';
  end if;
  select profile_status into v_status from public.profiles where id = p_patient and role = 'patient';
  if v_status is null then raise exception 'death_record_not_found' using errcode = 'P0002'; end if;
  if v_status = 'deceased' then return jsonb_build_object('recorded', true, 'already', true); end if;
  perform set_config('tarragon.w21_deceased_path', 'on', true);
  update public.profiles set profile_status = 'deceased', deceased_at = now(), deceased_recorded_by = v_uid, deceased_basis = p_basis
   where id = p_patient;
  perform set_config('tarragon.w21_deceased_path', 'off', true);
  return jsonb_build_object('recorded', true, 'already', false);
end $$;
revoke all on function public.record_patient_death(uuid, text) from public, anon;
grant execute on function public.record_patient_death(uuid, text) to authenticated;

-- 6. sponsor monthly report: live body (read 2026-10-27) plus one filter
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
revoke all on function private.queue_sponsor_monthly_reports() from public, anon, authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.record_patient_death(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'private.profile_is_deceased(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.on_patient_deceased()', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.queue_sponsor_monthly_reports()', 'EXECUTE') then
    raise exception 'W-21: a function has the wrong privilege';
  end if;
  if exists (select 1 from public.profiles where profile_status <> 'active') then
    raise exception 'W-21: no profile may start deceased';
  end if;
  raise notice 'PASS: W-21 bereavement message-stop in place';
end $$;

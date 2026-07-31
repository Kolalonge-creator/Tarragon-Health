-- Tarragon Health
-- Partner regulatory license/registration tracking — closes a real gap found
-- in a Nigeria-regulator-lens review: lab_providers/pharmacy_partners/
-- specialist_providers/home_visit_providers/logistics_partners were catalogue
-- rows with no record of the underlying regulatory registration (PCN premises
-- registration for a pharmacy, NAFDAC/state facility license for a lab or
-- home-visit provider, MDCN registration for a referral-network specialist,
-- CAC business registration for a logistics partner). An admin could activate
-- a partner row with nothing behind it.
--
-- Same additive, nullable, "record it don't invent it" shape as
-- clinical_staff.indemnity_* (20260713183000/193000) — this migration adds
-- the columns and the operational plumbing (expiry gate on the two tables
-- that already have an assignment-time trigger, plus a nightly admin-alert
-- sweep across all five). It never deactivates a partner automatically —
-- per the home-visit/logistics migration's own stated design, "activating a
-- partner row is the entire mechanism" that turns a patient-facing feature
-- on, so an automatic deactivation on expiry would be a bigger, separate
-- product decision than this pass is authorised to make. This is visibility
-- + a hard gate on new assignment, not silent revocation of live service.

do $$
declare
  t text;
begin
  foreach t in array array['lab_providers', 'pharmacy_partners', 'specialist_providers', 'home_visit_providers', 'logistics_partners']
  loop
    execute format(
      $sql$
        alter table public.%I
          add column if not exists license_type text,
          add column if not exists license_number text,
          add column if not exists license_expires_at timestamptz,
          add column if not exists license_verified_at timestamptz,
          add column if not exists license_verified_by uuid references public.profiles (id) on delete restrict
      $sql$,
      t
    );
  end loop;
end;
$$;

comment on column public.lab_providers.license_type is
  'Free text, e.g. "NAFDAC facility license" or "state Ministry of Health medical laboratory license" — the exact regulator varies by lab type and state.';
comment on column public.pharmacy_partners.license_type is
  'Free text, e.g. "PCN premises registration" — the Pharmacists Council of Nigeria licenses the physical premises, not just the pharmacist.';
comment on column public.specialist_providers.license_type is
  'Free text, e.g. "MDCN registration" — this is a referral-network catalogue row, not an employed clinical_staff record, so it carries its own license fields rather than reusing clinical_staff.mdcn_number.';
comment on column public.home_visit_providers.license_type is
  'Free text, e.g. "NAFDAC facility license" or a state home-visit/phlebotomy service permit.';
comment on column public.logistics_partners.license_type is
  'Free text, e.g. "CAC business registration" — logistics partners carry lower clinical-regulatory weight than lab/pharmacy partners, tracked here for completeness.';

-- ---------------------------------------------------------------------------
-- Hard gate: extend the two existing assignment-time active-only triggers
-- (private.enforce_home_visit_provider_active / enforce_logistics_partner_active,
-- 20260716000038) to also reject a partner whose license has expired. Same
-- shape, same errcode, same "RLS admits broadly, trigger narrows" pattern —
-- an inactive OR license-expired partner can no longer be newly assigned to
-- a lab_orders/pharmacy_orders row, even if someone flips is_active back on
-- without also renewing the license.
--
-- lab_providers/pharmacy_partners/specialist_providers have no equivalent
-- existing assignment-time trigger to extend (their provider_id/
-- specialist_provider_id columns are set via RPCs — set_lab_order_facility,
-- set_referral_specialist_provider — not a bare column write caught by a
-- BEFORE trigger on the same shape as the two below) — flagged in the
-- compliance scorecard as a follow-up, not silently skipped.
-- ---------------------------------------------------------------------------

create or replace function private.enforce_home_visit_provider_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.home_visit_provider_id is not null
    and (tg_op = 'INSERT' or old.home_visit_provider_id is distinct from new.home_visit_provider_id)
  then
    if not exists (
      select 1 from public.home_visit_providers
      where id = new.home_visit_provider_id
        and is_active
        and (license_expires_at is null or license_expires_at > now())
    ) then
      raise exception 'home_visit_provider_id must reference an active home_visit_providers row with a current (non-expired) license' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.enforce_logistics_partner_active()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.logistics_partner_id is not null
    and (tg_op = 'INSERT' or old.logistics_partner_id is distinct from new.logistics_partner_id)
  then
    if not exists (
      select 1 from public.logistics_partners
      where id = new.logistics_partner_id
        and is_active
        and (license_expires_at is null or license_expires_at > now())
    ) then
      raise exception 'logistics_partner_id must reference an active logistics_partners row with a current (non-expired) license' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Nightly admin-alert sweep. Never deactivates anything — queues one
-- aggregated in_app notification (per this file's own established rule:
-- an internal ops nudge is engagement/ops, not a patient
-- reminder/alert/confirmation, so it stays off WhatsApp/SMS/email, matching
-- the 2026-07-23/24 health-education-unlock-nudge correction) to every admin
-- when an active partner's license is expired or expires within 30 days.
-- Idempotent per (partner table, partner id, day) via a dedupe table, same
-- shape as health_education_unlock_notifications.
-- ---------------------------------------------------------------------------

create table public.partner_license_expiry_notifications (
  id              uuid primary key default gen_random_uuid(),
  partner_table   text not null,
  partner_id      uuid not null,
  notified_on     date not null default current_date,
  created_at      timestamptz not null default now(),
  unique (partner_table, partner_id, notified_on)
);

alter table public.partner_license_expiry_notifications enable row level security;

create policy partner_license_expiry_notifications_select
  on public.partner_license_expiry_notifications
  for select to authenticated
  using (private.is_admin());

grant select on public.partner_license_expiry_notifications to authenticated;

create or replace function private.queue_partner_license_expiry_alerts()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t text;
  r record;
  v_admin record;
  v_message text;
  v_already_notified boolean;
begin
  foreach t in array array['lab_providers', 'pharmacy_partners', 'specialist_providers', 'home_visit_providers', 'logistics_partners']
  loop
    for r in execute format(
      $sql$
        select id, name, license_expires_at
        from public.%I
        where is_active
          and license_expires_at is not null
          and license_expires_at < now() + interval '30 days'
      $sql$,
      t
    )
    loop
      select exists (
        select 1 from public.partner_license_expiry_notifications
        where partner_table = t and partner_id = r.id and notified_on = current_date
      ) into v_already_notified;

      if v_already_notified then
        continue;
      end if;

      insert into public.partner_license_expiry_notifications (partner_table, partner_id)
      values (t, r.id)
      on conflict (partner_table, partner_id, notified_on) do nothing;

      v_message := case
        when r.license_expires_at < now() then
          format('%s (%s) license expired %s', r.name, t, to_char(r.license_expires_at, 'DD Mon YYYY'))
        else
          format('%s (%s) license expires %s', r.name, t, to_char(r.license_expires_at, 'DD Mon YYYY'))
      end;

      for v_admin in select id from public.profiles where role = 'admin'
      loop
        insert into public.notifications (recipient_id, channel, template, payload, status, content_class)
        values (
          v_admin.id,
          'in_app',
          'partner_license_expiry',
          jsonb_build_object('message', v_message, 'partner_table', t, 'partner_id', r.id),
          'pending',
          'non_clinical'
        );
      end loop;
    end loop;
  end loop;
end;
$$;

revoke all on function private.queue_partner_license_expiry_alerts() from public;

select cron.schedule(
  'partner-license-expiry-alerts-daily',
  '0 7 * * *',
  $$select private.queue_partner_license_expiry_alerts()$$
);

-- ---------------------------------------------------------------------------
-- Assertions
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_providers' and column_name = 'license_expires_at'
  ) then
    raise exception 'lab_providers.license_expires_at was not created';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'logistics_partners' and column_name = 'license_expires_at'
  ) then
    raise exception 'logistics_partners.license_expires_at was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'partner-license-expiry-alerts-daily') then
    raise exception 'partner-license-expiry-alerts-daily cron job was not scheduled';
  end if;
end;
$$;

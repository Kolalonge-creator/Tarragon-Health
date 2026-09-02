-- Tarragon Health
-- Clinical Network design pass (docs/CLINICAL_NETWORK_SPEC.md §4.3, Phase 1 —
-- "license-expiry tracking + renewal warning"), founder-approved to build.
--
-- WHAT THIS IS NOT: clinical_staff.license_verified_at already exists and is
-- a point-in-time flag ("Tarragon last checked this record on this date"),
-- and the admin UI already derives a client-side-only "re-verify annually"
-- badge from license_verified_at + 1 year (ReverifyBadge,
-- clinical-staff-manager.tsx) -- that stays as-is, it is Tarragon's OWN
-- re-verification cadence, a different fact from what this migration adds.
--
-- WHAT THIS IS: the real expiry date on the clinician's own MDCN/NMCN Annual
-- Practicing License (APL) -- an external, regulator-issued date an admin
-- reads off the physical/PDF licence document, independent of when Tarragon
-- last double-checked it. Nigerian medical/nursing practicing licences are
-- renewed annually and the renewal date has no fixed relationship to
-- Tarragon's own verification date, so it needs its own column rather than
-- being derived.
--
-- Deliberately notify-only, same posture as
-- clinical_staff_indemnity_lapse_notify (20260826224913) and for the same
-- reason: clinical_staff_active_requires_verification only requires
-- license_verified_at is not null -- it was never a re-check-on-expiry gate,
-- and this migration does not turn it into one. No exemption concept either
-- (contrast indemnity, which is tier-gated and genuinely waivable by
-- governance decision) -- every active clinical_staff record needs a real,
-- current practicing licence; there is no legitimate reason to exempt one
-- from having its expiry tracked, only from Tarragon having filled the date
-- in yet. Rows with no license_expires_at on file are deliberately never
-- notified about here -- the column is new and starts empty for the entire
-- existing roster, so a launch-day sweep must not manufacture 7 identical
-- "no expiry date" alerts for a field nobody has had a chance to populate;
-- MissingCredentialBadge-style "field never filled in" visibility belongs in
-- the UI (a passive badge an admin sees when looking at the record), not a
-- push notification with no actionable new information.

alter table public.clinical_staff
  add column license_expires_at timestamptz;

comment on column public.clinical_staff.license_expires_at is
  'The real expiry date on this clinician''s MDCN/NMCN Annual Practicing License, as printed on the licence document -- distinct from license_verified_at (when Tarragon last checked it). Nullable and optional: an admin fills it in from the physical/PDF licence; private.notify_clinical_staff_license_lapses() only ever warns about a record that HAS this filled in, never about a blank one.';

create table public.clinical_staff_license_lapse_notifications (
  id                  uuid primary key default gen_random_uuid(),
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  notified_on         date not null default current_date,
  already_expired     boolean not null,
  created_at          timestamptz not null default now(),
  unique (clinical_staff_id, notified_on)
);

comment on table public.clinical_staff_license_lapse_notifications is
  'Dedup + audit trail for private.notify_clinical_staff_license_lapses(): one row per clinical_staff record per calendar day it is found active with a license_expires_at that is within 30 days of expiry or already past it.';

alter table public.clinical_staff_license_lapse_notifications enable row level security;

create policy clinical_staff_license_lapse_notifications_select
  on public.clinical_staff_license_lapse_notifications
  for select to authenticated
  using (private.is_org_staff((select organisation_id from public.clinical_staff where id = clinical_staff_id)));

grant select on public.clinical_staff_license_lapse_notifications to authenticated;

-- alter-default-privileges (20260731232749) grants authenticated
-- select/insert/update/delete on every new table by default -- explicitly
-- revoked here up front rather than as a later hardening follow-up (see
-- 20260826225650, which had to do this retroactively for the two sibling
-- notification tables from the same audit pass).
revoke insert, update, delete on public.clinical_staff_license_lapse_notifications from authenticated;

create or replace function private.notify_clinical_staff_license_lapses()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_already_expired boolean;
  v_admin record;
  v_message text;
begin
  for r in
    select cs.id, cs.organisation_id, cs.full_name, cs.license_expires_at
    from public.clinical_staff cs
    where cs.active
      and cs.license_expires_at is not null
      and cs.license_expires_at < now() + interval '30 days'
  loop
    v_already_expired := r.license_expires_at <= now();

    insert into public.clinical_staff_license_lapse_notifications (clinical_staff_id, already_expired)
    values (r.id, v_already_expired)
    on conflict (clinical_staff_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_message := case
      when v_already_expired then
        format('%s''s practicing license expired on %s. Renew and record the new expiry date.', r.full_name, to_char(r.license_expires_at, 'YYYY-MM-DD'))
      else
        format('%s''s practicing license expires on %s (within 30 days). Renew before it lapses.', r.full_name, to_char(r.license_expires_at, 'YYYY-MM-DD'))
    end;

    for v_admin in select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_admin.id, r.organisation_id, 'in_app', 'clinical_staff_license_lapse',
        jsonb_build_object('message', v_message, 'clinical_staff_id', r.id, 'already_expired', v_already_expired),
        'pending', 'non_clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'clinical_staff.license_lapse_flagged', 'clinical_staff', r.id,
      jsonb_build_object('already_expired', v_already_expired, 'license_expires_at', r.license_expires_at));
  end loop;
end;
$$;

comment on function private.notify_clinical_staff_license_lapses() is
  'Notify-only sweep (never deactivates): flags an active clinical_staff record whose license_expires_at is filled in and is expired or expiring within 30 days. Never fires for a record with no license_expires_at on file. Deduplicated to once per record per calendar day, always audit-logged.';

revoke all on function private.notify_clinical_staff_license_lapses() from public, anon;

select cron.schedule(
  'clinical-staff-license-lapse-notify',
  '30 6 * * *',
  $$select private.notify_clinical_staff_license_lapses()$$
);

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'clinical_staff'
      and column_name = 'license_expires_at'
  ) then
    raise exception 'clinical_staff.license_expires_at missing after migration';
  end if;

  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clinical_staff_license_lapse_notifications'
  ) then
    raise exception 'clinical_staff_license_lapse_notifications was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'clinical-staff-license-lapse-notify') then
    raise exception 'clinical-staff-license-lapse-notify cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.notify_clinical_staff_license_lapses()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.notify_clinical_staff_license_lapses';
  end if;

  if has_table_privilege('authenticated', 'public.clinical_staff_license_lapse_notifications', 'INSERT')
     or has_table_privilege('authenticated', 'public.clinical_staff_license_lapse_notifications', 'UPDATE')
     or has_table_privilege('authenticated', 'public.clinical_staff_license_lapse_notifications', 'DELETE') then
    raise exception 'FAIL: authenticated holds a write privilege on clinical_staff_license_lapse_notifications';
  end if;

  raise notice 'PASS: clinical_staff.license_expires_at + lapse notification table + function + cron job all present, anon denied, authenticated select-only';
end $$;

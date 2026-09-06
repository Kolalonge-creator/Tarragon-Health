-- Tarragon Health
-- Closes the "live monitor" gap the indemnity gate has carried since it was
-- built: clinical_staff_active_requires_indemnity /
-- private.enforce_clinical_staff_indemnity (20260713183000, rewritten
-- 20260715175909) is a WRITE-TIME gate only, by its own header's admission --
-- "it does not retroactively deactivate an already-active row if cover lapses
-- later. Ops must track expiring cover and re-verify/deactivate before it
-- lapses." Nothing was ever built to do that tracking; a Director/Tier 4/5
-- record whose indemnity quietly expires stays active indefinitely with no
-- one told.
--
-- Deliberately notify-only, never auto-deactivate. A live check before
-- writing this migration confirmed why that matters right now, not just in
-- theory: the platform's one real Clinical Director is active with
-- indemnity_expires_at = null, covered only by a deliberate, named,
-- 2026-07-30 founder-decision org-wide director exemption ("Founder is sole
-- Clinical Director pre-launch; credential verification deferred"). Any
-- sweep that deactivated on expiry/no-cover rather than merely notifying
-- would deactivate the platform's only doctor the moment this migration ran.
-- private.enforce_clinical_staff_indemnity's own exemption lookups
-- (clinical_staff_indemnity_exemptions, indemnity_exempt) are respected here
-- for exactly that reason -- this function raises awareness of a real gap,
-- it never re-decides a deliberate, named, already-granted exemption.
--
-- Two windows, escalating urgency, same dedup-per-day + audit_log discipline
-- as clinician_alert_sla_breach_escalation and
-- data_breach_deadline_notifications:
--   expires within 30 days (and not yet expired) -> notify the org's admins
--   already expired (and no exemption covers it)  -> notify the org's admins,
--                                                     flagged more urgently
-- Exempt records (individual, or covered by an org/tier/director exemption)
-- are skipped entirely -- an exemption is a deliberate governance decision,
-- not a gap to nag about.

create table public.clinical_staff_indemnity_lapse_notifications (
  id                  uuid primary key default gen_random_uuid(),
  clinical_staff_id   uuid not null references public.clinical_staff (id) on delete cascade,
  notified_on         date not null default current_date,
  already_expired     boolean not null,
  created_at          timestamptz not null default now(),
  unique (clinical_staff_id, notified_on)
);

comment on table public.clinical_staff_indemnity_lapse_notifications is
  'Dedup + audit trail for private.notify_clinical_staff_indemnity_lapses(): one row per clinical_staff record per calendar day it is found active, requiring indemnity, unexempted, and expiring within 30 days or already expired.';

alter table public.clinical_staff_indemnity_lapse_notifications enable row level security;

create policy clinical_staff_indemnity_lapse_notifications_select
  on public.clinical_staff_indemnity_lapse_notifications
  for select to authenticated
  using (private.is_org_staff((select organisation_id from public.clinical_staff where id = clinical_staff_id)));

grant select on public.clinical_staff_indemnity_lapse_notifications to authenticated;

create or replace function private.notify_clinical_staff_indemnity_lapses()
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
    select cs.id, cs.organisation_id, cs.full_name, cs.doctor_tier, cs.is_clinical_director, cs.indemnity_expires_at
    from public.clinical_staff cs
    where cs.active
      and (cs.is_clinical_director or cs.doctor_tier in ('tier_4_senior_registrar', 'tier_5_partner_specialist'))
      and not cs.indemnity_exempt
      and not exists (
        select 1 from public.clinical_staff_indemnity_exemptions e
        where e.organisation_id = cs.organisation_id
          and (
            (e.doctor_tier is null and not e.applies_to_director)
            or e.doctor_tier = cs.doctor_tier
            or (e.applies_to_director and cs.is_clinical_director)
          )
      )
      and (cs.indemnity_expires_at is null or cs.indemnity_expires_at < now() + interval '30 days')
  loop
    v_already_expired := r.indemnity_expires_at is null or r.indemnity_expires_at <= now();

    insert into public.clinical_staff_indemnity_lapse_notifications (clinical_staff_id, already_expired)
    values (r.id, v_already_expired)
    on conflict (clinical_staff_id, notified_on) do nothing;

    if not found then
      continue;
    end if;

    v_message := case
      when r.indemnity_expires_at is null then
        format('%s has no indemnity cover on file and no exemption -- this should not be able to happen for an active record; check clinical_staff.id=%s.', r.full_name, r.id)
      when v_already_expired then
        format('%s''s indemnity cover expired on %s and no exemption is on file. Renew cover or record an exemption.', r.full_name, to_char(r.indemnity_expires_at, 'YYYY-MM-DD'))
      else
        format('%s''s indemnity cover expires on %s (within 30 days) and no exemption is on file. Renew cover before it lapses.', r.full_name, to_char(r.indemnity_expires_at, 'YYYY-MM-DD'))
    end;

    for v_admin in select id from public.profiles where role = 'admin'
    loop
      insert into public.notifications (recipient_id, organisation_id, channel, template, payload, status, content_class)
      values (v_admin.id, r.organisation_id, 'in_app', 'clinical_staff_indemnity_lapse',
        jsonb_build_object('message', v_message, 'clinical_staff_id', r.id, 'already_expired', v_already_expired),
        'pending', 'non_clinical');
    end loop;

    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'clinical_staff.indemnity_lapse_flagged', 'clinical_staff', r.id,
      jsonb_build_object('already_expired', v_already_expired, 'indemnity_expires_at', r.indemnity_expires_at,
        'is_clinical_director', r.is_clinical_director, 'doctor_tier', r.doctor_tier));
  end loop;
end;
$$;

comment on function private.notify_clinical_staff_indemnity_lapses() is
  'Notify-only sweep (never deactivates): flags an active Director/Tier 4/5 clinical_staff record whose indemnity is expired or expiring within 30 days and carries no individual or org/tier/director exemption. Deduplicated to once per record per calendar day, always audit-logged.';

revoke all on function private.notify_clinical_staff_indemnity_lapses() from public, anon;

select cron.schedule(
  'clinical-staff-indemnity-lapse-notify',
  '0 6 * * *',
  $$select private.notify_clinical_staff_indemnity_lapses()$$
);

do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'clinical_staff_indemnity_lapse_notifications'
  ) then
    raise exception 'clinical_staff_indemnity_lapse_notifications was not created';
  end if;

  if not exists (select 1 from cron.job where jobname = 'clinical-staff-indemnity-lapse-notify') then
    raise exception 'clinical-staff-indemnity-lapse-notify cron job was not scheduled';
  end if;

  if has_function_privilege('anon', 'private.notify_clinical_staff_indemnity_lapses()', 'EXECUTE') then
    raise exception 'FAIL: anon can execute private.notify_clinical_staff_indemnity_lapses';
  end if;

  raise notice 'PASS: indemnity lapse notification table + function + cron job all present, anon denied';
end $$;

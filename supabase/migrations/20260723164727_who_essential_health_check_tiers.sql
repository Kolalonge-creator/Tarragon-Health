-- WHO-essential health-check tiers + retest cadence + doctor debrief.
-- Founder-directed 2026-07-23: the self-bookable set extends ONLY along WHO
-- recommendations relevant to Nigeria's disease burden — NOT a general
-- wellness catalogue (that stays deferred/guardrailed):
--   * Health Check packages (India Apollo/1mg tier-ladder pattern):
--     Basic (cardiometabolic, WHO PEN), Standard (existing annual_health_check),
--     Comprehensive (adds HIV + Hepatitis B, both WHO priorities; Nigeria HBV
--     prevalence ~8%).
--   * Confidential single screenings, self-bookable any time: cervical smear
--     (WHO 90-70-90 cervical-cancer elimination), HIV (WHO universal
--     status-awareness), Hepatitis B. These are also the privacy-sensitive
--     tests where self-service access genuinely matters.
--   * PSA deliberately NOT self-bookable standalone — WHO does not recommend
--     population PSA screening; it stays inside doctor-reviewed packages.
-- PACKAGE PRICES ARE PLACEHOLDERS for the founder to confirm.

insert into public.panel_bundles (code, name, description, price_kobo, test_codes, self_bookable)
values
  ('health_check_basic', 'Health Check — Basic',
     'Cardiometabolic essentials (WHO PEN): HbA1c and full lipid panel, plus BP and BMI at the lab. Doctor-reviewed.',
     1500000, array['hba1c', 'lipid_panel'], true),
  ('health_check_comprehensive', 'Health Check — Comprehensive',
     'Everything in the Annual Health Check plus HIV and Hepatitis B screening. Doctor-reviewed.',
     7500000, array['hba1c', 'lipid_panel', 'psa', 'cervical_smear', 'hiv', 'hep_b'], true)
on conflict (code) do nothing;

update public.panel_bundles
  set self_bookable = true
  where code in ('single_cervical_smear', 'single_hiv', 'single_hep_b');

-- ---------------------------------------------------------------------------
-- Doctor debrief: when a self-booked health check (or confidential screening)
-- results, raise a clinician_review alert so a doctor reviews and contacts
-- the patient — including for all-clear results ("confirmation all is well"
-- is part of the product). Abnormal results separately flow the existing
-- Cat 2->1 escalation pipeline untouched; this is the debrief layer.
-- ---------------------------------------------------------------------------
create or replace function private.handle_health_check_resulted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'resulted' and old.status is distinct from 'resulted'
     and new.origin = 'patient_initiated'
     and exists (
       select 1 from public.panel_bundles pb
       where pb.id = new.panel_bundle_id and pb.self_bookable
     )
  then
    insert into public.clinician_alerts
      (organisation_id, patient_id, level, status, title, detail, escalation_level)
    values (
      new.organisation_id,
      new.patient_id,
      'clinician_review',
      'open',
      'Health check results ready — review and debrief the patient',
      format('Self-booked health check order %s has results. Review them and contact the patient to talk them through — every check includes a doctor debrief, including all-clear results.', new.order_number),
      2
    );
  end if;
  return new;
end;
$$;

drop trigger if exists lab_orders_health_check_resulted on public.lab_orders;
create trigger lab_orders_health_check_resulted
  before update on public.lab_orders
  for each row execute function private.handle_health_check_resulted();

-- ---------------------------------------------------------------------------
-- Retest cadence: yearly rebook reminder for self-booked checks (the
-- category's strongest retention mechanic — Function/Thriva/Neko all build
-- around it). Daily cron, mirrors queue_vaccination_reminders. One reminder
-- per patient per 60 days; suppressed while a newer check exists.
-- WhatsApp template 'health_check_rebook_due' needs Meta approval — falls
-- back to SMS via the existing send-pending-notifications machinery.
-- ---------------------------------------------------------------------------
create or replace function private.queue_health_check_rebook_reminders()
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
  select
    latest.organisation_id,
    latest.patient_id,
    'whatsapp',
    'pending',
    'health_check_rebook_due',
    jsonb_build_object('bundle_name', latest.bundle_name, 'last_check_date', latest.resulted_on)
  from (
    select distinct on (o.patient_id)
      o.patient_id, o.organisation_id, pb.name as bundle_name, o.created_at::date as resulted_on
    from public.lab_orders o
    join public.panel_bundles pb on pb.id = o.panel_bundle_id
    where pb.self_bookable and o.status = 'resulted' and o.origin = 'patient_initiated'
    order by o.patient_id, o.created_at desc
  ) latest
  where latest.resulted_on < (current_date - interval '11 months')
    and not exists (
      select 1
      from public.lab_orders o2
      join public.panel_bundles b2 on b2.id = o2.panel_bundle_id
      where o2.patient_id = latest.patient_id
        and b2.self_bookable
        and o2.created_at::date > latest.resulted_on
        and o2.status <> 'cancelled'
    )
    and not exists (
      select 1 from public.notifications n
      where n.recipient_id = latest.patient_id
        and n.template = 'health_check_rebook_due'
        and n.created_at > now() - interval '60 days'
    );
$$;

select cron.schedule(
  'health-check-rebook-daily',
  '35 6 * * *',
  $$select private.queue_health_check_rebook_reminders();$$
);

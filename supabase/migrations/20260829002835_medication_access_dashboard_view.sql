-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 7/7.
--
-- §21.15/§21.16: the clinical team dashboard, and its acceptance criterion —
-- the system must answer "why isn't this patient taking the medicine?", not
-- merely report a percentage. Every input here already exists from parts
-- 1-4 (access_status, adherence_status/adherence_pct_30d, the latest
-- affordability check-in's barrier, an open side-effect report, an open
-- doctor-level entry on the missed-dose ladder, and the last recorded
-- collection/receipt date) — this view is purely a read model joining them,
-- same shape and same security posture (security_invoker) as
-- public.patient_care_gaps (20260716150000).

create view public.medication_access_dashboard_v
with (security_invoker = true) as
select
  m.id as medication_id,
  m.organisation_id,
  m.patient_id,
  pr.full_name as patient_name,
  m.drug_name,
  cp.condition as care_plan_condition,
  m.clinical_status,
  m.access_status,
  m.adherence_status,
  m.adherence_pct_30d,
  latest_checkin.barrier as main_barrier,
  latest_checkin.created_at as main_barrier_reported_at,
  greatest(last_dispense.dispensed_on, last_receipt.received_at) as last_refill_date,
  case
    when m.access_status = 'too_expensive' then 'Affordability intervention'
    when m.access_status = 'out_of_stock' then 'Suggest alternative pharmacy'
    when m.access_status = 'awaiting_payment' then 'Follow up on payment'
    when m.access_status = 'awaiting_delivery' then 'Confirm delivery'
    when m.access_status = 'unable_to_collect' then 'Care coordinator outreach'
    when m.adherence_status in ('not_taking', 'frequently_missed') and open_side_effect.id is not null
      then 'Clinical review (side effects reported)'
    when m.adherence_status in ('not_taking', 'frequently_missed') and open_doctor_alert.id is not null
      then 'Doctor review (missed-dose ladder)'
    when m.adherence_status in ('not_taking', 'frequently_missed') and latest_checkin.barrier = 'forgot'
      then 'Send reminder'
    when m.adherence_status in ('not_taking', 'frequently_missed') then 'Care coordinator outreach'
    else 'None — on track'
  end as next_action
from public.medications m
join public.profiles pr on pr.id = m.patient_id
left join public.care_plans cp on cp.id = m.care_plan_id
left join lateral (
  select c.barrier, c.created_at
  from public.medication_access_checkins c
  where c.medication_id = m.id
  order by c.created_at desc
  limit 1
) latest_checkin on true
left join lateral (
  select max(d.dispensed_on) as dispensed_on
  from public.pharmacy_order_dispenses d
  where d.medication_id = m.id
) last_dispense on true
left join lateral (
  select max(r.received_at::date) as received_at
  from public.medication_receipt_confirmations r
  where r.medication_id = m.id
) last_receipt on true
left join lateral (
  select s.id
  from public.medication_side_effect_reports s
  where s.medication_id = m.id and s.reported_at > now() - interval '30 days'
  order by s.reported_at desc
  limit 1
) open_side_effect on true
left join lateral (
  select a.id
  from public.medication_adherence_alerts a
  where a.medication_id = m.id and a.level = 'doctor' and a.status <> 'resolved'
  limit 1
) open_doctor_alert on true
where m.is_active;

comment on view public.medication_access_dashboard_v is
  'Module 21 §21.15/§21.16 clinical-team dashboard read model: per active medication, current access/adherence status, the last-reported barrier, last collection/receipt date, and a computed next_action that answers "why isn''t this patient taking the medicine" rather than a bare percentage. Derived, RLS-respecting (security_invoker) view — no independent access control of its own; relies entirely on medications/medication_access_checkins/medication_side_effect_reports/medication_adherence_alerts RLS being evaluated as the querying user, same pattern as public.patient_care_gaps.';

grant select on public.medication_access_dashboard_v to authenticated;

do $$
begin
  if not exists (select 1 from information_schema.views where table_schema = 'public' and table_name = 'medication_access_dashboard_v') then
    raise exception 'medication_access_dashboard_v view was not created';
  end if;
  raise notice 'PASS: medication_access_dashboard_v installed';
end $$;

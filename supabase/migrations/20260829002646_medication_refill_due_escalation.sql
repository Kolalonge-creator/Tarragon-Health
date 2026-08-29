-- Tarragon Health — Module 21: Medication Access & Adherence Engine, part 4/7.
--
-- §21.7/§21.8 refill workflow + failure ladder: reminder -> second reminder
-- -> reason requested -> access intervention -> care coordinator. The first
-- reminder already exists (private.queue_medication_refill_reminders,
-- 20260706024722, untouched here). This adds the rest of the ladder for a
-- refill_date that has actually lapsed, reusing medication_refill_state
-- (same table the first reminder already upserts) rather than a parallel
-- table.
--
-- The last rung — "access intervention -> care coordinator" — is exactly the
-- alert_rules 'refill_due' type_code's own evidence_basis: "reserved... no
-- staff-facing generator yet" (20260828013011). This is that generator, and
-- since alert_rules already routes refill_due to owner_tier=care_coordinator,
-- no new alert-system plumbing is needed — private.raise_clinician_alert()
-- does the rest via the existing classify-and-assign trigger.
--
-- Deliberately does not touch private.queue_medication_refill_reminders()
-- itself (the pre-due lead-time reminder) — that function already goes
-- silent once refill_date lapses ("a clinician/patient updating refill_date
-- is what re-arms reminders"), which is precisely the boundary this new
-- function picks up from.

alter table public.medication_refill_state
  add column second_reminder_sent_at timestamptz,
  add column reason_requested_at timestamptz,
  add column access_intervention_raised_at timestamptz;

comment on column public.medication_refill_state.second_reminder_sent_at is 'Module 21 §21.8 ladder, rung 2.';
comment on column public.medication_refill_state.reason_requested_at is 'Module 21 §21.8 ladder, rung 3 — "why haven''t you refilled?" prompt sent.';
comment on column public.medication_refill_state.access_intervention_raised_at is 'Module 21 §21.8 ladder, rung 4/5 — a clinician_alerts row (type_code=refill_due) was raised and routed to the governed owner_tier (care_coordinator).';

-- ---------------------------------------------------------------------------
-- private.escalate_overdue_medication_refills() — daily sweep
-- ---------------------------------------------------------------------------

create or replace function private.escalate_overdue_medication_refills()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select
      m.id as medication_id, m.patient_id, m.organisation_id, m.drug_name, m.refill_date,
      s.second_reminder_sent_at, s.reason_requested_at, s.access_intervention_raised_at
    from public.medications m
    left join public.medication_refill_state s on s.medication_id = m.id
    where m.is_active
      and m.refill_date is not null
      and m.refill_date < current_date
      -- A fresh collection/receipt since the missed refill_date means the
      -- patient already sorted it out; go quiet until the next refill_date.
      and not exists (
        select 1 from public.pharmacy_order_dispenses d
        where d.medication_id = m.id and d.dispensed_on >= m.refill_date
      )
      and not exists (
        select 1 from public.medication_receipt_confirmations rc
        where rc.medication_id = m.id and rc.received_at::date >= m.refill_date
      )
  loop
    if r.access_intervention_raised_at is not null then
      continue; -- already escalated for this refill_date; wait for it to be resolved or re-armed by a new date
    end if;

    if r.reason_requested_at is not null and current_date - r.reason_requested_at::date >= 3 then
      perform private.raise_clinician_alert(
        r.organisation_id, r.patient_id, 'clinician_review',
        format('Refill overdue: %s', r.drug_name),
        format(
          'Refill for %s was due %s and remains overdue after two reminders and a request for the reason, with no resolution recorded.',
          r.drug_name, to_char(r.refill_date, 'YYYY-MM-DD')
        ),
        'medication', 'refill_due'
      );
      insert into public.medication_refill_state
        (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at, access_intervention_raised_at)
      values (r.medication_id, r.patient_id, r.organisation_id, r.refill_date, now(), now())
      on conflict (medication_id) do update set access_intervention_raised_at = now(), updated_at = now();

    elsif r.reason_requested_at is null and current_date - r.refill_date >= 7 then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'medication_refill_reason_request',
          jsonb_build_object('medication_id', r.medication_id, 'drug_name', r.drug_name)),
        (r.organisation_id, r.patient_id, 'in_app', 'pending', 'medication_refill_reason_request',
          jsonb_build_object('medication_id', r.medication_id, 'drug_name', r.drug_name));
      insert into public.medication_refill_state
        (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at, reason_requested_at)
      values (r.medication_id, r.patient_id, r.organisation_id, r.refill_date, now(), now())
      on conflict (medication_id) do update set reason_requested_at = now(), updated_at = now();

    elsif r.second_reminder_sent_at is null and current_date - r.refill_date >= 3 then
      insert into public.notifications (organisation_id, recipient_id, channel, status, template, payload)
      values
        (r.organisation_id, r.patient_id, 'whatsapp', 'pending', 'medication_refill_reminder_second',
          jsonb_build_object('medication_id', r.medication_id, 'drug_name', r.drug_name)),
        (r.organisation_id, r.patient_id, 'in_app', 'pending', 'medication_refill_reminder_second',
          jsonb_build_object('medication_id', r.medication_id, 'drug_name', r.drug_name));
      insert into public.medication_refill_state
        (medication_id, patient_id, organisation_id, reminded_for_refill_date, reminder_sent_at, second_reminder_sent_at)
      values (r.medication_id, r.patient_id, r.organisation_id, r.refill_date, now(), now())
      on conflict (medication_id) do update set second_reminder_sent_at = now(), updated_at = now();
    end if;
  end loop;
end;
$$;

comment on function private.escalate_overdue_medication_refills() is
  'Daily sweep, §21.8: a lapsed refill_date with no new collection/receipt climbs reminder -> second reminder (3d) -> reason requested (7d) -> access intervention raised as a clinician_alerts row (10d, type_code=refill_due, auto-routed to care_coordinator). Both channels of every step dual-insert whatsapp+in_app per the existing guaranteed-in-app pattern (20260730224249) — WhatsApp template approval is still pending per CLAUDE.md, so in_app is the only channel guaranteed to be seen.';

revoke all on function private.escalate_overdue_medication_refills() from public, anon;

select cron.schedule(
  'medication-refill-overdue-escalation-daily',
  '20 6 * * *',
  $$select private.escalate_overdue_medication_refills();$$
);

-- ---------------------------------------------------------------------------
-- Reset the ladder once refill_date moves — a new date is a new cycle, not a
-- continuation of the old one's escalation state.
-- ---------------------------------------------------------------------------

create or replace function private.reset_medication_refill_escalation_on_new_date()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.refill_date is distinct from old.refill_date then
    update public.medication_refill_state
      set second_reminder_sent_at = null,
          reason_requested_at = null,
          access_intervention_raised_at = null,
          updated_at = now()
      where medication_id = new.id;
  end if;
  return new;
end;
$$;

create trigger medications_reset_refill_escalation
  after update of refill_date on public.medications
  for each row execute function private.reset_medication_refill_escalation_on_new_date();

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'medication_refill_state' and column_name = 'access_intervention_raised_at') then
    raise exception 'medication_refill_state.access_intervention_raised_at was not added';
  end if;
  if not exists (select 1 from cron.job where jobname = 'medication-refill-overdue-escalation-daily') then
    raise exception 'medication-refill-overdue-escalation-daily cron job was not scheduled';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgname = 'medications_reset_refill_escalation' and tgrelid = 'public.medications'::regclass and not tgisinternal
  ) then
    raise exception 'medications_reset_refill_escalation trigger was not created';
  end if;
  raise notice 'PASS: medication refill-due escalation ladder installed (fills alert_rules'' reserved refill_due generator slot)';
end $$;

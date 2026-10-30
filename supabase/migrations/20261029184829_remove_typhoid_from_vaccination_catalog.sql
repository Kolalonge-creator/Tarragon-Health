-- Founder decision 2026-10-07 ("typhoid is not in the schedule", recorded in vaccination schedule v2) was never applied to the
-- catalogue, which the status engine and the reminders read. Founder/CMO instruction 2026-10-29: remove it.
-- Deactivated, not deleted, in the same way covid_19 was: a catalogue row keeps any record that points at it, and
-- 0 schedules and 0 records referenced typhoid when this was applied, so nothing needs cancelling.
update public.vaccination_catalog set is_active = false where code = 'typhoid';

do $$
begin
  if exists (select 1 from public.vaccination_catalog where code = 'typhoid' and is_active) then
    raise exception 'typhoid must be inactive';
  end if;
  if exists (select 1 from public.vaccination_schedules s join public.vaccination_catalog c on c.id = s.vaccination_catalog_id
              where c.code = 'typhoid' and s.status in ('pending', 'booked', 'overdue')) then
    raise exception 'typhoid still has active schedules; cancel them first';
  end if;
end $$;

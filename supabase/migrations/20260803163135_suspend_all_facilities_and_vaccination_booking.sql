-- Suspend every remaining facility, including hospitals and vaccination centres.
--
-- Founder correction to 20260803160537: that migration suspended only labs and
-- deliberately kept hospital/vaccination_centre active because vaccination
-- booking is a live pathway. Founder decision 2026-08-03: suspend everything,
-- including vaccination booking. All partner-dependent surfaces stay dormant
-- until a partner is actually contracted, with no carve-out.
--
-- Row counts before this migration: hospital 2 active, vaccination_centre 2
-- active, lab 0 active (already suspended). This closes the gap to 0 active
-- across every facility type.

update public.facilities
set is_active = false
where is_active;

do $$
declare
  v_active integer;
begin
  select count(*) into v_active from public.facilities where is_active;
  if v_active <> 0 then
    raise exception '% facility row(s) are still active after suspending all types', v_active;
  end if;
end $$;

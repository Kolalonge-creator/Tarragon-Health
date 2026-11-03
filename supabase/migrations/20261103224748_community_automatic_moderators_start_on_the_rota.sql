-- Community rota: every staff member who moderates automatically starts on the rota (founder, 2026-11-03).
--
-- Live on 2026-11-03: five real staff held an automatic moderator grant (two of them doctors, so also safety reviewers) but
-- community_shifts was EMPTY, so community_coverage() reported all 168 weekly hours uncovered for both scopes and the community
-- go-live check could not pass. Grants and shifts were two separate steps; only the grant was automatic.
--
-- This makes the starting rota automatic too: an automatic grant (source = 'automatic', all-groups) is seeded with a shift on
-- every weekday, 00:00 to 24:00, Lagos time as everywhere in this module. That is a starting point, not a staffing plan: an
-- admin or the CMO replaces it per person with community_admin_set_shifts, and a person who already has any shift row is never
-- touched again (a later edit, even to fewer hours, is not undone). A grant an admin made by hand is not seeded, and a
-- withdrawn grant (revoked_at set) never counts toward coverage, so withdrawing still removes the person from the rota.
--
-- Changes no function body, no RLS and no grant. community_uncovered_hours / community_coverage are untouched.

create or replace function private.community_seed_default_shifts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.source = 'automatic' and new.group_id is null and new.revoked_at is null
     and not exists (select 1 from public.community_shifts sh where sh.staff_id = new.id) then
    insert into public.community_shifts (staff_id, weekday, start_hour, end_hour)
    select new.id, d, 0, 24 from generate_series(0, 6) d;
  end if;
  return new;
end $$;

revoke all on function private.community_seed_default_shifts() from public, anon, authenticated, service_role;

drop trigger if exists community_seed_default_shifts on public.community_staff;
create trigger community_seed_default_shifts
  after insert on public.community_staff
  for each row execute function private.community_seed_default_shifts();

-- Backfill: grants that exist today and have no shift at all.
insert into public.community_shifts (staff_id, weekday, start_hour, end_hour)
select s.id, d, 0, 24
  from public.community_staff s, generate_series(0, 6) d
 where s.source = 'automatic' and s.group_id is null and s.revoked_at is null
   and not exists (select 1 from public.community_shifts sh where sh.staff_id = s.id);

do $$
declare v_mod integer; v_safe integer; v_auto integer; v_unseeded integer;
begin
  select count(*) into v_unseeded
    from public.community_staff s
   where s.source = 'automatic' and s.group_id is null and s.revoked_at is null
     and not exists (select 1 from public.community_shifts sh where sh.staff_id = s.id);
  if v_unseeded <> 0 then raise exception 'FAIL: % automatic grants still have no shift', v_unseeded; end if;
  select count(*) into v_auto from public.community_staff where source = 'automatic' and group_id is null and revoked_at is null;
  v_mod := private.community_uncovered_hours('moderator');
  v_safe := private.community_uncovered_hours('safety_reviewer');
  raise notice 'community rota seeded: % automatic grants, uncovered hours moderator=% safety=%', v_auto, v_mod, v_safe;
end $$;

-- Opening the account of someone you support, and never being mistaken for them.
--
-- Founder decision, 2026-08-01: a supporter with a 'manage' grant may open the
-- account of the person they support and act in it, and **every action they
-- take is stamped with their own name and shown to that person**. The second
-- half is what makes the first half safe. A record that cannot distinguish
-- "my mother logged this" from "my son logged this for her" is a worse record
-- than one nobody can write to, because the clinical engines and the care team
-- both read it as the patient's own account of themselves.
--
-- HOW THIS IS BUILT, and the thing not to redesign later:
--
-- Acting for someone is NOT impersonation. auth.uid() is always the supporter,
-- never the person supported — every RLS policy on this platform is built on
-- that, and a session that lied about who was calling would undermine all of
-- them at once. What changes is only which patient_id the app is pointed at,
-- and the grant is re-checked on the server every time. The chosen person is a
-- hint held in a cookie; the profile_access row is the authority. Revoking the
-- grant ends the access immediately, with nothing to clean up.

-- 1. May I act for this person, right now? -------------------------------------
create or replace function private.can_act_for(p_beneficiary uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select exists (
    select 1 from public.profile_access pa
     where pa.profile_id = p_beneficiary
       and pa.grantee_user_id = (select auth.uid())
       and pa.permission_level = 'manage'
  );
$$;

revoke all on function private.can_act_for(uuid) from public;
-- An RLS policy runs as the calling role, so the role the policy applies to
-- must be able to execute the helper the policy calls. Same as is_org_staff
-- and can_read_clinical. Without this the policy fails closed with
-- 'permission denied for function', which reads like a data problem and is
-- not one.
grant execute on function private.can_act_for(uuid) to authenticated;

-- The app needs to ask the same question the policies ask, so that opening
-- somebody's account and being allowed to write in it can never disagree.
create or replace function public.can_act_for(p_beneficiary uuid)
returns boolean
language sql
stable
security definer
set search_path to ''
as $$
  select private.can_act_for(p_beneficiary);
$$;

revoke all on function public.can_act_for(uuid) from public;
grant execute on function public.can_act_for(uuid) to authenticated;

-- 2. Who actually did it -------------------------------------------------------
-- NULL means the person themselves, which is every row that existed before
-- this. Set means somebody acted for them, and the patient sees the name.
alter table public.vitals_readings
  add column if not exists logged_by_profile_id uuid references public.profiles(id);

alter table public.symptoms
  add column if not exists logged_by_profile_id uuid references public.profiles(id);

comment on column public.vitals_readings.logged_by_profile_id is
  'Who physically entered this, when that is not the patient. NULL = the patient themselves. Server-derived from auth.uid() by private.stamp_acting_supporter and NOT client-supplied, so a reading can never be passed off as the patient''s own account of themselves.';

-- Forge-proof: the value is taken from auth.uid(), never from the row the
-- client sent, and it is cleared when the patient is genuinely writing their
-- own record. A client that supplies a false name simply has it overwritten.
create or replace function private.stamp_acting_supporter()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
begin
  if new.patient_id is distinct from (select auth.uid()) then
    new.logged_by_profile_id := (select auth.uid());
  else
    new.logged_by_profile_id := null;
  end if;
  return new;
end;
$$;

drop trigger if exists stamp_acting_supporter on public.vitals_readings;
create trigger stamp_acting_supporter
  before insert on public.vitals_readings
  for each row execute function private.stamp_acting_supporter();

drop trigger if exists stamp_acting_supporter on public.symptoms;
create trigger stamp_acting_supporter
  before insert on public.symptoms
  for each row execute function private.stamp_acting_supporter();

-- 3. Let a supporter actually write those two -----------------------------------
-- Additive policies. Nothing existing is touched, and this is deliberately
-- narrow: logging a reading or a symptom is the errand a family member
-- genuinely runs for an elderly parent. It is not a general write grant over
-- the record — medications, care plans, results and everything a clinician
-- authors stay exactly as they were.
drop policy if exists vitals_readings_insert_acting_supporter on public.vitals_readings;
create policy vitals_readings_insert_acting_supporter on public.vitals_readings
  for insert to authenticated
  with check (private.can_act_for(patient_id));

drop policy if exists symptoms_insert_acting_supporter on public.symptoms;
create policy symptoms_insert_acting_supporter on public.symptoms
  for insert to authenticated
  with check (private.can_act_for(patient_id));

-- Deliberately NO update or delete policy. A supporter may add to the record
-- and may never revise or remove what is already in it, including their own
-- earlier entries: correcting a reading is a conversation with the care team,
-- not something to be done quietly from another country.

-- 4. The person supported can see it happened ----------------------------------
-- Attribution lives on the reading itself rather than as a separate feed
-- entry, deliberately. "Logged by Tunde" attached to the 156/96 is what a
-- patient (or their doctor) needs at the moment they are looking at that
-- number; an event in a timeline is one click away from the thing it
-- describes and easy to scroll past. The name is resolved through the existing
-- profiles_select_my_grantees policy, which already lets somebody read the
-- name of a person they granted access to.

do $$
begin
  if not exists (select 1 from pg_policies
                  where schemaname='public' and tablename='vitals_readings'
                    and policyname='vitals_readings_insert_acting_supporter') then
    raise exception 'a supporter cannot log a reading for the person they support';
  end if;
  -- The guarantee that makes acting-for safe: no path lets a supporter change
  -- or remove what is already recorded.
  if exists (select 1 from pg_policies
              where schemaname='public' and tablename in ('vitals_readings','symptoms')
                and cmd in ('UPDATE','DELETE')
                and qual::text like '%can_act_for%') then
    raise exception 'a supporter must never be able to revise or delete the record';
  end if;
end $$;

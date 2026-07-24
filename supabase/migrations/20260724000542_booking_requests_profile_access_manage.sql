-- Child immunization card: a parent needs to book a vaccination
-- appointment on their child's behalf, the same way the
-- 20260723200847_child_immunisation_nphcda migration already extended
-- vaccination_records/vaccination_schedules RLS for a profile_access
-- 'manage' grantee. booking_requests was the one remaining table in that
-- flow still gated to profile_id = auth.uid() only.

drop policy if exists booking_requests_select on public.booking_requests;
create policy booking_requests_select on public.booking_requests
  for select to authenticated
  using (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = booking_requests.profile_id
        and pa.grantee_user_id = (select auth.uid())
    )
  );

drop policy if exists booking_requests_insert on public.booking_requests;
create policy booking_requests_insert on public.booking_requests
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    or private.is_org_staff(organisation_id)
    or exists (
      select 1 from public.profile_access pa
      where pa.profile_id = booking_requests.profile_id
        and pa.grantee_user_id = (select auth.uid())
        and pa.permission_level = 'manage'
    )
  );

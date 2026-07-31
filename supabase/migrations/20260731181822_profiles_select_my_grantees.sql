-- A patient can see who they have given access to.
--
-- profiles_select is asymmetric today: a grantee may read the profile of the
-- person who granted to them, but not the reverse. That was fine while the only
-- surface was the grantee's own dashboard. It is not fine now that the patient
-- is the one deciding, per person, who may read their health information — the
-- founder's instruction is that they do it "by just clicking on the sponsor
-- name", and without this the screen has no name to click.
--
-- A separate permissive policy rather than an edit to profiles_select, which
-- carries live assertion checks over its exact clauses (20260729194127).
-- Multiple PERMISSIVE policies OR together, so this adds a case and changes
-- none of the existing ones. Bounded to people who genuinely hold a grant on
-- the caller's own record: it is not a directory.
create policy profiles_select_my_grantees on public.profiles
  for select to authenticated
  using (
    exists (
      select 1 from public.profile_access pa
      where pa.grantee_user_id = profiles.id
        and pa.profile_id = (select auth.uid())
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and policyname = 'profiles_select_my_grantees' and permissive = 'PERMISSIVE'
  ) then
    raise exception 'profiles_select_my_grantees missing or not permissive';
  end if;

  -- The policy this deliberately did not touch must still be intact.
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles_select'
  ) then
    raise exception 'profiles_select was removed — it must be left alone';
  end if;
end $$;

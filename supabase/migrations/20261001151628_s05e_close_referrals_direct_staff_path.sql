-- S05e part 2 of 2: close the direct staff path on specialist_referrals (INV-10, INV-12). Apply only after the code that uses the S05e
-- functions has deployed.
--
-- Counted first (live): 0 rows. After the deploy the application has no staff `.from("specialist_referrals")` left; the patient-side
-- readers (your referrals, the letter, the fertility flows' reads) read the patient's own rows and keep their policy; the service-role
-- writers (patient outcome upload, fertility insert, the abnormal-result edge function) bypass RLS.
-- SELECT narrows to the patient (as before for patients, including her own drafts); the staff INSERT, UPDATE and DELETE policies go,
-- because every staff write is now one of the S05e functions (an UPDATE needs a readable row anyway). RLS stays on.

drop policy if exists specialist_referrals_select on public.specialist_referrals;
create policy specialist_referrals_select on public.specialist_referrals
  for select to authenticated
  using (patient_id = (select auth.uid()));

drop policy if exists specialist_referrals_insert on public.specialist_referrals;
drop policy if exists specialist_referrals_update on public.specialist_referrals;
drop policy if exists specialist_referrals_delete on public.specialist_referrals;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'specialist_referrals'
               and (qual ilike '%is_org_staff%' or with_check ilike '%is_org_staff%')) then
    raise exception 'S05e assertion: an org-staff policy remains on specialist_referrals';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'specialist_referrals') <> 1 then
    raise exception 'S05e assertion: expected exactly the patient SELECT policy on specialist_referrals';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.specialist_referrals'::regclass) then
    raise exception 'S05e assertion: RLS is off on specialist_referrals';
  end if;
end $$;

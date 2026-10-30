-- Adds Community and the blood pressure Learn course to the closed list of features a patient can ask to hear about
-- (20261029233636_feature_waitlist.sql). Only the check constraint changes; no rows exist that could violate the wider list.

alter table public.feature_waitlist drop constraint feature_waitlist_feature_key_check;
alter table public.feature_waitlist add constraint feature_waitlist_feature_key_check
  check (feature_key in ('consultations', 'membership', 'directory', 'community', 'course'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.feature_waitlist'::regclass and conname = 'feature_waitlist_feature_key_check'
       and pg_get_constraintdef(oid) like '%community%' and pg_get_constraintdef(oid) like '%course%'
  ) then
    raise exception 'feature_waitlist_feature_key_check did not take the new features';
  end if;
end $$;

-- Tarragon Health — distinguishes a child dependant (no login, provisioned by
-- addChildDependentAction with a synthetic email and no password) from an
-- adult who holds a real account and has separately accepted a 'manage'
-- request under the eldercare flow (care_access_requests).
--
-- Both shapes produce an identical profile_access row (permission_level =
-- 'manage'), which is exactly the ambiguity useManagedDependents()/
-- DependantsList/the "whose vaccinations?" selector need resolved: those
-- surfaces are built and copy-written specifically for children too young to
-- hold an account ("Adults never appear here") and must not start silently
-- listing a caller's elderly parent as though they were a child dependant
-- once eldercare 'manage' grants exist.
alter table public.profiles
  add column if not exists is_dependent_account boolean not null default false;

update public.profiles p
set is_dependent_account = true
from auth.users u
where u.id = p.id
  and u.email like 'dependent+%@dependents.tarragonhealth.internal'
  and p.is_dependent_account = false;

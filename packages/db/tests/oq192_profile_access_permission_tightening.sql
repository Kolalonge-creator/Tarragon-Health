-- Proves 20261021101733_oq192_profile_access_permission_tightening.sql (OQ-192).
--
-- A grantee in profile_access must only do what the grant allows:
--   * vaccination writes need a manage grant that is unexpired AND the vaccinations category (or a dependent account);
--   * buying for someone needs manage_payments;
--   * an expired grant opens nothing.
-- Controls (a grantee WITH the permission still passes) sit next to every refusal. A sabotage step at the end puts the old
-- policy and the old function back and checks that the refusals flip, so the proof cannot pass vacuously.
-- Also a regression scan: no policy may read profile_access without an expiry/permission/category check, except the
-- three known-safe ones named below. A new bare reference fails this script.
--
-- Role switches are top-level statements (see acting_for_someone.sql for why).

begin;

create temp table results(check_name text, expected text, actual text) on commit drop;
create temp table ids(k text primary key, v uuid) on commit drop;
grant all on results to authenticated;
grant all on ids to authenticated;

do $$
declare
  r record;
  v_org uuid := '00000000-0000-0000-0000-000000000001';
  v_id uuid;
  v_cat uuid;
begin
  if not exists (select 1 from public.organisations where id = v_org) then
    insert into public.organisations (id, name, type) values (v_org, 'OQ192 Test Org', 'direct_consumer');
  end if;
  insert into ids values ('org', v_org);

  for r in select unnest(array['pat','gA','gB','gC','gD','gE','gF']) k loop
    v_id := gen_random_uuid();
    insert into ids values (r.k, v_id);
    insert into auth.users (id, email) values (v_id, format('oq192-%s@example.invalid', r.k));
    insert into public.profiles (id, organisation_id, role, full_name)
    values (v_id, v_org, 'patient'::public.user_role, 'OQ192 ' || r.k)
    on conflict (id) do update set organisation_id = excluded.organisation_id, role = excluded.role;
  end loop;

  insert into public.vaccination_catalog (code, name) values ('oq192-test', 'OQ192 test vaccine')
  returning id into v_cat;
  insert into ids values ('cat', v_cat);
end $$;

-- grants (as the patient, because the category owner guard demands it)
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'pat'), true);
do $$
declare
  pat uuid := (select v from ids where k = 'pat');
  g record;
  v_grant uuid;
begin
  for g in select * from (values
      ('gA', 'manage', null::timestamptz, null::text[], true),
      ('gB', 'manage', null, null, false),
      ('gC', 'manage', now() - interval '1 day', null, true),
      ('gD', 'view',   null, null, true),
      ('gE', 'manage', null, array['view_appointments'], false),
      ('gF', 'manage', null, array['manage_payments'], false)
    ) as t(k, lvl, exp, perms, cat)
  loop
    insert into public.profile_access (profile_id, grantee_user_id, permission_level, granted_by, expires_at, permissions)
    values (pat, (select v from ids where k = g.k), g.lvl::public.profile_access_level, pat,
            case when g.exp is null then null else now() + interval '1 day' end,
            g.perms::public.caregiver_permission[])
    returning id into v_grant;
    if g.exp is not null then
      -- a CHECK forbids inserting an already-expired grant; age it afterwards
      update public.profile_access set created_at = now() - interval '2 days', expires_at = g.exp where id = v_grant;
    end if;
    if g.cat then
      insert into public.profile_access_categories (profile_access_id, category)
      values (v_grant, 'vaccinations'::public.care_access_category);
    end if;
  end loop;

  insert into public.dependant_handovers (organisation_id, patient_id, birthday_18)
  values ((select v from ids where k = 'org'), pat, current_date + 10);
end $$;

-- ---- vaccination writes, as each grantee ------------------------------------
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gA'), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered, dose_number)
    values ((select v from ids where k = 'org'), (select v from ids where k = 'pat'), (select v from ids where k = 'cat'), current_date, 1);
    insert into results values ('control: manage + vaccinations category writes', 'ok', 'ok');
  exception when others then
    insert into results values ('control: manage + vaccinations category writes', 'ok', 'denied ' || sqlstate);
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gB'), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered, dose_number)
    values ((select v from ids where k = 'org'), (select v from ids where k = 'pat'), (select v from ids where k = 'cat'), current_date, 2);
    insert into results values ('manage without vaccinations category is refused', 'denied', 'ok');
  exception when others then
    insert into results values ('manage without vaccinations category is refused', 'denied', 'denied');
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gC'), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered, dose_number)
    values ((select v from ids where k = 'org'), (select v from ids where k = 'pat'), (select v from ids where k = 'cat'), current_date, 3);
    insert into results values ('expired manage grant is refused', 'denied', 'ok');
  exception when others then
    insert into results values ('expired manage grant is refused', 'denied', 'denied');
  end;
end $$;
reset role;

select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gD'), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered, dose_number)
    values ((select v from ids where k = 'org'), (select v from ids where k = 'pat'), (select v from ids where k = 'cat'), current_date, 4);
    insert into results values ('view-level grant is refused', 'denied', 'ok');
  exception when others then
    insert into results values ('view-level grant is refused', 'denied', 'denied');
  end;
end $$;
reset role;

-- ---- handover read: unexpired grantee sees it, expired does not --------------
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gA'), true);
set local role authenticated;
insert into results select 'control: unexpired grantee reads the handover', '1',
  (select count(*)::text from public.dependant_handovers);
reset role;
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gC'), true);
set local role authenticated;
insert into results select 'expired grantee does not read the handover', '0',
  (select count(*)::text from public.dependant_handovers);
reset role;

-- ---- buying: manage_payments needed -----------------------------------------
insert into results select 'control: manage_payments grantee may buy for the patient', 'true',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'gF'))::text;
insert into results select 'manage grantee without manage_payments may not buy', 'false',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'gE'))::text;
insert into results select 'view-level grantee may not buy', 'false',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'gD'))::text;
insert into results select 'expired grantee may not buy', 'false',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'gC'))::text;
insert into results select 'control: the patient buys for themselves', 'true',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'pat'))::text;

-- ---- regression scan: no new bare profile_access policy ---------------------
insert into results
select 'policy reads profile_access without an expiry/permission/category check: ' || tablename || '.' || policyname,
       'none', 'bare'
from pg_policies
where schemaname = 'public'
  and coalesce(qual,'') || coalesce(with_check,'') ilike '%profile_access%'
  and coalesce(qual,'') || coalesce(with_check,'') not ilike '%expires_at%'
  and coalesce(qual,'') || coalesce(with_check,'') not ilike '%can_act_for%'
  and coalesce(qual,'') || coalesce(with_check,'') not ilike '%can_read_clinical%'
  and coalesce(qual,'') || coalesce(with_check,'') not ilike '%profile_access_active%'
  and coalesce(qual,'') || coalesce(with_check,'') not ilike '%profile_access_categories pac%'
  and policyname not in (
    'profile_access_categories_select',      -- owner or the grantee reading their own grant rows
    'profiles_select_my_grantees',           -- the patient reading who they shared with
    'adolescent_confidentiality_waivers_insert'  -- the patient (not a grantee) writes; grantee must already exist
  );

-- ---- sabotage: put the old behaviour back, the refusals must flip -----------
create or replace function private.can_purchase_voucher_for(p_beneficiary uuid, p_purchaser uuid)
returns boolean language sql stable security definer set search_path to '' as $f$
  select p_beneficiary = p_purchaser
      or exists (select 1 from public.profile_access pa where pa.profile_id = p_beneficiary and pa.grantee_user_id = p_purchaser);
$f$;
insert into results select 'SABOTAGE: old voucher check lets a view-level grantee buy (this must flip)', 'true',
  private.can_purchase_voucher_for((select v from ids where k = 'pat'), (select v from ids where k = 'gD'))::text;

alter policy vaccination_records_insert on public.vaccination_records with check (
  (profile_id = (select auth.uid()))
  or (exists (select 1 from public.profile_access pa
              where pa.profile_id = vaccination_records.profile_id and pa.grantee_user_id = (select auth.uid())
                and pa.permission_level = 'manage'::public.profile_access_level)));
select set_config('request.jwt.claim.sub', (select v::text from ids where k = 'gB'), true);
set local role authenticated;
do $$
begin
  begin
    insert into public.vaccination_records (organisation_id, profile_id, vaccination_catalog_id, date_administered, dose_number)
    values ((select v from ids where k = 'org'), (select v from ids where k = 'pat'), (select v from ids where k = 'cat'), current_date, 5);
    insert into results values ('SABOTAGE: old policy lets a categoryless manage grantee write (this must flip)', 'ok', 'ok');
  exception when others then
    insert into results values ('SABOTAGE: old policy lets a categoryless manage grantee write (this must flip)', 'ok', 'denied ' || sqlerrm);
  end;
end $$;
reset role;

-- ---- verdict -----------------------------------------------------------------
do $$
declare bad int; flipped int;
begin
  select count(*) into flipped from results
   where check_name like 'SABOTAGE:%' and expected = actual;
  if flipped <> 2 then
    raise exception 'OQ-192 proof: sabotage did not reproduce the old hole (% of 2): %', flipped,
      (select string_agg(check_name || ' => ' || actual, '; ') from results where check_name like 'SABOTAGE:%');
  end if;
  select count(*) into bad from results
   where check_name not like 'SABOTAGE:%' and expected is distinct from actual;
  if bad > 0 then
    raise exception 'OQ-192 proof: % check(s) failed: %', bad,
      (select string_agg(check_name || ' expected ' || expected || ' got ' || actual, '; ')
         from results where check_name not like 'SABOTAGE:%' and expected is distinct from actual);
  end if;
end $$;

select check_name, expected, actual, (expected = actual) as pass from results order by 1;

rollback;

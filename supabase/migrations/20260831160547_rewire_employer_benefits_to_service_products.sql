-- Tarragon Health — Pay-per-service business model, Phase 1 (employer benefits)
--
-- private.sync_employer_subscription_from_roster() — the trigger that grants
-- an employer-sponsored plan when a roster member claims their benefit —
-- was found still writing subscriptions/reading employer_benefit_packages.
-- subscription_plan_id, a third real entitlement-granting writer to the
-- retiring tables (same class as claim_health_reset_trial and
-- activate_sponsored_subscription, both already rewired). Zero roster
-- members have ever claimed a benefit and zero benefit packages exist live
-- (confirmed before writing this), so this is a pure schema/logic repoint
-- with nothing to backfill.

alter table public.employer_benefit_packages
  rename column subscription_plan_id to service_product_id;
alter table public.employer_benefit_packages
  drop constraint if exists employer_benefit_packages_subscription_plan_id_fkey;
alter table public.employer_benefit_packages
  add constraint employer_benefit_packages_service_product_id_fkey
  foreign key (service_product_id) references public.service_products (id) on delete restrict;

alter table public.employer_roster_members
  drop constraint if exists employer_roster_members_granted_subscription_id_fkey;
alter table public.employer_roster_members
  add constraint employer_roster_members_granted_subscription_id_fkey
  foreign key (granted_subscription_id) references public.service_purchases (id) on delete set null;

create or replace function private.assert_benefit_package_org_matches()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if not exists (select 1 from public.service_products where id = new.service_product_id and is_active) then
    raise exception 'employer_benefit_packages.service_product_id must reference an active service';
  end if;
  return new;
end;
$function$;

create or replace function private.sync_employer_subscription_from_roster()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_package public.employer_benefit_packages;
  v_period_end timestamptz;
  v_purchase_id uuid;
begin
  if new.claimed_profile_id is null then
    return null;
  end if;

  if new.status in ('departed', 'removed')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    if new.granted_subscription_id is not null then
      update public.service_purchases
         set status = 'cancelled', cancelled_at = now()
       where id = new.granted_subscription_id
         and status = 'active';
    end if;
    return null;
  end if;

  if new.status <> 'claimed' then
    return null;
  end if;

  if new.benefit_package_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE'
     and old.status = 'claimed'
     and old.benefit_package_id is not distinct from new.benefit_package_id
     and old.claimed_profile_id is not distinct from new.claimed_profile_id
     and old.eligible_until is not distinct from new.eligible_until then
    return null;
  end if;

  select * into v_package from public.employer_benefit_packages where id = new.benefit_package_id and is_active;
  if v_package.id is null then
    return null;
  end if;

  v_period_end := case when new.eligible_until is not null
                       then new.eligible_until::timestamptz + interval '1 day'
                       else now() + interval '1 year' end;

  if new.granted_subscription_id is not null then
    update public.service_purchases
       set service_product_id = v_package.service_product_id,
           expires_at = v_period_end,
           status = 'active',
           cancelled_at = null
     where id = new.granted_subscription_id
       and patient_id = new.claimed_profile_id
     returning id into v_purchase_id;
  end if;

  if v_purchase_id is null then
    insert into public.service_purchases
      (organisation_id, patient_id, purchaser_profile_id, service_product_id, status,
       amount_kobo, currency, payment_provider, purchased_at, expires_at)
    values
      (new.organisation_id, new.claimed_profile_id, new.claimed_profile_id, v_package.service_product_id,
       'active', 0, 'NGN', 'employer', now(), v_period_end)
    returning id into v_purchase_id;

    update public.employer_roster_members set granted_subscription_id = v_purchase_id where id = new.id;
  end if;

  return null;
end;
$function$;

-- employer_allowance_remaining/employer_consume_allowance derive their annual
-- allowance-usage period window from the patient's own service_purchases
-- row rather than subscriptions.
create or replace function public.employer_allowance_remaining(p_patient_id uuid, p_allowance_type text)
returns integer
language plpgsql
stable security definer
set search_path to ''
as $function$
declare
  v_org uuid;
  v_package_id uuid;
  v_limit integer;
  v_used integer;
  v_period_start date;
  v_period_end date;
begin
  if not (private.is_admin() or (select auth.uid()) = p_patient_id
          or private.is_org_staff((select organisation_id from public.profiles where id = p_patient_id))) then
    raise exception 'Not authorised';
  end if;

  select r.organisation_id, r.benefit_package_id into v_org, v_package_id
    from public.employer_roster_members r
   where r.claimed_profile_id = p_patient_id and r.status = 'claimed'
   order by r.claimed_at desc
   limit 1;

  if v_package_id is null then
    return null;
  end if;

  select annual_limit into v_limit
    from public.employer_benefit_allowances
   where package_id = v_package_id and allowance_type = p_allowance_type::public.employer_allowance_type;
  if v_limit is null then
    return null;
  end if;

  select (expires_at::date - interval '1 year')::date, expires_at::date
    into v_period_start, v_period_end
    from public.service_purchases
   where patient_id = p_patient_id and payment_provider = 'employer' and status = 'active'
   order by purchased_at desc
   limit 1;
  v_period_start := coalesce(v_period_start, date_trunc('year', current_date)::date);
  v_period_end   := coalesce(v_period_end, (date_trunc('year', current_date) + interval '1 year')::date);

  select used_count into v_used
    from public.employer_allowance_usage
   where patient_id = p_patient_id and package_id = v_package_id
     and allowance_type = p_allowance_type::public.employer_allowance_type
     and period_start = v_period_start;

  return v_limit - coalesce(v_used, 0);
end;
$function$;

create or replace function public.employer_consume_allowance(p_patient_id uuid, p_allowance_type text)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_package_id uuid;
  v_org uuid;
  v_limit integer;
  v_period_start date;
  v_period_end date;
  v_remaining integer;
begin
  if not (private.is_admin()
          or private.is_org_staff((select organisation_id from public.profiles where id = p_patient_id))) then
    raise exception 'Not authorised';
  end if;

  select r.organisation_id, r.benefit_package_id into v_org, v_package_id
    from public.employer_roster_members r
   where r.claimed_profile_id = p_patient_id and r.status = 'claimed'
   order by r.claimed_at desc
   limit 1;
  if v_package_id is null then
    raise exception 'patient has no active employer benefit package';
  end if;

  select annual_limit into v_limit
    from public.employer_benefit_allowances
   where package_id = v_package_id and allowance_type = p_allowance_type::public.employer_allowance_type;
  if v_limit is null then
    raise exception 'package does not meter %', p_allowance_type;
  end if;

  select (expires_at::date - interval '1 year')::date, expires_at::date
    into v_period_start, v_period_end
    from public.service_purchases
   where patient_id = p_patient_id and payment_provider = 'employer' and status = 'active'
   order by purchased_at desc
   limit 1;
  v_period_start := coalesce(v_period_start, date_trunc('year', current_date)::date);
  v_period_end   := coalesce(v_period_end, (date_trunc('year', current_date) + interval '1 year')::date);

  insert into public.employer_allowance_usage
    (patient_id, package_id, allowance_type, period_start, period_end, used_count)
  values
    (p_patient_id, v_package_id, p_allowance_type::public.employer_allowance_type, v_period_start, v_period_end, 1)
  on conflict (patient_id, package_id, allowance_type, period_start)
  do update set used_count = employer_allowance_usage.used_count + 1
  returning v_limit - used_count into v_remaining;

  if v_remaining < 0 then
    raise exception 'allowance exhausted for % (limit %)', p_allowance_type, v_limit;
  end if;

  return v_remaining;
end;
$function$;

do $$
begin
  if pg_get_functiondef('private.sync_employer_subscription_from_roster()'::regprocedure) ~ 'into public\.subscriptions|from public\.subscriptions' then
    raise exception 'sync_employer_subscription_from_roster still touches the retired subscriptions table';
  end if;
  if not exists (select 1 from information_schema.columns
    where table_name='employer_benefit_packages' and column_name='service_product_id') then
    raise exception 'employer_benefit_packages.service_product_id rename failed';
  end if;
  raise notice 'PASS: employer benefit grants repointed to service_purchases/service_products';
end $$;

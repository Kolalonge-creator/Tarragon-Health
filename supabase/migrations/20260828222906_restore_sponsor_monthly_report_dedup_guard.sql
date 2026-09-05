create or replace function private.queue_sponsor_monthly_reports()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  v_recently_notified uuid[];
begin
  select coalesce(array_agg(distinct recipient_id), '{}')
    into v_recently_notified
    from public.notifications
   where template = 'sponsor_monthly_report'
     and created_at > now() - interval '20 days';

  for v_row in
    select
      v.purchaser_profile_id                                    as sponsor_id,
      v.beneficiary_profile_id                                  as beneficiary_id,
      min(v.organisation_id::text)::uuid                        as organisation_id,
      (select full_name from public.profiles p where p.id = v.beneficiary_profile_id) as beneficiary_name,
      count(*) filter (where v.status = 'active')               as ready_count,
      count(*) filter (where v.status = 'reserved')             as saving_count,
      count(*) filter (where v.status = 'redeemed'
                         and v.redeemed_at > now() - interval '1 month') as used_this_month,
      sum(v.amount_paid_kobo) filter (where v.created_at > now() - interval '1 month') as spent_kobo
    from public.care_vouchers v
    where v.purchaser_profile_id is not null
      and v.purchaser_profile_id <> v.beneficiary_profile_id
    group by v.purchaser_profile_id, v.beneficiary_profile_id
  loop
    if v_row.sponsor_id = any(v_recently_notified) then
      continue;
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    select v_row.organisation_id, v_row.sponsor_id, ch, 'sponsor_monthly_report',
           jsonb_build_object(
             'beneficiary_name', v_row.beneficiary_name,
             'ready_count', v_row.ready_count,
             'saving_count', v_row.saving_count,
             'used_this_month', v_row.used_this_month,
             'spent_naira', (coalesce(v_row.spent_kobo, 0) / 100)::text)
      from unnest(array['in_app', 'email']::public.notification_channel[]) as ch;
  end loop;
end;
$$;

do $$
begin
  declare
    v_org uuid;
    v_sponsor uuid := gen_random_uuid();
    v_beneficiary uuid;
    v_plan uuid;
    v_before int;
    v_after int;
  begin
    select id into v_org from public.organisations limit 1;
    select id into v_beneficiary from public.profiles
      where role = 'patient' and organisation_id = v_org limit 1;
    select id into v_plan from public.subscription_plans
      where interval = 'yearly' and currency = 'NGN' and price_minor > 0 limit 1;

    if v_org is null or v_beneficiary is null or v_plan is null then
      raise notice 'no fixture available; skipping behavioural assertion';
      return;
    end if;

    insert into auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data)
    values (v_sponsor, 'dedup-guard-fixture-sponsor@example.invalid', 'x', now(), '{}', '{}');
    update public.profiles set organisation_id = v_org, role = 'patient', full_name = 'Dedup Guard Fixture Sponsor'
      where id = v_sponsor;

    insert into public.care_vouchers
      (organisation_id, voucher_number, kind, beneficiary_profile_id, purchaser_profile_id,
       subscription_plan_id, sku_code, sku_name, face_value_kobo, status, expires_at)
    values
      (v_org, 'DEDUP-GUARD-TEST-1', 'prepaid_service', v_beneficiary, v_sponsor,
       v_plan, 'test', 'Test plan', 100000, 'reserved', now() + interval '1 year');

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, created_at)
    values
      (v_org, v_sponsor, 'in_app', 'sponsor_monthly_report', '{}'::jsonb, now() - interval '5 days');

    select count(*) into v_before from public.notifications
      where recipient_id = v_sponsor and template = 'sponsor_monthly_report';

    perform private.queue_sponsor_monthly_reports();

    select count(*) into v_after from public.notifications
      where recipient_id = v_sponsor and template = 'sponsor_monthly_report';

    if v_after <> v_before then
      raise exception 'dedup guard did not hold: had % sponsor_monthly_report row(s), now %', v_before, v_after;
    end if;

    delete from public.notifications where recipient_id = v_sponsor and template = 'sponsor_monthly_report';
    delete from public.care_vouchers where voucher_number = 'DEDUP-GUARD-TEST-1';
  end;
end $$;

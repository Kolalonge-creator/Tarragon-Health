-- vitals_readings has taken_at, not recorded_at.
--
-- Caught by running the function against real data rather than trusting the
-- column name. A plpgsql body is not parsed at creation time, so the previous
-- migration created cleanly and would have failed silently on the first cron
-- run a month later, with nobody watching. Worth noting for the next person
-- writing a scheduled function: create success is not evidence it works.
create or replace function private.queue_sponsor_monthly_reports()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_sponsor uuid;
  v_people  jsonb;
  v_org     uuid;
  v_queued  int := 0;
begin
  for v_sponsor in
    select distinct l.actor_profile_id
      from public.wallet_ledger l
      join public.health_wallets w on w.id = l.wallet_id
      join public.profile_access pa
        on pa.profile_id = w.profile_id
       and pa.grantee_user_id = l.actor_profile_id
     where l.entry_type = 'sponsor_topup'
       and l.actor_profile_id is not null
  loop
    if exists (
      select 1 from public.notifications
       where recipient_id = v_sponsor
         and template = 'sponsor_monthly_report'
         and created_at > now() - interval '20 days'
    ) then
      continue;
    end if;

    select organisation_id into v_org from public.profiles where id = v_sponsor;

    select jsonb_agg(person order by person->>'name')
      into v_people
    from (
      select jsonb_build_object(
               'name', coalesce(nullif(trim(p.full_name), ''), 'someone you support'),
               'balance_kobo', coalesce(w.balance_kobo, 0),
               'funded_kobo', coalesce((
                 select sum(abs(l.amount_kobo)) from public.wallet_ledger l
                  where l.wallet_id = w.id and l.entry_type = 'sponsor_topup'
                    and l.actor_profile_id = v_sponsor
                    and l.created_at > now() - interval '30 days'), 0),
               'spent_kobo', coalesce((
                 select sum(abs(l.amount_kobo)) from public.wallet_ledger l
                  where l.wallet_id = w.id and l.entry_type = 'spend'
                    and l.created_at > now() - interval '30 days'), 0),
               'awaiting_payment', (
                 select count(*) from public.lab_orders lo
                  where lo.patient_id = p.id and lo.status = 'pending_payment'),
               'quiet_days', (
                 select case when max(v.taken_at) is null then null
                             else extract(day from now() - max(v.taken_at))::int end
                   from public.vitals_readings v where v.patient_id = p.id)
             ) as person
        from public.profile_access pa
        join public.profiles p on p.id = pa.profile_id
        left join public.health_wallets w on w.profile_id = p.id
       where pa.grantee_user_id = v_sponsor
    ) rows;

    if v_people is null or jsonb_array_length(v_people) = 0 then
      continue;
    end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload)
    select v_org, v_sponsor, c.channel, 'sponsor_monthly_report',
           jsonb_build_object('people', v_people)
      from (values ('in_app'::public.notification_channel),
                   ('email'::public.notification_channel)) as c(channel);

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

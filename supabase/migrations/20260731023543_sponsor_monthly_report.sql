-- The monthly report to whoever is paying for someone else's care.
--
-- NOTE: this version referenced vitals_readings.recorded_at, which does not
-- exist. A plpgsql body is not parsed at creation time, so it was created
-- cleanly and only failed when first called. Corrected in
-- 20260731023625_fix_sponsor_report_vitals_column. Kept as applied history.
--
-- This is the deliverable a diaspora sponsor actually wants, and the one thing
-- a money-transfer service structurally cannot produce. It is deliberately
-- generated rather than staffed: no person assembles it, it costs nothing per
-- sponsor, and it arrives every month whether or not anyone remembered.
--
-- WHAT IT MAY CONTAIN, and why the line is drawn where it is.
--
-- Money, logistics and engagement. Never clinical content. A sponsor already
-- has RLS-level sight of health_wallets and wallet_ledger, so balances and
-- spend categories disclose nothing new. They do NOT have sight of
-- vitals_readings, screening_schedules or results, and this does not leak them:
-- "nothing has been logged in N days" is a statement about activity, not about
-- health, and carries no value, no condition and no result. Whether a sponsor
-- should ever see clinical detail is a separate product decision nobody has
-- taken.
--
-- Rows stay content_class = 'non_clinical' (the column default) and so satisfy
-- the I1 CHECK on the email channel.
--
-- Sponsors are defined exactly as the spend-receipt trigger defines them:
-- people who have actually put money into a wallet they hold a grant on. A next
-- of kin who has never funded anything is not sent a monthly money summary.
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
    -- One report per sponsor per month. A second cron run inside the window is
    -- a no-op rather than a duplicate email.
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
                 -- Only meaningful once they have ever logged something, so a
                 -- brand new account does not read as having gone silent.
                 select case when max(v.recorded_at) is null then null
                             else extract(day from now() - max(v.recorded_at))::int end
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

select cron.schedule(
  'sponsor-monthly-report',
  '0 7 1 * *',
  $$select private.queue_sponsor_monthly_reports();$$
);

do $$
begin
  if not exists (select 1 from cron.job where jobname = 'sponsor-monthly-report') then
    raise exception 'the sponsor monthly report cron must be scheduled';
  end if;
end $$;

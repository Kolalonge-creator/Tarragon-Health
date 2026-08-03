-- Tell the sponsor when something actually happens, and let them pay the plan.
--
-- Walking /patient/supporting as a son abroad, the only notification I had ever
-- received was a health-education lesson unlock for MY OWN account. Nothing
-- about my mother: not the doctor alert her rising blood pressure had already
-- raised, not her medication, not her money. The one thing a person 5,000km
-- away is buying is the sense that someone will tell them. Silence was the
-- product.
--
-- Three producers here, each on a different and deliberate basis:
--
--   care reviewed  -> clinical_access. A doctor looking at her record is health
--                     visibility, so it follows her own consent switch.
--   gone quiet     -> clinical_access. "No reading in three weeks" is a fact
--                     about her health engagement, not about my money.
--   sponsored plan -> the payer. Money events follow who is billed.
--
-- Every payload is category and status only, so every row is honestly
-- content_class = 'non_clinical' and satisfies the I1 CHECK. A sponsor is told
-- THAT a doctor reviewed something, never what was found. `in_app` is always
-- included because a sponsor abroad frequently has no Nigerian number and the
-- in-app leg needs no Meta template approval to work.

-- 1. A DOCTOR HAS LOOKED AT IT ------------------------------------------------
create or replace function private.notify_sponsors_care_reviewed()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_sponsor uuid;
  v_org uuid;
  v_name text;
begin
  -- Only the moment of first review. An edit to an already-acknowledged alert
  -- must not re-notify.
  if new.acknowledged_at is null or old.acknowledged_at is not null then
    return new;
  end if;

  select coalesce(nullif(trim(p.full_name), ''), 'someone you support')
    into v_name
    from public.profiles p where p.id = new.patient_id;

  for v_sponsor in
    select pa.grantee_user_id
      from public.profile_access pa
     where pa.profile_id = new.patient_id
       and pa.clinical_access
  loop
    select organisation_id into v_org from public.profiles where id = v_sponsor;
    if v_org is null then continue; end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class,
       source_table, source_id)
    select v_org, v_sponsor, c.channel, 'sponsor_care_reviewed',
           jsonb_build_object('person_name', v_name),
           'non_clinical', 'clinician_alerts', new.id
      from (values ('in_app'::public.notification_channel),
                   ('email'::public.notification_channel)) as c(channel);
  end loop;

  return new;
end;
$$;

drop trigger if exists notify_sponsors_care_reviewed on public.clinician_alerts;
create trigger notify_sponsors_care_reviewed
  after update of acknowledged_at on public.clinician_alerts
  for each row execute function private.notify_sponsors_care_reviewed();

-- 2. SHE HAS GONE QUIET -------------------------------------------------------
-- Only for someone with an active care plan: a healthy person not logging for
-- three weeks is normal, and nagging about it would train sponsors to ignore
-- these. 21 days, and at most one nudge per person per month.
create or replace function private.queue_sponsor_quiet_nudges()
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  r record;
  v_org uuid;
  v_queued int := 0;
begin
  for r in
    select pa.grantee_user_id as sponsor,
           p.id as person,
           coalesce(nullif(trim(p.full_name), ''), 'someone you support') as person_name,
           (select max(v.taken_at) from public.vitals_readings v where v.patient_id = p.id) as last_reading
      from public.profile_access pa
      join public.profiles p on p.id = pa.profile_id
     where pa.clinical_access
       and exists (
         select 1 from public.care_plans cp
          where cp.patient_id = p.id and cp.status = 'active'
       )
  loop
    -- Never logged anything at all is a different problem (onboarding), not a
    -- lapse. Say nothing rather than something wrong.
    if r.last_reading is null or r.last_reading > now() - interval '21 days' then
      continue;
    end if;

    if exists (
      select 1 from public.notifications
       where recipient_id = r.sponsor
         and template = 'sponsor_person_quiet'
         and (payload->>'person_id') = r.person::text
         and created_at > now() - interval '30 days'
    ) then
      continue;
    end if;

    select organisation_id into v_org from public.profiles where id = r.sponsor;
    if v_org is null then continue; end if;

    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, r.sponsor, c.channel, 'sponsor_person_quiet',
           jsonb_build_object(
             'person_id', r.person,
             'person_name', r.person_name,
             'quiet_days', extract(day from now() - r.last_reading)::int
           ),
           'non_clinical'
      from (values ('in_app'::public.notification_channel),
                   ('email'::public.notification_channel)) as c(channel);

    v_queued := v_queued + 1;
  end loop;

  return v_queued;
end;
$$;

select cron.unschedule('sponsor-quiet-nudge-weekly')
 where exists (select 1 from cron.job where jobname = 'sponsor-quiet-nudge-weekly');

select cron.schedule(
  'sponsor-quiet-nudge-weekly',
  '20 7 * * 1',
  $cron$ select private.queue_sponsor_quiet_nudges(); $cron$
);

-- 3. THE SPONSOR PAYS THE PLAN ------------------------------------------------
-- An AFTER INSERT trigger on payment_transactions rather than an edit to the
-- deployed webhook Edge Functions. That is the pattern the wallet top-up used
-- for exactly this reason: the trigger matches on its own metadata key and so
-- works regardless of which webhook version is deployed, avoiding the
-- redeploy-regression risk this codebase has already been bitten by twice.
--
-- Exception-guarded throughout: a subscription that fails to activate is a
-- support ticket, but a webhook whose own audit write is aborted loses the
-- record that money changed hands.
create or replace function private.activate_sponsored_subscription()
returns trigger
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_meta jsonb;
  v_beneficiary uuid;
  v_sponsor uuid;
  v_plan record;
  v_org uuid;
  v_existing uuid;
begin
  if new.processed_at is null then return new; end if;

  v_meta := coalesce(
    new.raw_payload -> 'data' -> 'metadata',
    new.raw_payload -> 'data' -> 'object' -> 'metadata',
    new.raw_payload -> 'metadata',
    '{}'::jsonb
  );

  if coalesce(v_meta ->> 'kind', '') <> 'sponsored_subscription' then
    return new;
  end if;

  begin
    v_beneficiary := nullif(v_meta ->> 'beneficiary_profile_id', '')::uuid;
    v_sponsor     := nullif(v_meta ->> 'sponsor_profile_id', '')::uuid;

    select id, code, currency, price_minor, interval
      into v_plan
      from public.subscription_plans
     where code = v_meta ->> 'plan_code';

    if v_beneficiary is null or v_sponsor is null or v_plan.id is null then
      return new;
    end if;

    -- The sponsor must still hold a manage grant at the moment money lands.
    -- A grant revoked between checkout and webhook must not buy anything.
    if not exists (
      select 1 from public.profile_access pa
       where pa.profile_id = v_beneficiary
         and pa.grantee_user_id = v_sponsor
         and pa.permission_level = 'manage'
    ) then
      return new;
    end if;

    select organisation_id into v_org from public.profiles where id = v_beneficiary;

    select id into v_existing
      from public.subscriptions
     where subscriber_id = v_beneficiary
       and status in ('active', 'trialing')
     limit 1;

    if v_existing is not null then
      update public.subscriptions
         set plan_id = v_plan.id,
             paid_by_profile_id = v_sponsor,
             status = 'active',
             currency = v_plan.currency,
             amount_minor = v_plan.price_minor,
             interval = v_plan.interval,
             cancel_at_period_end = false,
             current_period_end = case
               when v_plan.interval = 'yearly' then now() + interval '1 year'
               else now() + interval '1 month' end,
             updated_at = now()
       where id = v_existing;
    else
      insert into public.subscriptions
        (organisation_id, subscriber_id, plan_id, status, currency, amount_minor,
         interval, paid_by_profile_id, started_at, current_period_end)
      values
        (v_org, v_beneficiary, v_plan.id, 'active', v_plan.currency,
         v_plan.price_minor, v_plan.interval, v_sponsor, now(),
         case when v_plan.interval = 'yearly' then now() + interval '1 year'
              else now() + interval '1 month' end);
    end if;

    -- Tell both sides. The person whose care it is must never discover they
    -- have been put on a paid plan by noticing new features.
    insert into public.notifications
      (organisation_id, recipient_id, channel, template, payload, content_class)
    select v_org, x.recipient, c.channel, 'sponsored_plan_started',
           jsonb_build_object(
             'plan_name', v_plan.code,
             'sponsor_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_sponsor),
             'person_name', (select coalesce(nullif(trim(full_name),''),'someone') from public.profiles where id = v_beneficiary),
             'is_payer', x.recipient = v_sponsor
           ),
           'non_clinical'
      from (values (v_beneficiary), (v_sponsor)) as x(recipient)
      cross join (values ('in_app'::public.notification_channel),
                         ('email'::public.notification_channel)) as c(channel);

  exception when others then
    -- Never abort the payment record itself.
    return new;
  end;

  return new;
end;
$$;

drop trigger if exists activate_sponsored_subscription on public.payment_transactions;
create trigger activate_sponsored_subscription
  after insert on public.payment_transactions
  for each row execute function private.activate_sponsored_subscription();

-- 4. ASSERT -------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'notify_sponsors_care_reviewed') then
    raise exception 'care-reviewed trigger missing';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'activate_sponsored_subscription') then
    raise exception 'sponsored subscription trigger missing';
  end if;
  if not exists (select 1 from cron.job where jobname = 'sponsor-quiet-nudge-weekly') then
    raise exception 'quiet nudge cron missing';
  end if;

  -- I1: a sponsor notification must never be able to claim clinical content on
  -- an open rail. Every insert above is hard-coded non_clinical; this proves no
  -- future edit quietly changes that without failing here.
  if pg_get_functiondef('private.notify_sponsors_care_reviewed()'::regprocedure) !~ 'non_clinical'
     or pg_get_functiondef('private.queue_sponsor_quiet_nudges()'::regprocedure) !~ 'non_clinical' then
    raise exception 'sponsor notifications must be explicitly non_clinical';
  end if;
end $$;

-- Credit validity moves from 90 days to two years, and two numbers that were
-- welded into function bodies become configuration.
-- Founder decision, 2026-09-10.
--
-- CREDIT VALIDITY
-- ---------------
-- Every one-off credit carried access_duration_days = 90. A patient who bought
-- one and did not use it lost the money. The public pricing page, three lines
-- above where those credits are listed, promises "no surprise charges, ever"
-- and tells patients that a Care Voucher lasts two years, that they are
-- reminded thirty days before it lapses, and that a lapsed one is normally
-- reinstated on request. A ninety-day silent expiry on a paid credit is exactly
-- the surprise that page disowns, and it contradicted a promise made about a
-- neighbouring product on the same screen.
--
-- Credits now last 730 days, matching public.care_voucher_config.validity_months
-- of 24. Duration products -- the monitoring cover, the AI Coach pass, the
-- chronic programme -- keep their own real durations, because for those the
-- duration IS the product rather than a shelf life.
--
-- CONFIGURATION
-- -------------
-- public.redeem_referral_code hardcoded two numbers in its body: a 50,000 kobo
-- (500 naira) reward and a 30-day window in which a new joiner may apply a code.
-- Tuning the platform's principal growth lever therefore required a database
-- migration, which in practice means it never gets tuned. Both move into
-- public.growth_config, and the function reads them.

begin;

-- ---------------------------------------------------------------------------
-- 1. Credit validity
-- ---------------------------------------------------------------------------

update public.service_products
   set access_duration_days = 730
 where is_active
   and access_duration_days = 90
   and code not like 'continuous\_monitoring\_%';

-- Credits already bought under the ninety-day rule are extended rather than
-- left to lapse. Nine service_purchases exist live; extending an unredeemed one
-- can only ever be in the patient's favour, and leaving them would mean the
-- promise above became true only for people who bought after today.
update public.service_purchases sp
   set expires_at = sp.purchased_at + interval '730 days'
  from public.service_products p
 where p.id = sp.service_product_id
   and sp.redeemed_at is null
   and sp.status = 'active'
   and p.access_duration_days = 730
   and sp.expires_at is not null
   and sp.expires_at < sp.purchased_at + interval '730 days';

-- ---------------------------------------------------------------------------
-- 2. Growth configuration
-- ---------------------------------------------------------------------------

create table if not exists public.growth_config (
  id                          uuid primary key default gen_random_uuid(),
  organisation_id             uuid references public.organisations(id) on delete cascade,
  referral_reward_kobo        bigint  not null default 50000,
  referral_apply_window_days  integer not null default 30,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles(id) on delete set null,
  constraint growth_config_reward_sane
    check (referral_reward_kobo >= 0 and referral_reward_kobo <= 10000000),
  constraint growth_config_window_sane
    check (referral_apply_window_days between 1 and 365)
);

comment on table public.growth_config is
  'Platform growth levers that used to be literals inside function bodies. One row with a null organisation_id is the platform default; an organisation row overrides it. Created 2026-09-10 because tuning the referral reward required a migration, which meant it was never tuned.';
comment on column public.growth_config.referral_reward_kobo is
  'Reward in kobo credited to BOTH referrer and referred once the referred patient completes their first paid order. Was hardcoded as 50000 (500 naira) in public.redeem_referral_code. Any change must also be reflected in the marketing pricing copy and the gift page, which state the figure in words.';
comment on column public.growth_config.referral_apply_window_days is
  'How long after joining a patient may still apply someone''s referral code. Was hardcoded as 30 days.';

create unique index if not exists growth_config_one_platform_default
  on public.growth_config ((organisation_id is null)) where organisation_id is null;
create unique index if not exists growth_config_one_per_org
  on public.growth_config (organisation_id) where organisation_id is not null;

insert into public.growth_config (organisation_id) values (null)
  on conflict do nothing;

alter table public.growth_config enable row level security;

-- RLS restricts rows; it does not grant table access. A table created by a
-- plain migration needs its own grant. See the standing note in CLAUDE.md --
-- the failure mode is an empty result rather than an error, which is why this
-- has bitten three times. anon is left alone deliberately: the platform-wide
-- default-privileges migration already revokes anon on public tables, and a
-- per-migration revoke here would be the file-by-file fix that migration exists
-- to replace.
grant select on public.growth_config to authenticated;
grant insert, update on public.growth_config to authenticated;

drop policy if exists growth_config_read on public.growth_config;
create policy growth_config_read on public.growth_config
  for select to authenticated
  using (organisation_id is null or organisation_id = private.current_org_id());

drop policy if exists growth_config_write on public.growth_config;
create policy growth_config_write on public.growth_config
  for all to authenticated
  using (private.is_admin())
  with check (private.is_admin());

drop trigger if exists growth_config_set_updated_at on public.growth_config;
create trigger growth_config_set_updated_at
  before update on public.growth_config
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. redeem_referral_code reads configuration
-- ---------------------------------------------------------------------------

create or replace function public.redeem_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_caller uuid := auth.uid();
  v_org uuid;
  v_created timestamptz;
  v_owner uuid;
  v_reward_kobo bigint;
  v_window_days integer;
begin
  if v_caller is null then raise exception 'not authenticated'; end if;
  select organisation_id, created_at into v_org, v_created from public.profiles where id = v_caller;

  select gc.referral_reward_kobo, gc.referral_apply_window_days
    into v_reward_kobo, v_window_days
    from public.growth_config gc
   where gc.organisation_id is not distinct from v_org
      or gc.organisation_id is null
   order by (gc.organisation_id is not null) desc
   limit 1;

  -- Configuration is expected to exist; falling back rather than failing keeps
  -- a referral working if the row is ever deleted.
  v_reward_kobo := coalesce(v_reward_kobo, 50000);
  v_window_days := coalesce(v_window_days, 30);

  if v_created < now() - make_interval(days => v_window_days) then
    return jsonb_build_object('ok', false,
      'error', format('Referral codes can only be applied within %s days of joining.', v_window_days));
  end if;
  select profile_id into v_owner from public.referral_codes where code = upper(trim(p_code));
  if v_owner is null then
    return jsonb_build_object('ok', false, 'error', 'That code doesn''t look right — check it and try again.');
  end if;
  if v_owner = v_caller then
    return jsonb_build_object('ok', false, 'error', 'You can''t refer yourself.');
  end if;
  if exists (select 1 from public.referrals where referred_id = v_caller) then
    return jsonb_build_object('ok', false, 'error', 'A referral code has already been applied to this account.');
  end if;
  insert into public.referrals (organisation_id, referrer_id, referred_id, code, type, reward_kobo, reward_status)
  values (v_org, v_owner, v_caller, upper(trim(p_code)), 'patient_refers_patient', v_reward_kobo, 'pending');
  return jsonb_build_object('ok', true);
end;
$function$;

-- anon inherits EXECUTE through the PUBLIC pseudo-role, not a direct grant, so
-- the revoke has to name PUBLIC. This has been "fixed" and found broken more
-- than once on this project; verify with has_function_privilege rather than
-- trusting this comment.
revoke all on function public.redeem_referral_code(text) from public;
grant execute on function public.redeem_referral_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assertions
-- ---------------------------------------------------------------------------

do $$
declare
  v_short int;
  v_anon  boolean;
begin
  select count(*) into v_short
    from public.service_products
   where is_active and access_duration_days = 90
     and code not like 'continuous\_monitoring\_%';
  if v_short <> 0 then
    raise exception 'FAIL: % active product(s) still expire in 90 days', v_short;
  end if;

  if not exists (select 1 from public.growth_config where organisation_id is null) then
    raise exception 'FAIL: no platform-default growth_config row';
  end if;

  if not has_table_privilege('authenticated', 'public.growth_config', 'SELECT') then
    raise exception 'FAIL: authenticated cannot SELECT growth_config -- RLS will look like an empty table';
  end if;

  select has_function_privilege('anon', 'public.redeem_referral_code(text)', 'EXECUTE') into v_anon;
  if v_anon then
    raise exception 'FAIL: anon can still EXECUTE redeem_referral_code';
  end if;

  raise notice 'PASS: credits valid 730 days; referral reward and window are configuration';
end $$;

commit;

-- Specialist referrals join labs and pharmacy: the booking and the commission
-- are suspended, the clinical act is not.
--
-- A referral letter is the whole point of a referral. Losing it would mean a
-- patient turning up at a specialist with nothing but their own account of why
-- they came, which is exactly the failure this platform exists to prevent. So
-- the letter stays and gets better; only "we book it and take a cut" goes.
--
-- Row counts first: specialist_referrals 0, commissions 0, and all 9
-- specialist_providers are [Placeholder] rows with no contact details. Nothing
-- to unwind.

-- The enum was named for its first use. It governs how ANY order is fulfilled,
-- so give it the honest name now that referrals use it too.
alter type public.lab_order_fulfilment rename to fulfilment_mode;

alter table public.specialist_referrals
  add column if not exists fulfilment public.fulfilment_mode
    not null default 'self_arranged';

comment on column public.specialist_referrals.fulfilment is
  'partner = Tarragon books the specialist and takes a fee (dormant until one is contracted). self_arranged = the patient takes their referral letter to a specialist of their choosing and pays them directly.';

-- ---------------------------------------------------------------------------
-- Same shape as enforce_lab_order_origin's fulfilment guard: a self-arranged
-- referral names no partner and carries no Tarragon charge.
-- ---------------------------------------------------------------------------
create or replace function private.enforce_referral_fulfilment()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if new.fulfilment = 'self_arranged' then
    if new.specialist_provider_id is not null then
      raise exception 'A self-arranged referral names no specialist: the patient chooses who to see'
        using errcode = '23514';
    end if;
    if coalesce(new.referral_fee_kobo, 0) <> 0 then
      raise exception 'A self-arranged referral is not billed by Tarragon — the patient pays the specialist directly'
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists specialist_referrals_enforce_fulfilment on public.specialist_referrals;
create trigger specialist_referrals_enforce_fulfilment
  before insert or update on public.specialist_referrals
  for each row execute function private.enforce_referral_fulfilment();

-- ---------------------------------------------------------------------------
-- The "pick a specialist" RPC is partner-only and now explains itself, exactly
-- like set_lab_order_facility. Return type kept as specialist_referrals so the
-- existing caller still compiles.
-- ---------------------------------------------------------------------------
create or replace function public.set_referral_specialist_provider(
  p_referral_id uuid,
  p_specialist_provider_id uuid
)
returns public.specialist_referrals
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_ref public.specialist_referrals%rowtype;
begin
  select * into v_ref from public.specialist_referrals where id = p_referral_id;
  if v_ref.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;
  if v_ref.fulfilment = 'self_arranged' then
    raise exception 'Your referral letter is yours to take to any specialist you choose, so there is nobody to assign here'
      using errcode = '23514';
  end if;
  raise exception 'Specialist booking is not available yet' using errcode = '23514';
end;
$function$;

revoke all on function public.set_referral_specialist_provider(uuid, uuid) from public;
revoke all on function public.set_referral_specialist_provider(uuid, uuid) from anon;
grant execute on function public.set_referral_specialist_provider(uuid, uuid) to authenticated;

-- Dormant, not deleted. Contracting a specialist is an is_active flip.
update public.specialist_providers set is_active = false where is_active;

do $$
declare v_def text; v_n int;
begin
  if not exists (select 1 from pg_type where typname='fulfilment_mode') then
    raise exception 'the enum rename did not take';
  end if;
  if exists (select 1 from public.specialist_providers where is_active) then
    raise exception 'a specialist provider is still active';
  end if;
  if (select count(*) from public.specialist_providers) <> 9 then
    raise exception 'specialist rows were deleted rather than deactivated';
  end if;
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname='set_referral_specialist_provider' and pronamespace='public'::regnamespace;
  if v_def not like '%nobody to assign here%' then
    raise exception 'set_referral_specialist_provider does not explain itself';
  end if;
  -- The clinical act must be untouched: the letter's raw material.
  select count(*) into v_n from information_schema.columns
   where table_schema='public' and table_name='specialist_referrals'
     and column_name in ('clinical_summary','referral_reason','urgency','interim_management_plan');
  if v_n <> 4 then
    raise exception 'a field the referral letter is built from is missing';
  end if;
end $$;

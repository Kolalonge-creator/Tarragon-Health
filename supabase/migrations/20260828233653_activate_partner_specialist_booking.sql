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
  v_provider public.specialist_providers%rowtype;
begin
  select * into v_ref from public.specialist_referrals where id = p_referral_id for update;
  if v_ref.id is null then
    raise exception 'Referral not found' using errcode = '42501';
  end if;

  if not private.is_org_staff(v_ref.organisation_id) then
    raise exception 'Only your care team can assign a specialist provider' using errcode = '42501';
  end if;

  if v_ref.status not in ('pending', 'waitlisted') then
    raise exception 'This referral has already moved past assignment' using errcode = '23514';
  end if;

  select * into v_provider from public.specialist_providers where id = p_specialist_provider_id;
  if v_provider.id is null or not v_provider.is_active then
    raise exception 'That specialist is not on file as an active partner' using errcode = '23514';
  end if;
  if v_provider.specialist_type <> v_ref.specialist_type then
    raise exception 'That specialist''s type does not match this referral''s specialty' using errcode = '23514';
  end if;

  update public.specialist_referrals
  set fulfilment = 'partner',
      specialist_provider_id = p_specialist_provider_id,
      referral_fee_kobo = v_provider.consultation_fee_kobo,
      status = 'pending_payment',
      waitlisted_at = null
  where id = p_referral_id
  returning * into v_ref;

  return v_ref;
end;
$function$;

comment on function public.set_referral_specialist_provider(uuid, uuid) is
  'Assigns a real, active, specialty-matched partner specialist_providers row to a pending/waitlisted referral, locks in its fee, flips fulfilment self_arranged -> partner, and advances status to pending_payment. Raises if the caller is not org staff, the referral has already moved past assignment, or the chosen provider is not a genuinely active specialty match. Dormant by data, not by code, per the 2026-08-03 migration''s own framing -- this is the "is_active flip" becoming real again.';

revoke all on function public.set_referral_specialist_provider(uuid, uuid) from public;
revoke all on function public.set_referral_specialist_provider(uuid, uuid) from anon;
grant execute on function public.set_referral_specialist_provider(uuid, uuid) to authenticated;

do $$
declare v_def text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc
   where proname = 'set_referral_specialist_provider' and pronamespace = 'public'::regnamespace;
  if v_def like '%Specialist booking is not available yet%' then
    raise exception 'set_referral_specialist_provider still hard-blocks assignment';
  end if;
  if v_def not like '%is_org_staff%' then
    raise exception 'set_referral_specialist_provider is missing its org-staff authorisation check';
  end if;
  if not has_function_privilege('authenticated', 'public.set_referral_specialist_provider(uuid, uuid)', 'EXECUTE') then
    raise exception 'authenticated lacks EXECUTE on set_referral_specialist_provider';
  end if;
  if has_function_privilege('anon', 'public.set_referral_specialist_provider(uuid, uuid)', 'EXECUTE') then
    raise exception 'anon must not hold EXECUTE on set_referral_specialist_provider';
  end if;
  raise notice 'PASS: set_referral_specialist_provider reactivated with org-staff/status/active/specialty guards';
end $$;
-- The credentialing activation guard refused to switch on "a missing licence date counts as ineligible" while ANY active clinician had no licence
-- expiry date, including the synthetic clinician the chain canary (p1_chain_canary) creates and runs against every few minutes. That account is
-- is_test, never sees a real patient, and has no licence to record, so it blocked the Chief Medical Officer's signature on credentialing
-- configuration version 6 for good (found 2026-10-28: "record the licence expiry date of 2 active clinician(s)", one of them the canary).
--
-- Test clinicians are already exempt from the gate elsewhere (OQ-350: a test clinician is never labelled verification_missing; INV-13: test rows
-- are left out of every report), so the guard now counts only real clinicians. Redefined from the LIVE body (checked 2026-10-28), changing only the
-- is_test filter. Rows affected: none; a function body only. The real clinician with no date still blocks, as intended.

create or replace function private.guard_credentialing_activation() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_n integer;
begin
  if coalesce((new.rules ->> 'missing_licence_date_ineligible')::boolean, false) then
    select count(*) into v_n from public.clinical_staff
     where active and status = 'active' and profile_id is not null and license_expires_at is null and not coalesce(is_test, false);
    if v_n > 0 then
      raise exception 'record the licence expiry date of % active clinician(s) before a missing date counts as ineligible', v_n using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_credentialing_activation() from public, anon, authenticated;

do $$
begin
  if position('is_test' in pg_get_functiondef('private.guard_credentialing_activation()'::regprocedure)) = 0 then
    raise exception 'guard_credentialing_activation must skip test clinicians';
  end if;
  if has_function_privilege('anon', 'private.guard_credentialing_activation()', 'EXECUTE') or has_function_privilege('authenticated', 'private.guard_credentialing_activation()', 'EXECUTE') then
    raise exception 'guard_credentialing_activation must stay closed to anon and authenticated';
  end if;
end $$;

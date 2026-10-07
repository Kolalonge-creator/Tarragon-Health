-- The ngo_funded_cohort module (PR #713, 2026-09-23) shipped the full
-- create/invite/revoke/claim RPC plumbing with deliberately zero UI on top
-- (see funding-programmes.ts's own header) and, separately, no aggregate-
-- reporting function at all -- the module's own platform_modules.description
-- names "(app-layer) aggregate small-cell-suppressed programme reporting" as
-- an intended capability that was never built. This closes that specific gap
-- so a real console can show programme utilisation without ever exposing an
-- individual beneficiary's identity or clinical data to an ngo_admin.
--
-- Same authorisation shape as funding_programmes_select's own RLS policy
-- (private.is_admin() OR ngo_admin of the programme's own organisation) --
-- copied from that policy's live definition rather than re-derived, since
-- this is a SECURITY DEFINER function with no RLS of its own to fall back on.
--
-- Small-cell suppression: counts are always exact (a superadmin/ngo_admin
-- managing a contract needs the real number to reconcile against the
-- invoice), but claimed_by_profile_id / individual invitation rows are never
-- returned here -- only counts. That satisfies the module's stated
-- "aggregate, never individual" design without inventing a suppression
-- threshold nobody asked for; list_funding_programme_invitations (existing,
-- unchanged) is what an authorised admin uses to see per-row detail, which
-- already carries the same RLS-based authorisation.
--
-- Corrected before merge by /code-review high (three independent finder
-- passes caught the same bug): unitsCommitted/unitsRemaining must count
-- every invitation with status <> 'revoked' -- invited+claimed+expired -- to
-- match invite_to_funding_programme's own cap-enforcement predicate
-- verbatim (see that function's live definition). The first version only
-- counted invited+claimed, so once any invitation had lazily expired (no
-- sweep job flips it, so this is the normal long-running state, not an
-- edge case) the console would display more "remaining" capacity than a
-- real invite call would actually accept, silently past a signed
-- contract's cap. Also adds the private.assert_module_enabled() check every
-- other RPC on this module has (invite/revoke/claim/create/set_status) --
-- the first version omitted it, so a caller who still knew a programme_id
-- could read real aggregate counts from a paused/dormant module.
create or replace function public.get_funding_programme_stats(p_programme_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_programme public.funding_programmes%rowtype;
  v_authorized boolean := false;
  v_invited int;
  v_claimed int;
  v_expired int;
  v_revoked int;
  v_committed int;
  v_vouchers_redeemed int;
begin
  perform private.assert_module_enabled('ngo_funded_cohort');

  select * into v_programme from public.funding_programmes where id = p_programme_id;
  if not found then
    raise exception 'funding programme % not found', p_programme_id using errcode = '42704';
  end if;

  select private.is_admin() into v_authorized;
  if not v_authorized then
    select exists(
      select 1 from public.profiles
       where id = (select auth.uid())
         and role = 'ngo_admin'
         and organisation_id = v_programme.organisation_id
    ) into v_authorized;
  end if;

  if not v_authorized then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select
    count(*) filter (where status = 'invited'),
    count(*) filter (where status = 'claimed'),
    count(*) filter (where status = 'expired'),
    count(*) filter (where status = 'revoked'),
    count(*) filter (where status <> 'revoked')
    into v_invited, v_claimed, v_expired, v_revoked, v_committed
    from public.funding_programme_invitations
   where funding_programme_id = p_programme_id;

  select count(*) into v_vouchers_redeemed
    from public.funding_programme_invitations fpi
    join public.care_vouchers cv on cv.id = fpi.care_voucher_id
   where fpi.funding_programme_id = p_programme_id
     and cv.status = 'redeemed';

  return jsonb_build_object(
    'programmeId', p_programme_id,
    'status', v_programme.status,
    'fundedUnitCap', v_programme.funded_unit_cap,
    'invited', v_invited,
    'claimed', v_claimed,
    'expired', v_expired,
    'revoked', v_revoked,
    'vouchersRedeemed', v_vouchers_redeemed,
    'unitsCommitted', v_committed,
    'unitsRemaining', greatest(v_programme.funded_unit_cap - v_committed, 0)
  );
end;
$$;

revoke all on function public.get_funding_programme_stats(uuid) from public, anon;
grant execute on function public.get_funding_programme_stats(uuid) to authenticated;

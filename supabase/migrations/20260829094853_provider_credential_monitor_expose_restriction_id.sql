-- Tarragon Health — Provider Quality & Performance Management, follow-up.
--
-- provider_credential_monitor() (20260829093830) returned restriction_stage
-- but not the provider_restrictions.id itself — the admin credential-monitor
-- UI needs that id to call lift_provider_restriction(id, reason) from the
-- table row where the restriction is actually seen, rather than sending the
-- admin somewhere else to find it. One field added, nothing else about the
-- function's behaviour or gating changes.

create or replace function public.provider_credential_monitor()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_ladder jsonb;
  v_rows   jsonb;
begin
  if not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  v_ladder := coalesce(private.provider_quality_policy_config() -> 'credential_ladder', '{}'::jsonb);

  select coalesce(jsonb_agg(x order by x ->> 'soonest_expiry' nulls last), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'clinical_staff_id', cs.id,
      'full_name', cs.full_name,
      'doctor_tier', cs.doctor_tier,
      'is_clinical_director', cs.is_clinical_director,
      'credential_type', cs.credential_type,
      'credential_number', cs.credential_number,

      'license_expires_at', cs.license_expires_at,
      'license_state', case
        when cs.license_expires_at is null then 'not_recorded'
        when cs.license_expires_at <= now() then 'expired'
        when cs.license_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,
      'license_days_remaining', case
        when cs.license_expires_at is null then null
        else floor(extract(epoch from (cs.license_expires_at - now())) / 86400.0)::int end,
      'license_verified_at', cs.license_verified_at,

      'indemnity_expires_at', cs.indemnity_expires_at,
      'indemnity_state', case
        when cs.indemnity_exempt then 'not_applicable'
        when cs.indemnity_expires_at is null then 'not_recorded'
        when cs.indemnity_expires_at <= now() then 'expired'
        when cs.indemnity_expires_at <= now() + make_interval(
               days => coalesce((v_ladder ->> 'warning_days_before_expiry')::int, 30)) then 'expiring_soon'
        else 'current' end,

      'attestation_current', private.has_current_attestation(cs.id),
      'attestation_expires_at', (
        select max(a.expires_at) from public.clinical_staff_attestations a
        where a.clinical_staff_id = cs.id
      ),

      'restriction_id', (
        select r.id from public.provider_restrictions r
        where r.clinical_staff_id = cs.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1
      ),
      'restriction_stage', (
        select r.stage from public.provider_restrictions r
        where r.clinical_staff_id = cs.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1
      ),
      'work_restricted', private.provider_work_restricted(cs.id),
      'open_complaints', (
        select count(*) from public.provider_complaints c
        where c.subject_staff_id = cs.id and c.stage not in ('closed', 'withdrawn')
      ),
      'soonest_expiry', least(cs.license_expires_at,
                              case when cs.indemnity_exempt then null else cs.indemnity_expires_at end)
    ) as x
    from public.clinical_staff cs
    where cs.active
  ) s;

  return jsonb_build_object(
    'ladder', v_ladder,
    'generated_at', now(),
    'providers', v_rows
  );
end;
$$;

comment on function public.provider_credential_monitor() is
  '§29.6 credential monitor across the active roster: licence, indemnity (or not_applicable when exempt), attestation, live restriction id+stage, open complaint count. Returns {} to a caller who is not admin/Clinical Director. A missing expiry date reports as not_recorded — never as expired.';

do $$
begin
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'provider_credential_monitor'
      and pg_get_functiondef(p.oid) like '%restriction_id%'
  ) then
    raise exception 'FAIL: provider_credential_monitor was not updated to expose restriction_id';
  end if;
  raise notice 'PASS: provider_credential_monitor now exposes restriction_id alongside restriction_stage';
end $$;

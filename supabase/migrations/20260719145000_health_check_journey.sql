-- Tarragon Health — Health Check guided journey (AHC pathway §5)
--
-- The preventive "front door": one guided flow (Prepare → Measure → Screen →
-- Review → Act) composing the screening/vitals/vaccination/risk surfaces the
-- platform already has, tracked on the pre-existing annual_health_checks stub
-- (never used until now). Open to everyone — the prevention entry point — and
-- deliberately distinct from the paid "Annual Review" chronic orchestration.
--
-- Adds the doctor "Review & communicate" attribution (§5 stage 4, owner:
-- doctor) and a caller-scoped opener so a patient can start their own yearly
-- check (annual_health_checks is otherwise staff-insert only).

alter table public.annual_health_checks
  add column if not exists reviewed_by uuid references public.clinical_staff (id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_summary text;

-- Caller-scoped opener: ensures the current-year row exists for the signed-in
-- patient (who cannot insert annual_health_checks under RLS). Idempotent.
create or replace function public.open_health_check()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org  uuid;
  v_year integer := extract(year from (now() at time zone 'Africa/Lagos'))::int;
  v_id   uuid;
begin
  select organisation_id into v_org from public.profiles where id = auth.uid();
  if v_org is null then
    return null;
  end if;

  insert into public.annual_health_checks (organisation_id, patient_id, year, status)
  values (v_org, auth.uid(), v_year, 'pending')
  on conflict (patient_id, year) do nothing;

  select id into v_id
  from public.annual_health_checks
  where patient_id = auth.uid() and year = v_year;

  return v_id;
end;
$$;

-- The default PUBLIC execute grant keeps anon able to call this SECURITY
-- DEFINER RPC; revoking from anon alone doesn't remove it. Revoke from PUBLIC.
revoke execute on function public.open_health_check() from public;
revoke execute on function public.open_health_check() from anon;
grant execute on function public.open_health_check() to authenticated;

-- Episodic-fee rebuild — correction.
--
-- The prior entitlement rewrite (entitlement_gates_use_programme_purchases)
-- missed four live feature strings, all checked via the JSX
-- <RequiresEntitlement feature="..."> wrapper rather than a direct .rpc()
-- call, which the original audit's grep pattern did not cover:
--   clinician_review    — a doctor setting/checking in on a care plan on a
--                          schedule (care/page.tsx)
--   doctor_checkin       — scheduled doctor check-in ((sections)/page.tsx)
--   async_doctor_visit    — "ask a doctor" written Q&A (care/page.tsx)
--   health_education      — personalised clinician-reviewed learning
--                            (learn/page.tsx)
-- Left un-added, these silently returned false for every patient after the
-- prior migration — a real regression, not a design choice. All four join
-- vitals_red_flag_doctor_escalation/lifestyle_coaching/quarterly_report/
-- ai_coach on the same basis: bundled into an active programme purchase,
-- preserving each one's exact pre-existing shape (no paid plan -> no access).

create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education'
  ) then
    return exists (
      select 1
      from public.programme_purchases pp
      where pp.patient_id = p_patient_id
        and pp.status = 'active'
        and pp.ends_at >= current_date
    );
  end if;

  return false;
end;
$$;

do $$
begin
  if not (
    private.patient_has_feature_access(gen_random_uuid(), 'health_education') is not distinct from false
  ) then
    raise exception 'FAIL: sanity check on rewritten function did not run';
  end if;
end $$;

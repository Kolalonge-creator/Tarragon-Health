-- Two tiers, nothing between, part 2 (founder 2026-10-12): the last two add-on products are folded into Membership.
--
--   * ai_coach_daily_pass_30d (a higher daily AI coach limit) and continuous_monitoring_90d (clinician review of continuous data) stop
--     being sold. Rows, prices and history stay; a CHECK keeps them off (the constraint from 20261012185805 is widened to name them and
--     the old monitoring tiers). LIVE COUNTS BEFORE (read-only, 2026-10-12): service_purchases of ai_coach_daily_pass_30d 0, of
--     continuous_monitoring_90d 0, of the older continuous_monitoring_3m 1 (already inactive, honoured). A pass someone holds is honoured
--     until it expires: patient_has_feature_access and get_ai_coach_daily_limit read service_purchases, never service_products.is_active.
--   * The AI coach stays FREE for everyone: 'ai_coach' is in the free feature list and the global ai_coach_access_rules limit is the free
--     limit; nothing here touches either.
--   * Continuous monitoring (clinician review of continuous data) becomes a Member benefit: private.patient_has_feature_access now
--     answers true to the doctor-time features the monitoring product carried when private.patient_is_member is true (the grace
--     included). 'async_doctor_visit' is deliberately left out: patient_is_member itself consults it for the legacy plan, so including it
--     would recurse. This function is also redefined by the Free red-event branch (two-tier/free-red-path, migration 20261012181053)
--     for 'vitals_red_flag_doctor_escalation' (fail closed toward paging); that behaviour is carried here unchanged so that whichever
--     of the two migrations sorts last leaves the same function.
--   * "Is a Member" has ONE definition with a point-in-time form: private.patient_is_member_at(patient, at). private.patient_is_member
--     is that at now() plus the legacy plan feature; private.risk_is_current_member (the only helper that read patient_memberships by
--     date) now calls it, so the grace applies everywhere. The other readers of patient_memberships use the start date only (outcome
--     anchors), the "active" state (list/grant/end) or deliberately allow renewal during the grace (create_order).

-- ---------------------------------------------------------------------------
-- A. Non-sellable
-- ---------------------------------------------------------------------------
update public.service_products set is_active = false
 where is_active and code in ('ai_coach_daily_pass_30d', 'continuous_monitoring_90d');
alter table public.service_products drop constraint service_products_doctor_time_not_sellable;
alter table public.service_products add constraint service_products_doctor_time_not_sellable
  check (code !~ '(_credit$|^verified_document|^chronic_doctor_supported_pack$|^written_result_interpretation$|^preventive_health_check_review$|^ai_coach_daily_pass_30d$|^continuous_monitoring_)'
         or not is_active);

-- create or replace keeps each function's existing privileges; none is granted or revoked here.
-- ---------------------------------------------------------------------------
-- B. One Member function, with a point in time
-- ---------------------------------------------------------------------------
create function private.patient_is_member_at(p_patient uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m
                  where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= p_at
                    and (m.ends_at is null or m.ends_at + make_interval(days => private.membership_grace_days()) > p_at));
$$;
revoke all on function private.patient_is_member_at(uuid, timestamptz) from public, anon, authenticated;

create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.patient_is_member_at(p_patient, now())
      or private.patient_has_feature_access(p_patient, 'async_doctor_visit');
$$;

create or replace function private.risk_is_current_member(p_patient uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.patient_is_member_at(p_patient, p_at)
      or exists (select 1 from public.entitlements e
                  where e.patient_id = p_patient and e.kind = 'care_pack' and e.state = 'active'
                    and e.starts_at <= p_at and (e.ends_at is null or e.ends_at > p_at))
$$;

-- ---------------------------------------------------------------------------
-- C. Continuous monitoring and the doctor-time features are Member benefits
-- ---------------------------------------------------------------------------
create or replace function private.patient_has_feature_access(p_patient_id uuid, p_feature text)
returns boolean
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  -- Free to everyone, signed in or not yet subscribed to anything. No clinician time. (The AI coach is here: it stays free.)
  if p_feature in (
    'health_education', 'lifestyle_coaching', 'ai_coach', 'quarterly_report',
    'prevention_coordination', 'lab_coordination', 'medication_refills',
    -- legacy free_pack keys; nothing reads them, kept so an old row stays truthful
    'tracking', 'reminders', 'education'
  ) then
    return true;
  end if;

  -- Two-tier: a Member has the doctor-time features, the continuous monitoring review among them. The membership test is wrapped so
  -- that an error while working it out answers "yes" for the red-event feature (page), never "no"; for the others it falls through.
  -- async_doctor_visit is NOT here: patient_is_member reads it for the legacy plan, so it would recurse.
  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'chronic_doctor_supported_track', 'clinician_review', 'doctor_checkin',
    'multi_condition_review', 'result_document_review', 'annual_review'
  ) then
    begin
      if p_patient_id is null and p_feature = 'vitals_red_flag_doctor_escalation' then return true; end if;
      if p_patient_id is not null and private.patient_is_member(p_patient_id) then return true; end if;
    exception when others then
      if p_feature = 'vitals_red_flag_doctor_escalation' then return true; end if;
    end;
  end if;

  select role into v_role from public.profiles where id = p_patient_id;

  if v_role = 'admin' then
    return true;
  end if;

  -- A purchase still held (including the retired monitoring and AI coach products) is honoured until it expires.
  if exists (
    select 1
    from public.service_purchases sp
    join public.service_products p on p.id = sp.service_product_id
    where sp.patient_id = p_patient_id
      and sp.status = 'active'
      and (sp.expires_at is null or sp.expires_at > now())
      and p_feature = any(p.features)
  ) then
    return true;
  end if;

  if p_feature in (
    'vitals_red_flag_doctor_escalation', 'lifestyle_coaching', 'quarterly_report', 'ai_coach',
    'clinician_review', 'doctor_checkin', 'async_doctor_visit', 'health_education',
    'chronic_doctor_supported_track', 'multi_condition_review', 'result_document_review',
    'annual_review'
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

-- ---------------------------------------------------------------------------
-- Self-check
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.service_products where is_active and code ~ '(^ai_coach_daily_pass_30d$|^continuous_monitoring_)') then
    raise exception 'two-tier: an add-on product is still for sale';
  end if;
  begin
    update public.service_products set is_active = true where code = 'ai_coach_daily_pass_30d';
    if found then raise exception 'two-tier: the constraint did not refuse re-enabling the AI coach pass'; end if;
  exception when check_violation then null;
  end;
  if private.patient_has_feature_access(null, 'ai_coach') is not true then raise exception 'two-tier: the AI coach is no longer free'; end if;
  if has_function_privilege('anon', 'private.patient_is_member_at(uuid,timestamptz)', 'EXECUTE') then
    raise exception 'two-tier: anon can execute a private function';
  end if;
end $$;

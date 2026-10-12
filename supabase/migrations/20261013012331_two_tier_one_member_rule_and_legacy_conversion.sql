-- Two-tier decisions, 2026-10-12, item 2: LEGACY PROGRAMME HOLDERS become real Memberships, and "Member" has exactly one meaning.
--
-- Until now private.patient_is_member also answered true for anyone whose plan carried the legacy 'async_doctor_visit' feature (a
-- programme_purchases row, or a service purchase of a product carrying it). That made a second, permanent-looking way to be a Member
-- (and made every admin-role profile a Member, because patient_has_feature_access answers true for an admin). This migration:
--   1. converts every such holder to a real patient_memberships row (source 'legacy_conversion', state 'active', starts_at = now,
--      ends_at = their own legacy end: programme_purchases.ends_at (end of that day, Africa/Lagos) or service_purchases.expires_at;
--      the latest of several). NO free year is given. A holder with an active purchase and no end date at all would get now + 90
--      days; that case is marked below for founder review. The follow-up entitlement rows come from the existing membership trigger,
--      and each conversion writes one audit_log row. The conversion function is idempotent: a patient who already has an active
--      membership is skipped, so running it twice converts nobody twice.
--   2. removes the async_doctor_visit clause from patient_is_member / patient_is_member_at: a Member is a person with an active
--      Membership year plus the 14 day grace after it ends naturally. Only a profile whose role is 'patient' can be a Member.
--   3. adds 'legacy_conversion' to the patient_memberships source CHECK.
-- LIVE COUNTS BEFORE (read-only, 2026-10-12): programme_purchases active 0 (any end date 0); service_purchases active, unexpired,
--   whose product carries vitals_red_flag_doctor_escalation or async_doctor_visit: 1, with no end date 0; patient_memberships
--   active 0. So at most one person is converted live, with their own expires_at; no row falls back to the 90 day default.
-- Callers re-checked (all read private.patient_is_member, none reads the legacy clause any more): patient_has_feature_access (Member
--   block), patient_may_page_doctor (the red-event gate), offer_followup_slots / pick_followup_slot, the testing-day booking and
--   check-in functions, risk_is_current_member (through patient_is_member_at), my_membership (reads the table directly).
-- ROLLBACK: restore the 20261013010949 bodies of the two functions; delete from patient_memberships where source = 'legacy_conversion'
--   (their entitlement rows cascade); re-create the source CHECK without the value.

alter table public.patient_memberships drop constraint patient_memberships_source_check;
alter table public.patient_memberships add constraint patient_memberships_source_check
  check (source in ('purchase', 'voucher', 'employer', 'granted', 'legacy_conversion'));

create or replace function private.patient_is_member_at(p_patient uuid, p_at timestamptz) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.patient_memberships m
                   join public.profiles pr on pr.id = m.patient_id and pr.role = 'patient'
                  where m.patient_id = p_patient and m.state = 'active' and m.starts_at <= p_at
                    and (m.ends_at is null or m.ends_at + make_interval(days => private.membership_grace_days()) > p_at));
$$;

create or replace function private.patient_is_member(p_patient uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select private.patient_is_member_at(p_patient, now()) $$;

create function private.convert_legacy_programme_holders() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  r record;
  v_id uuid;
  n integer := 0;
begin
  for r in
    select x.patient_id, pr.organisation_id, coalesce(pr.is_test, false) as is_test,
           max(x.ends) filter (where x.ends is not null) as ends_at,
           bool_and(x.ends is null) as no_end_date
      from (
        select pp.patient_id, ((pp.ends_at + 1)::timestamp at time zone 'Africa/Lagos') as ends
          from public.programme_purchases pp
         where pp.status = 'active' and pp.ends_at >= current_date
        union all
        select sp.patient_id, sp.expires_at
          from public.service_purchases sp
          join public.service_products p on p.id = sp.service_product_id
         where sp.status = 'active' and (sp.expires_at is null or sp.expires_at > now())
           and p.features && array['vitals_red_flag_doctor_escalation', 'async_doctor_visit']
      ) x
      join public.profiles pr on pr.id = x.patient_id and pr.role = 'patient'
     where not exists (select 1 from public.patient_memberships m where m.patient_id = x.patient_id and m.state = 'active')
     group by x.patient_id, pr.organisation_id, pr.is_test
  loop
    insert into public.patient_memberships (organisation_id, patient_id, source, state, starts_at, ends_at, is_test)
    values (r.organisation_id, r.patient_id, 'legacy_conversion', 'active', now(),
            case when r.no_end_date then now() + interval '90 days' else r.ends_at end, r.is_test)
    returning id into v_id;
    insert into public.audit_log (organisation_id, actor_id, action, entity_type, entity_id, event)
    values (r.organisation_id, null, 'membership.legacy_conversion', 'patient_memberships', v_id,
            jsonb_build_object('no_end_date_default_90_days', r.no_end_date));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function private.convert_legacy_programme_holders() from public, anon, authenticated;

select private.convert_legacy_programme_holders();

do $$
begin
  if pg_get_functiondef('private.patient_is_member(uuid)'::regprocedure) ilike '%async_doctor_visit%'
     or pg_get_functiondef('private.patient_is_member_at(uuid, timestamptz)'::regprocedure) ilike '%async_doctor_visit%' then
    raise exception 'two-tier: patient_is_member still reads the legacy feature';
  end if;
  if has_function_privilege('anon', 'private.convert_legacy_programme_holders()', 'EXECUTE') then
    raise exception 'two-tier: the conversion function is callable by anon';
  end if;
end $$;

-- Tarragon Health — Analytics Console: doctor performance (de-identified).
--
-- Per-doctor clinical throughput and responsiveness: patients attached, how many
-- cases attended, how fast they responded, and their patient panel. PRIVACY:
-- de-identified for the cross-org analyst role — the patient panel and the
-- response log show patient_number (PT-xxxx), NEVER names, and NEVER the clinical
-- response content (resolution notes / message text). A future org-scoped
-- version for clinical directors/admins can show full detail under their own RLS.
-- security definer, search_path='', is_analyst-gated.
create or replace function public.analytics_doctor_performance(
  p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_analyst() then return '{}'::jsonb; end if;
  return (
    with doctors as (
      select p.id, coalesce(p.full_name,'(unnamed)') name, p.role::text role,
             cs.id staff_id, cs.doctor_tier::text tier
      from public.profiles p
      left join public.clinical_staff cs on cs.profile_id = p.id and cs.active
      where p.role in ('clinician','doctor')
    )
    select jsonb_build_object(
      'by_doctor', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', d.name, 'role', d.role, 'tier', d.tier,
          'patients_assigned', (select count(*) from public.care_team_assignment where clinician_id = d.id),
          'escalations_reviewed', (select count(*) from public.escalations e where e.reviewed_by = d.id
             and e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)),
          'alerts_acknowledged', (select count(*) from public.clinician_alerts a where a.acknowledged_by = d.id
             and a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)),
          'meds_confirmed', (select count(*) from public.medications m where m.last_confirmed_by = d.staff_id),
          'reviews_completed', (select count(*) from public.medication_reviews r where r.reviewed_by = d.staff_id and r.completed_at is not null),
          'avg_ack_minutes', (select coalesce(round(avg(extract(epoch from (acknowledged_at-created_at))/60.0)::numeric,1),0)
             from public.clinician_alerts where acknowledged_by=d.id and acknowledged_at is not null),
          'avg_resolution_hours', (select coalesce(round(avg(extract(epoch from (reviewed_at-created_at))/3600.0)::numeric,1),0)
             from public.escalations where reviewed_by=d.id and reviewed_at is not null),
          'sla_met_pct', (select case when count(*) filter (where sla_due_at is not null)=0 then null
             else round(100.0*count(*) filter (where sla_due_at is not null and acknowledged_at is not null and acknowledged_at<=sla_due_at)
                  / count(*) filter (where sla_due_at is not null),1) end
             from public.clinician_alerts where acknowledged_by=d.id),
          'last_active_at', greatest(
             (select max(reviewed_at) from public.escalations where reviewed_by=d.id),
             (select max(acknowledged_at) from public.clinician_alerts where acknowledged_by=d.id)),
          'patient_panel', (select coalesce(jsonb_agg(pn order by pn), '[]'::jsonb)
             from (select coalesce(p2.patient_number,'PT-?') pn
                   from public.care_team_assignment cta join public.profiles p2 on p2.id=cta.patient_id
                   where cta.clinician_id=d.id order by p2.patient_number limit 200) x)
        ) order by (select count(*) from public.care_team_assignment where clinician_id=d.id) desc), '[]'::jsonb)
        from doctors d
      ),
      'recent_responses', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'doctor', doctor, 'patient', patient, 'type', type,
          'raised_at', raised_at, 'responded_at', responded_at, 'response_min', response_min) order by responded_at desc), '[]'::jsonb)
        from (
          select doc.name doctor, coalesce(p2.patient_number,'PT-?') patient, 'Escalation resolved' type,
                 e.created_at raised_at, e.reviewed_at responded_at,
                 round(extract(epoch from (e.reviewed_at-e.created_at))/60.0)::int response_min
          from public.escalations e
          join doctors doc on doc.id=e.reviewed_by
          join public.profiles p2 on p2.id=e.patient_id
          where e.reviewed_at is not null and (p_from is null or e.reviewed_at>=p_from) and (p_to is null or e.reviewed_at<=p_to)
          union all
          select doc.name, coalesce(p2.patient_number,'PT-?'), 'Alert acknowledged',
                 a.created_at, a.acknowledged_at,
                 round(extract(epoch from (a.acknowledged_at-a.created_at))/60.0)::int
          from public.clinician_alerts a
          join doctors doc on doc.id=a.acknowledged_by
          join public.profiles p2 on p2.id=a.patient_id
          where a.acknowledged_at is not null and (p_from is null or a.acknowledged_at>=p_from) and (p_to is null or a.acknowledged_at<=p_to)
          order by responded_at desc limit 100
        ) t
      )
    )
  );
end; $$;

revoke execute on function public.analytics_doctor_performance(timestamptz, timestamptz) from public, anon;
grant execute on function public.analytics_doctor_performance(timestamptz, timestamptz) to authenticated;

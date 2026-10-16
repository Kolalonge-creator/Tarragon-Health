-- S75a (second half): the view both due days read. Split out of 20261007211347_s75a_single_min_cell_enforcement.sql so it is created after S05b-g
-- (20261014233659), whose self-check requires every view over vitals_readings to filter superseded readings (correction_status IS NULL).

-- Both due days read one view. Day 90 comes from the existing private.v_bp_cohort_90d (the one place that cohort is defined and test accounts
-- are left out, which the sponsor report also reads); day 180 is the same definition for the later snapshot.
create view private.v_bp_cohort_day with (security_invoker = off) as
  select c.patient_id, 90 as day, c.anchor, c.s90 as s_due, c.s0, c.d_sys, c.d_dia, c.adh, c.adh_unavailable, c.defaulted, c.late
    from private.v_bp_cohort_90d c
  union all
  select s.patient_id, 180 as day, s.anchor_date as anchor, s.bp_status as s_due, s0.bp_status as s0,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_sys - s0.bp_avg_7d_sys end as d_sys,
         case when s.bp_status <> 'insufficient_data' and s0.bp_status is not null and s0.bp_status <> 'insufficient_data' then s.bp_avg_7d_dia - s0.bp_avg_7d_dia end as d_dia,
         s.adherence_pct::integer as adh, s.adherence_status = 'unavailable' as adh_unavailable, s.target_source = 'default' as defaulted,
         exists (select 1 from public.vitals_readings o where o.patient_id = s.patient_id and o.vital_type = 'blood_pressure' and o.correction_status is null  -- S05b-g: a superseded reading is not a reading
                    and (o.validation_status = 'valid' or coalesce(o.validation_flags, '{}'::text[]) <@ array['insufficient_context']::text[])
                    and (o.taken_at at time zone 'Africa/Lagos')::date between s.window_start and s.window_end and o.created_at > s.computed_at) as late
    from public.outcome_snapshots s
    join public.profiles pr on pr.id = s.patient_id
    left join public.outcome_snapshots s0 on s0.patient_id = s.patient_id and s0.pathway_code = s.pathway_code and s0.day = 0
   where s.pathway_code = 'bp' and s.day = 180 and not s.is_test and not coalesce(pr.is_test, false);
revoke all on private.v_bp_cohort_day from public, anon, authenticated;

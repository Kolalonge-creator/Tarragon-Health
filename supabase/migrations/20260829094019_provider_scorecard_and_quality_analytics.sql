create or replace function private.provider_quality_metric_entry(
  p_metric      public.provider_quality_metric,
  p_value       numeric,
  p_denominator integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_policy jsonb;
  v_min    integer;
  v_target numeric;
  v_warn   numeric;
  v_dir    text;
  v_status text;
begin
  if not private.provider_quality_metric_is_reportable(p_metric) then
    return null;
  end if;

  v_policy := private.provider_quality_metric_policy(p_metric);
  v_min    := coalesce((v_policy ->> 'min_denominator')::int, 1);
  v_target := (v_policy ->> 'target')::numeric;
  v_warn   := (v_policy ->> 'warning')::numeric;
  v_dir    := v_policy ->> 'direction';

  if coalesce(p_denominator, 0) = 0 then
    v_status := 'no_data';
  elsif p_denominator < v_min then
    v_status := 'insufficient_volume';
  elsif p_value is null then
    v_status := 'no_data';
  elsif v_dir = 'higher_is_better' then
    v_status := case when p_value >= v_target then 'on_target'
                     when p_value >= v_warn then 'watch'
                     else 'below_target' end;
  else
    v_status := case when p_value <= v_target then 'on_target'
                     when p_value <= v_warn then 'watch'
                     else 'below_target' end;
  end if;

  return jsonb_build_object(
    'metric', p_metric,
    'domain', v_policy ->> 'domain',
    'unit', v_policy ->> 'unit',
    'direction', v_dir,
    'target', v_target,
    'warning', v_warn,
    'min_denominator', v_min,
    'denominator', coalesce(p_denominator, 0),
    'status', v_status,
    'value', case when v_status in ('on_target', 'watch', 'below_target')
                  then round(p_value, 2) else null end,
    'note', v_policy ->> 'note'
  ) - (case when v_status in ('on_target', 'watch', 'below_target') then '' else 'value' end);
end;
$$;

comment on function private.provider_quality_metric_entry(public.provider_quality_metric, numeric, integer) is
  'Builds one scorecard entry from the active policy. Returns null for a metric that is not reportable (unconfigured, or an ungoverned clinical_quality metric — §29.1). Omits the value key entirely below min_denominator so a small sample cannot be rendered as a rate (§29.10).';

revoke all on function private.provider_quality_metric_entry(public.provider_quality_metric, numeric, integer) from public;

create or replace function public.provider_scorecard(
  p_clinical_staff_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_staff    public.clinical_staff;
  v_from     timestamptz := coalesce(p_from, now() - interval '90 days');
  v_to       timestamptz := coalesce(p_to, now());
  v_grace    integer;
  v_entries  jsonb := '[]'::jsonb;
  v_e        jsonb;

  v_terminal integer; v_completed integer; v_prov_cancel integer; v_no_show integer;
  v_started  integer; v_on_time integer;
  v_ack_n    integer; v_ack_avg numeric;
  v_esc_n    integer; v_esc_avg numeric;
  v_sla_n    integer; v_sla_met integer;
  v_note_n   integer; v_note_done integer;
  v_ref_n    integer; v_ref_doc integer;
  v_res_n    integer; v_res_ack integer;
  v_fb_total integer; v_fb_unattributed integer;
begin
  if p_clinical_staff_id is null then
    select * into v_staff from public.clinical_staff where profile_id = v_uid;
  else
    select * into v_staff from public.clinical_staff where id = p_clinical_staff_id;
  end if;

  if v_staff.id is null then
    return '{}'::jsonb;
  end if;

  if v_staff.profile_id is distinct from v_uid and not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  v_grace := coalesce(
    (private.provider_quality_metric_policy('appointment_punctuality_rate') ->> 'grace_minutes')::int, 10);

  select
    count(*) filter (where status in ('completed', 'no_show', 'cancelled', 'patient_cancelled', 'provider_cancelled')),
    count(*) filter (where status = 'completed'),
    count(*) filter (where status = 'provider_cancelled'),
    count(*) filter (where status = 'no_show'),
    count(*) filter (where started_at is not null),
    count(*) filter (where started_at is not null
                       and started_at <= scheduled_for + make_interval(mins => v_grace))
  into v_terminal, v_completed, v_prov_cancel, v_no_show, v_started, v_on_time
  from public.appointments
  where clinician_id = v_staff.profile_id
    and scheduled_for >= v_from and scheduled_for <= v_to;

  select count(*), avg(extract(epoch from (acknowledged_at - created_at)) / 60.0)
  into v_ack_n, v_ack_avg
  from public.clinician_alerts
  where acknowledged_by = v_staff.profile_id and acknowledged_at is not null
    and acknowledged_at >= v_from and acknowledged_at <= v_to;

  select count(*), avg(extract(epoch from (reviewed_at - created_at)) / 3600.0)
  into v_esc_n, v_esc_avg
  from public.escalations
  where reviewed_by = v_staff.profile_id and reviewed_at is not null
    and reviewed_at >= v_from and reviewed_at <= v_to;

  select count(*), count(*) filter (where acknowledged_at <= sla_due_at)
  into v_sla_n, v_sla_met
  from public.clinician_alerts
  where acknowledged_by = v_staff.profile_id and acknowledged_at is not null
    and sla_due_at is not null
    and acknowledged_at >= v_from and acknowledged_at <= v_to;

  select count(*), count(*) filter (where n.finalized_at is not null)
  into v_note_n, v_note_done
  from public.video_consultations vc
  left join lateral (
    select max(cen.finalized_at) as finalized_at
    from public.clinical_encounter_notes cen
    where cen.video_consultation_id = vc.id and cen.status = 'finalized'
  ) n on true
  where vc.status = 'completed'
    and coalesce(vc.ended_at, vc.scheduled_at) >= v_from
    and coalesce(vc.ended_at, vc.scheduled_at) <= v_to
    and private.video_consultation_clinician(vc.id) = v_staff.profile_id;

  select count(*), count(*) filter (where coalesce(btrim(referral_reason), '') <> '')
  into v_ref_n, v_ref_doc
  from public.specialist_referrals
  where set_by = v_staff.profile_id
    and created_at >= v_from and created_at <= v_to;

  select count(*), count(*) filter (where acknowledged_at is not null)
  into v_res_n, v_res_ack
  from public.clinician_alerts
  where responsible_clinician_id = v_staff.id
    and created_at >= v_from and created_at <= v_to;

  for v_e in
    select e from unnest(array[
      private.provider_quality_metric_entry('appointment_completion_rate',
        case when v_terminal > 0 then 100.0 * v_completed / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('provider_cancellation_rate',
        case when v_terminal > 0 then 100.0 * v_prov_cancel / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('patient_no_show_rate',
        case when v_terminal > 0 then 100.0 * v_no_show / v_terminal end, v_terminal),
      private.provider_quality_metric_entry('appointment_punctuality_rate',
        case when v_started > 0 then 100.0 * v_on_time / v_started end, v_started),
      private.provider_quality_metric_entry('alert_response_minutes', v_ack_avg, v_ack_n),
      private.provider_quality_metric_entry('escalation_resolution_hours', v_esc_avg, v_esc_n),
      private.provider_quality_metric_entry('alert_sla_met_rate',
        case when v_sla_n > 0 then 100.0 * v_sla_met / v_sla_n end, v_sla_n),
      private.provider_quality_metric_entry('encounter_note_completion_rate',
        case when v_note_n > 0 then 100.0 * v_note_done / v_note_n end, v_note_n),
      private.provider_quality_metric_entry('referral_documentation_rate',
        case when v_ref_n > 0 then 100.0 * v_ref_doc / v_ref_n end, v_ref_n),
      private.provider_quality_metric_entry('result_acknowledgement_rate',
        case when v_res_n > 0 then 100.0 * v_res_ack / v_res_n end, v_res_n)
    ]) as e
    where e is not null
  loop
    v_entries := v_entries || v_e;
  end loop;

  for v_e in
    select private.provider_quality_metric_entry(m.metric, m.avg_rating, m.n)
    from (
      select 'experience_punctuality'::public.provider_quality_metric as metric,
             avg(punctuality_rating)::numeric as avg_rating,
             count(punctuality_rating)::int as n
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_communication', avg(communication_rating)::numeric, count(communication_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_professionalism', avg(professionalism_rating)::numeric, count(professionalism_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
      union all
      select 'experience_overall', avg(overall_rating)::numeric, count(overall_rating)::int
      from public.consultation_feedback
      where clinician_id = v_staff.profile_id and created_at >= v_from and created_at <= v_to
    ) m
    where private.provider_quality_metric_entry(m.metric, m.avg_rating, m.n) is not null
  loop
    v_entries := v_entries || v_e;
  end loop;

  select count(*), count(*) filter (where clinician_id is null)
  into v_fb_total, v_fb_unattributed
  from public.consultation_feedback
  where organisation_id = v_staff.organisation_id
    and created_at >= v_from and created_at <= v_to;

  return jsonb_build_object(
    'provider', jsonb_build_object(
      'clinical_staff_id', v_staff.id,
      'full_name', v_staff.full_name,
      'doctor_tier', v_staff.doctor_tier,
      'is_clinical_director', v_staff.is_clinical_director,
      'specialty', v_staff.specialty,
      'active', v_staff.active
    ),
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'policy', (
      select jsonb_build_object('version', version, 'signed', approved_at is not null,
                                'approved_at', approved_at)
      from public.provider_quality_policy where is_active limit 1
    ),
    'domains', jsonb_build_object(
      'operational', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                      from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'operational'),
      'documentation', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                        from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'documentation'),
      'patient_experience', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                             from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'patient_experience'),
      'clinical_quality', (select coalesce(jsonb_agg(e), '[]'::jsonb)
                           from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'clinical_quality')
    ),
    'clinical_quality_reported', exists (
      select 1 from jsonb_array_elements(v_entries) e where e ->> 'domain' = 'clinical_quality'
    ),
    'clinical_quality_note',
      'Clinical quality indicators are reported only where the measure has been validated and signed off in clinical governance (§29.1). None currently are, so this domain is empty rather than estimated.',
    'attribution', jsonb_build_object(
      'feedback_total', v_fb_total,
      'feedback_unattributed', v_fb_unattributed,
      'feedback_unattributed_pct',
        case when v_fb_total > 0 then round(100.0 * v_fb_unattributed / v_fb_total, 1) end,
      'referrals_partial_attribution', true
    ),
    'credentials', jsonb_build_object(
      'license_expires_at', v_staff.license_expires_at,
      'indemnity_expires_at', case when v_staff.indemnity_exempt then null else v_staff.indemnity_expires_at end,
      'indemnity_exempt', v_staff.indemnity_exempt,
      'attestation_current', private.has_current_attestation(v_staff.id),
      'work_restricted', private.provider_work_restricted(v_staff.id),
      'restriction_stage', (
        select r.stage from public.provider_restrictions r
        where r.clinical_staff_id = v_staff.id and r.lifted_at is null
        order by array_position(
          array['warning', 'grace_period', 'service_restriction', 'suspension']::text[], r.stage::text) desc
        limit 1)
    ),
    'open_complaints', (
      select count(*) from public.provider_complaints
      where subject_staff_id = v_staff.id and stage not in ('closed', 'withdrawn')),
    'open_interventions', (
      select count(*) from public.provider_interventions
      where clinical_staff_id = v_staff.id and status in ('open', 'in_progress')),
    'suggested_interventions',
      coalesce(private.provider_quality_policy_config() -> 'intervention_triggers', '[]'::jsonb)
  );
end;
$$;

comment on function public.provider_scorecard(uuid, timestamptz, timestamptz) is
  '§29.2 provider scorecard: domain-separated metrics, each with its denominator, target and status. Self-scoped by default; another provider''s card requires admin/Clinical Director. Deliberately returns NO composite score, NO ranking, and no value at all for a metric below its min_denominator (§29.10). The clinical_quality domain is empty until a Clinical Director signs a policy version marking a measure clinically_governed (§29.1/§29.3).';

revoke execute on function public.provider_scorecard(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.provider_scorecard(uuid, timestamptz, timestamptz) to authenticated;

create or replace function public.provider_quality_network_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz := coalesce(p_from, now() - interval '90 days');
  v_to   timestamptz := coalesce(p_to, now());
  v_cards jsonb;
begin
  if not private.is_complaints_handler() then
    return '{}'::jsonb;
  end if;

  select coalesce(jsonb_agg(public.provider_scorecard(cs.id, v_from, v_to)), '[]'::jsonb)
  into v_cards
  from public.clinical_staff cs
  where cs.active;

  return jsonb_build_object(
    'period', jsonb_build_object('from', v_from, 'to', v_to),
    'provider_count', jsonb_array_length(v_cards),

    'metric_health', (
      select coalesce(jsonb_agg(m), '[]'::jsonb) from (
        select jsonb_build_object(
          'metric', e ->> 'metric',
          'domain', e ->> 'domain',
          'unit', e ->> 'unit',
          'target', (e ->> 'target')::numeric,
          'on_target', count(*) filter (where e ->> 'status' = 'on_target'),
          'watch', count(*) filter (where e ->> 'status' = 'watch'),
          'below_target', count(*) filter (where e ->> 'status' = 'below_target'),
          'insufficient_volume', count(*) filter (where e ->> 'status' = 'insufficient_volume'),
          'no_data', count(*) filter (where e ->> 'status' = 'no_data'),
          'median_value', percentile_cont(0.5) within group (
            order by (e ->> 'value')::numeric) filter (where e ? 'value')
        ) as m
        from jsonb_array_elements(v_cards) card,
             jsonb_array_elements(
               (card -> 'domains' -> 'operational')
               || (card -> 'domains' -> 'documentation')
               || (card -> 'domains' -> 'patient_experience')
               || (card -> 'domains' -> 'clinical_quality')) e
        group by e ->> 'metric', e ->> 'domain', e ->> 'unit', e ->> 'target'
      ) s
    ),

    'corrective_action', jsonb_build_object(
      'complaints_by_stage', (
        select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
          select stage::text as stage, count(*) as n
          from public.provider_complaints
          where stage not in ('closed', 'withdrawn') group by stage) c),
      'complaints_upheld_in_period', (
        select count(*) from public.provider_complaints
        where outcome in ('upheld', 'partially_upheld')
          and resolved_at >= v_from and resolved_at <= v_to),
      'interventions_by_status', (
        select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
          select status::text as status, count(*) as n
          from public.provider_interventions group by status) i),
      'interventions_overdue', (
        select count(*) from public.provider_interventions
        where status in ('open', 'in_progress') and due_at is not null and due_at < now()),
      'interventions_unacknowledged', (
        select count(*) from public.provider_interventions
        where status in ('open', 'in_progress') and provider_acknowledged_at is null),
      'restrictions_live', (
        select coalesce(jsonb_object_agg(stage, n), '{}'::jsonb) from (
          select stage::text as stage, count(*) as n
          from public.provider_restrictions where lifted_at is null group by stage) r),
      'credentials_not_recorded', (
        select count(*) from public.clinical_staff
        where active and license_expires_at is null)
    ),

    'clinical_quality_reported', false,
    'clinical_quality_note',
      'No provider-level clinical quality indicator is currently validated and clinically governed, so none is reported here (§29.1/§29.3). Sign a provider_quality_policy version marking a measure clinically_governed to turn one on.',
    'providers', v_cards
  );
end;
$$;

comment on function public.provider_quality_network_summary(timestamptz, timestamptz) is
  '§29.9/§29.11 management view. Answers "where is the network performing well, where is it failing, and what corrective action is required" metric-first: a per-metric distribution of providers across statuses plus the open complaints/interventions/restrictions. Admin/Clinical Director only. Contains no provider ranking and no composite score (§29.10).';

revoke execute on function public.provider_quality_network_summary(timestamptz, timestamptz) from public, anon;
grant execute on function public.provider_quality_network_summary(timestamptz, timestamptz) to authenticated;

create or replace function public.my_provider_performance(
  p_from timestamptz default null, p_to timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid      uuid := (select auth.uid());
  v_staff_id uuid;
  v_base     jsonb;
begin
  select id into v_staff_id
  from public.clinical_staff
  where profile_id = v_uid and active;

  if v_staff_id is null then
    return '{}'::jsonb;
  end if;

  v_base := jsonb_build_object(
    'patients_assigned', (
      select count(*) from public.care_team_assignment where clinician_id = v_uid
    ),
    'escalations_reviewed', (
      select count(*) from public.escalations
      where reviewed_by = v_uid and reviewed_at is not null
        and (p_from is null or reviewed_at >= p_from) and (p_to is null or reviewed_at <= p_to)
    ),
    'alerts_acknowledged', (
      select count(*) from public.clinician_alerts
      where acknowledged_by = v_uid and acknowledged_at is not null
        and (p_from is null or acknowledged_at >= p_from) and (p_to is null or acknowledged_at <= p_to)
    ),
    'meds_confirmed', (
      select count(*) from public.medications where last_confirmed_by = v_staff_id
    ),
    'reviews_completed', (
      select count(*) from public.medication_reviews
      where reviewed_by = v_staff_id and completed_at is not null
    ),
    'avg_ack_minutes', (
      select coalesce(round(avg(extract(epoch from (acknowledged_at - created_at)) / 60.0)::numeric, 1), 0)
      from public.clinician_alerts
      where acknowledged_by = v_uid and acknowledged_at is not null
    ),
    'avg_resolution_hours', (
      select coalesce(round(avg(extract(epoch from (reviewed_at - created_at)) / 3600.0)::numeric, 1), 0)
      from public.escalations
      where reviewed_by = v_uid and reviewed_at is not null
    ),
    'sla_met_pct', (
      select case when count(*) filter (where sla_due_at is not null) = 0 then null
        else round(100.0 * count(*) filter (
               where sla_due_at is not null and acknowledged_at is not null and acknowledged_at <= sla_due_at
             ) / count(*) filter (where sla_due_at is not null), 1) end
      from public.clinician_alerts
      where acknowledged_by = v_uid
    ),
    'pending_results', (
      select count(*) from public.clinician_alerts a
      join public.care_team_assignment cta on cta.patient_id = a.patient_id
      where cta.clinician_id = v_uid and a.status = 'open'
    ),
    'consultations_completed', (
      select count(*) from public.appointments
      where clinician_id = v_uid and status = 'completed'
        and (p_from is null or scheduled_for >= p_from) and (p_to is null or scheduled_for <= p_to)
    ),
    'consultations_cancelled', (
      select count(*) from public.appointments
      where clinician_id = v_uid and status in ('cancelled', 'no_show')
        and (p_from is null or scheduled_for >= p_from) and (p_to is null or scheduled_for <= p_to)
    ),
    'referrals_made', (
      select count(*) from public.specialist_referrals
      where set_by = v_uid
        and (p_from is null or created_at >= p_from) and (p_to is null or created_at <= p_to)
    ),
    'referrals_partial_attribution', true,
    'revenue_applicable', false
  );

  return v_base || jsonb_build_object(
    'patient_feedback_available', exists (
      select 1 from public.consultation_feedback where clinician_id = v_uid
    )
  );
end; $$;

comment on function public.my_provider_performance(timestamptz, timestamptz) is
  'Self-scoped clinician activity dashboard (Care Team / Provider Workspace §5.21). An activity feed, NOT the §29.2 scorecard — see public.provider_scorecard for measured-against-target figures with denominators and governance gating. patient_feedback_available is now computed rather than hardcoded (§29.4 feedback gained clinician attribution in 20260829091744).';

do $$
declare
  v_src text;
  v_card jsonb;
  v_e jsonb;
begin
  v_src := pg_get_functiondef('public.provider_scorecard(uuid, timestamptz, timestamptz)'::regprocedure)
        || pg_get_functiondef('public.provider_quality_network_summary(timestamptz, timestamptz)'::regprocedure);

  if v_src ~* '''(overall_score|composite|provider_score|quality_score|rank|grade|percentile_rank)''' then
    raise exception 'FAIL: the provider scorecard emits a composite/ranking key — §29.10 forbids collapsing domains into one provider score';
  end if;

  v_e := private.provider_quality_metric_entry('appointment_completion_rate', 100.0, 3);
  if v_e ->> 'status' <> 'insufficient_volume' then
    raise exception 'FAIL: a 3-appointment sample was not marked insufficient_volume';
  end if;
  if v_e ? 'value' then
    raise exception 'FAIL: a below-min_denominator entry still carries a value key — a client could render it as a rate';
  end if;

  v_e := private.provider_quality_metric_entry('appointment_completion_rate', 100.0, 40);
  if v_e ->> 'status' <> 'on_target' or not (v_e ? 'value') then
    raise exception 'FAIL: a 40-appointment sample at 100%% was not reported — the volume rule is over-suppressing';
  end if;

  v_e := private.provider_quality_metric_entry('provider_cancellation_rate', 40.0, 40);
  if v_e ->> 'status' <> 'below_target' then
    raise exception 'FAIL: a 40%% provider cancellation rate was not flagged below_target — direction is being ignored';
  end if;

  if private.provider_quality_metric_entry('guideline_adherence_rate', 95.0, 100) is not null then
    raise exception 'FAIL: an ungoverned clinical_quality metric produced a scorecard entry';
  end if;

  v_card := public.provider_scorecard(null, now() - interval '30 days', now());
  if v_card is null then
    raise exception 'FAIL: provider_scorecard returned SQL NULL rather than an empty document';
  end if;

  if has_function_privilege('anon', 'public.provider_scorecard(uuid, timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute provider_scorecard';
  end if;
  if has_function_privilege('anon', 'public.provider_quality_network_summary(timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: anon can execute provider_quality_network_summary';
  end if;
  if not has_function_privilege('authenticated', 'public.provider_scorecard(uuid, timestamptz, timestamptz)', 'EXECUTE') then
    raise exception 'FAIL: authenticated cannot execute provider_scorecard';
  end if;

  raise notice 'PASS: §29.2 scorecard — domain-separated, no composite (asserted), small samples withhold the value (proven, with control), ungoverned clinical quality excluded; §29.9/§29.11 network summary is metric-first';
end $$;

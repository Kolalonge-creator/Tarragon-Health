-- S12b: (1) a shadow divergence report and (3) the cuff type on a blood pressure reading.
--
-- (1) While the draft triage rule set runs in shadow (OQ-88), the CMO needs evidence before signing: where
--     does the draft disagree with what the live pipeline does today? public.triage_shadow_divergence() counts
--     shadow triage_events against private.classify_bp_level on the same reading (the live bands, OQ-67);
--     public.triage_shadow_disagreements() lists the readings where exactly one side calls it urgent, ids only.
--     "Urgent" means live emergency or red, and shadow red. The dangerous row is live_only_urgent (the draft
--     would have missed something the live pipeline escalates). Limits, stated on the function: it compares
--     blood pressure bands, not symptoms (the live check also reads symptoms), and not what clinicians then did.
--     Aggregates carry no patient id; the disagreement list carries event and reading ids only. Admin or the
--     active clinical director; test accounts excluded (INV-13).
-- (3) vitals_readings.cuff_type: upper_arm, wrist or not_sure, optional. Many home cuffs are wrist or
--     unvalidated; a clinician reading a trend needs to know. Nullable, no default, no existing row changes.

alter table public.vitals_readings
  add column if not exists cuff_type text;
alter table public.vitals_readings
  add constraint vitals_readings_cuff_type_check check (cuff_type is null or cuff_type in ('upper_arm', 'wrist', 'not_sure'));
comment on column public.vitals_readings.cuff_type is 'S12b: what the patient measured with (upper_arm, wrist, not_sure). Optional; null when not recorded.';

create or replace function private.triage_divergence_rows(p_days integer)
returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, created_at timestamptz, divergence text)
language sql stable security definer set search_path = '' as $$
  select e.id, e.trigger_id, e.grade, e.rule_id, private.classify_bp_level(v.systolic::int, v.diastolic::int), e.created_at,
    case
      when e.grade = 'red' and private.classify_bp_level(v.systolic::int, v.diastolic::int) in ('emergency', 'red') then 'both_urgent'
      when e.grade = 'red' then 'shadow_only_urgent'
      when private.classify_bp_level(v.systolic::int, v.diastolic::int) in ('emergency', 'red') then 'live_only_urgent'
      else 'neither_urgent'
    end
  from public.triage_events e
  join public.vitals_readings v on v.id = e.trigger_id
  where e.trigger_type = 'observation' and e.shadow and not e.is_test
    and e.created_at >= now() - make_interval(days => greatest(1, least(p_days, 365)));
$$;

create or replace function public.triage_shadow_divergence(p_days integer default 30)
returns table (divergence text, shadow_grade text, live_level text, readings bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.divergence, d.shadow_grade, d.live_level, count(*)
    from private.triage_divergence_rows(p_days) d
    group by d.divergence, d.shadow_grade, d.live_level
    order by d.divergence, d.shadow_grade, d.live_level;
end $$;
comment on function public.triage_shadow_divergence(integer) is 'S12b: counts of shadow triage grades against the live blood pressure bands, by divergence class. Aggregates only. Compares BP bands, not symptoms or clinician action. Admin or active clinical director.';

create or replace function public.triage_shadow_disagreements(p_days integer default 30, p_limit integer default 200)
returns table (triage_event_id uuid, observation_id uuid, shadow_grade text, shadow_rule_id text, live_level text, divergence text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (private.is_admin() or private.is_active_clinical_director()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return query
    select d.triage_event_id, d.observation_id, d.shadow_grade, d.shadow_rule_id, d.live_level, d.divergence, d.created_at
    from private.triage_divergence_rows(p_days) d
    where d.divergence in ('live_only_urgent', 'shadow_only_urgent')
    order by (d.divergence = 'live_only_urgent') desc, d.created_at desc
    limit greatest(1, least(p_limit, 1000));
end $$;
comment on function public.triage_shadow_disagreements(integer, integer) is 'S12b: readings where exactly one of the draft rule set and the live bands calls it urgent. Ids only. Live-only urgent first (the draft would have missed it). Admin or active clinical director.';

revoke all on function private.triage_divergence_rows(integer) from public, anon, authenticated;
revoke all on function public.triage_shadow_divergence(integer) from public, anon;
revoke all on function public.triage_shadow_disagreements(integer, integer) from public, anon;
grant execute on function public.triage_shadow_divergence(integer) to authenticated, service_role;
grant execute on function public.triage_shadow_disagreements(integer, integer) to authenticated, service_role;

do $$
begin
  if has_function_privilege('anon', 'public.triage_shadow_divergence(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.triage_shadow_disagreements(integer, integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'private.triage_divergence_rows(integer)', 'EXECUTE') then
    raise exception 'S12b function grants are too wide';
  end if;
end $$;

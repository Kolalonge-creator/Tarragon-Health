-- S18 lead.rules v2 (CMO decision 2026-10-07): the weekly hours warning is 48 hours in 7 days, not 72.
-- Grounding: EU Working Time Directive 2003/88/EC (48 hour average week); the NHS 2016 contract's 72 hours in 168 is a ceiling, and
-- MDCN has no numeric rule. Every other value is unchanged from v1. v1 stays in the table as history, no longer active.
-- Counts before this migration (live): lead_config rows 1 (v1 active); the fatigue warning only reads the active row, so no data moves.
update public.lead_config set is_active = false where is_active and version = 1;

-- lead-rules-v2-begin
insert into public.lead_config (version, is_active, effective_from, rules) values (2, true, '2026-10-07', $json$
{
  "max_lead_patients": 60,
  "lead_min_doctor_tier": "senior_medical_officer",
  "required_competencies": ["lead_clinician", "hypertension"],
  "block_min_hours": 2,
  "minimum_guarantee_kinds": ["queue", "on_call"],
  "rota_max_shift_hours": 24,
  "rota_horizon_days": 14,
  "gap_alert_hours": 48,
  "min_eligible_on_call": 2,
  "fatigue_min_rest_hours": 11,
  "fatigue_max_consecutive_days": 7,
  "fatigue_max_shifts_per_7_days": 3,
  "fatigue_max_hours_per_7_days": 48,
  "fatigue_long_shift_hours": 10,
  "fatigue_max_long_shifts_per_7_days": 4,
  "post_call_rest_hours": 8,
  "post_call_rest_min_shift_hours": 8,
  "contracted_needs_declared_hours": true,
  "contracted_min_declared_hours_per_week": 10,
  "swap_urgent_hours": 4,
  "override_reason_min_chars": 10
}
$json$::jsonb);
-- lead-rules-v2-end

do $$
begin
  if (select count(*) from public.lead_config where is_active) <> 1 then raise exception 'lead_config must have exactly one active version'; end if;
  if (select version from public.lead_config where is_active) <> 2 then raise exception 'lead_config v2 is not the active version'; end if;
  if private.lead_rule('fatigue_max_hours_per_7_days') #>> '{}' <> '48' then raise exception 'weekly hours cap is not 48'; end if;
end $$;

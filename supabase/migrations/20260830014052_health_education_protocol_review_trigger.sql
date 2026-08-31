-- Tarragon Health — Health Education: outdated-content detection (§79.12)
--
-- `condition_protocols`/`protocol_versions` are genuinely versioned and
-- Clinical-Director-signed (docs/MASTER_ARCHITECTURE_BLUEPRINT_GAP_ANALYSIS.md
-- §2), but nothing links a protocol version to the health_education_content
-- rows that describe it — a signed protocol change today flags zero content
-- for re-review. This migration closes that gap.
--
-- `protocol_versions.protocol_id` is free text shared across several
-- protocol families (escalation SLAs, cv_risk_config, per-condition clinical
-- protocols). The convention adopted here: a condition-level protocol's
-- `protocol_id` equals the `care_plan_condition` enum label ('hypertension',
-- 'diabetes', 'obesity', 'ckd', 'cardiovascular', 'other') — matching
-- `condition_protocols.condition` and `health_education_content.condition`
-- exactly. A protocol_versions row whose protocol_id does NOT match one of
-- these labels (e.g. an escalation-SLA or cv-risk-config signing) is safely
-- ignored — this trigger is a no-op for it, not an error.
create or replace function private.health_education_flag_content_on_protocol_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_condition public.care_plan_condition;
  v_flagged integer;
begin
  -- Only act on a genuine version bump for a condition-level protocol, and
  -- only once it's actually signed (approved_by/approved_at are not-null
  -- columns already, so every row here is signed by definition).
  if new.version_number <= 1 then
    return new; -- initial signing of a brand-new protocol; nothing to flag yet
  end if;

  begin
    v_condition := new.protocol_id::public.care_plan_condition;
  exception when invalid_text_representation then
    return new; -- not a condition-level protocol (e.g. an escalation-SLA signing) — ignore
  end;

  with flagged as (
    update public.health_education_content
    set content_status = 'review_due'
    where condition = v_condition
      and content_status in ('published')
    returning id
  )
  insert into public.health_education_content_status_history (content_id, from_status, to_status, note)
  select id, 'published', 'review_due',
    format('Protocol %s bumped to version %s (approved %s) — flagged for re-review', new.protocol_id, new.version_number, new.approved_at)
  from flagged;

  get diagnostics v_flagged = row_count;
  return new;
end;
$$;

drop trigger if exists health_education_flag_content_on_protocol_change on public.protocol_versions;
create trigger health_education_flag_content_on_protocol_change
  after insert on public.protocol_versions
  for each row execute function private.health_education_flag_content_on_protocol_change();

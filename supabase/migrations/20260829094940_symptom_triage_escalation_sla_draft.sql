-- Tarragon Health — Symptom Assessment & Triage Engine, part 2: draft
-- escalation_slas entries for the new 'symptom_triage' pathway.
--
-- The 'urgent' triage category (see part 1/3) needs an SLA for its
-- clinician_alerts insert, same as every other pathway
-- (private.escalation_sla_minutes raises loud on a missing (pathway, tier)
-- rather than guessing). Per this table's own established discipline
-- (createEscalationSlaDraftAction, apps/web/.../admin/settings/escalation-slas),
-- a numeric SLA change/addition is proposed as a new INACTIVE draft that
-- duplicates the currently-active config verbatim plus the addition — never
-- edited in place — and only takes effect once a Clinical Director signs it
-- via sign_escalation_slas(). This migration deliberately does NOT activate
-- the new version: the symptom-triage feature is already gated off by
-- triage_protocols.is_active=false (part 1), so there is no urgency to
-- force this SLA live ahead of that sign-off, and stacking two unsigned
-- clinical rulesets behind one review is cleaner than force-activating one
-- of them. See docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md's go-live checklist.
--
-- 'urgent_escalation' 60 minutes mirrors the existing bp_vitals_red_flag /
-- lpe_red_flag / obesity_ed_screen precedent for the same tier name (not
-- the 24h screening_abnormal_result meaning of that same enum value — see
-- the v1 escalation_slas migration's own note on this ambiguity).
-- 'clinician_review' 1440 minutes (24h) mirrors bp_vitals_red_flag's
-- clinician_review tier.
insert into public.escalation_slas (version, config, notes, is_active)
select
  (select coalesce(max(version), 0) + 1 from public.escalation_slas),
  active.config || '[
    {"pathway": "symptom_triage", "tier": "urgent_escalation", "sla_minutes": 60, "channel_sequence": ["push", "whatsapp_nudge"], "source_function": "private.handle_symptom_triage_assessment", "note": "Symptom Assessment & Triage Engine (platform brief §37) classified the assessment as urgent."},
    {"pathway": "symptom_triage", "tier": "clinician_review", "sla_minutes": 1440, "channel_sequence": ["push, batched"], "source_function": "private.handle_symptom_triage_assessment", "note": "Symptom Assessment & Triage Engine flagged the assessment for human clinician review (uncertain classification, platform brief §37.9), without itself being urgent/emergency."}
  ]'::jsonb,
  'Draft: adds the symptom_triage pathway (urgent_escalation, clinician_review tiers) for the new Symptom Assessment & Triage Engine. Duplicated from the then-active config plus these two entries, unsigned. Needs Clinical Director sign-off alongside triage_protocols v1 before the triage engine goes live — see docs/SYMPTOM_TRIAGE_ENGINE_SPEC.md.',
  false
from public.escalation_slas active
where active.is_active;

do $$
begin
  if not exists (
    select 1 from public.escalation_slas c, jsonb_array_elements(c.config) e
    where e->>'pathway' = 'symptom_triage' and e->>'tier' = 'urgent_escalation'
  ) then
    raise exception 'FAIL: expected a draft escalation_slas version with a symptom_triage/urgent_escalation entry';
  end if;
  raise notice 'PASS: symptom_triage escalation SLA draft entries present (unsigned)';
end $$;

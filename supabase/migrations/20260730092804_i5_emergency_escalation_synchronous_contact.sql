-- Tarragon Health
-- v3 port: I5 -- "urgent/emergency classification cannot be closed by a
-- text-only note; closure requires a linked synchronous contact (voice
-- call / video consult)." CLAUDE.md's "PORT IT IN" list; confirmed as a
-- live gap by packages/db/tests/i1_i10_invariants_platform.sql's I5 check
-- (an emergency escalation resolves today with nothing but a
-- resolution_note).
--
-- Platform equivalent of "urgent/emergency": clinician_alerts.level =
-- 'emergency' -- the highest of the four-level ladder (routine /
-- clinician_review / urgent_escalation / emergency). Scoped to 'emergency'
-- only this pass, matching the invariant test's own proven scope --
-- deliberately NOT extended to 'urgent_escalation', which is a separate,
-- real question flagged not guessed at (CLINICAL_TRUST_MODEL_SPEC's SLA
-- table treats Red/urgent and Emergency as different tiers with different
-- SLAs; widening this gate needs its own decision).
--
-- "Closed by a text-only note": escalations.status -> 'resolved'.
-- 'referred' is a different transition (forwarding to a specialist, not
-- closing the case) and is deliberately NOT gated here.
--
-- "Synchronous contact": the platform's only synchronous-contact record is
-- video_consultations (Zoom-backed). Satisfied by either:
--   (a) a video_consultations row directly linked via escalation_id -- the
--       real, already-built path (doctor/escalations/[id]/actions.ts's
--       startVirtualReview creates exactly this link), or
--   (b) a video_consultations row for the same patient with a real
--       started_at between the escalation's creation and now (covers a
--       specialist_consult-context call, or any future ad hoc synchronous
--       record for the same patient) --
-- in both cases requiring status in ('started','completed') so a merely
-- *scheduled* (never joined) or cancelled/no-show call doesn't count as
-- real contact.

create or replace function private.enforce_emergency_escalation_synchronous_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_level public.alert_level;
  v_has_contact boolean;
begin
  -- Only gate the transition INTO 'resolved'; touching an already-resolved
  -- row for an unrelated reason (e.g. a later note edit) doesn't re-check.
  if new.status is distinct from 'resolved' or old.status = 'resolved' then
    return new;
  end if;

  select level into v_level
  from public.clinician_alerts
  where id = new.clinician_alert_id;

  if v_level is distinct from 'emergency' then
    return new;
  end if;

  select exists (
    select 1
    from public.video_consultations vc
    where vc.status in ('started', 'completed')
      and (
        vc.escalation_id = new.id
        or (
          vc.patient_id = new.patient_id
          and vc.started_at is not null
          and vc.started_at between new.created_at and now()
        )
      )
  ) into v_has_contact;

  if not v_has_contact then
    raise exception 'An emergency escalation cannot be resolved with only a note -- complete a synchronous voice or video contact with the patient first (start a virtual review)' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger escalations_enforce_emergency_synchronous_contact
  before update on public.escalations
  for each row execute function private.enforce_emergency_escalation_synchronous_contact();

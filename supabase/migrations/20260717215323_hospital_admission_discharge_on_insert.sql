-- Tarragon Health — discharge review also fires when logged already-discharged
--
-- The patient-facing "log admission" form lets someone record a completed past
-- stay in one shot (both admitted_on and discharged_on filled at once) — the
-- 20260717181320 form has always supported this. private.handle_hospital_discharge()
-- (added in 20260717214814) only fired on the discharged_on null -> non-null
-- UPDATE transition, so that one-shot path never raised the discharge-review
-- prompt — only the generic admission-created alert. This adds a second trigger
-- on AFTER INSERT (when discharged_on is already set) calling the SAME handler —
-- its body never references OLD, so it works unmodified for either TG_OP.

drop trigger if exists patient_hospital_admissions_discharge_review_on_insert
  on public.patient_hospital_admissions;
create trigger patient_hospital_admissions_discharge_review_on_insert
  after insert on public.patient_hospital_admissions
  for each row
  when (new.discharged_on is not null)
  execute function private.handle_hospital_discharge();

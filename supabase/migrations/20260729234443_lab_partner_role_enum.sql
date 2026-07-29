-- Tarragon Health — Lab Partner account role (enum values)
--
-- A partner lab's OWN staff can log in to see the orders routed to their lab
-- and upload the result directly, as an alternative to the existing
-- Lab Liaison Officer path (20260720120000/20260720120100) where Tarragon's
-- own back-office staff upload a result emailed in by a lab that doesn't log
-- in. Both paths stay available side by side — a lab picks whichever suits
-- it. Modelled exactly like 'pharmacist' (20260716177000/20260716178000):
-- a partner-employee account scoped via a single FK to the partner's
-- catalogue row (lab_providers here, pharmacy_partners there), isolated
-- through SECURITY DEFINER RPCs rather than broad org-staff RLS.
--
-- New enum values must be committed before any other statement can *use*
-- them, so this lives in its own migration ahead of the surface build.
alter type public.user_role add value if not exists 'lab_partner';

-- A lab-partner-uploaded result is a new lab_result_documents source,
-- alongside the existing patient/lab_liaison/clinician/admin sources.
alter type public.lab_result_document_source add value if not exists 'lab_partner';

import type { ConsultationsLogRow } from "./consultations-log";

// The 2026-11-03 test call as public.consultations_log returned it live.
export const firstLiveCall: ConsultationsLogRow = {
  encounter_id: "c861c6bb-b3e2-4ba8-b8b5-d14e5523e691",
  call_date: "2026-11-03",
  scheduled_at: "2026-11-03T21:00:00+00:00",
  patient_id: "ce2bebd5-84d4-448d-8d36-f327c469a921",
  patient_name: "k boss",
  clinician_id: "c22fc539-23af-46e4-bf73-f799da147f10",
  clinician_name: "Kola Longe",
  status: "completed",
  media_mode: null,
  doctor_started_at: "2026-11-03T21:05:05.725135+00:00",
  finished_at: "2026-11-03T21:26:47.882337+00:00",
  doctor_minutes: 21.7,
  connected_minutes: 8.7,
  zoom_legs: 2,
  zoom_open_legs: 0,
  patient_joins: 5,
  clinician_joins: 2,
  is_test: true,
};

-- Columns the accept flow needs: who accepted, when, and which
-- video_consultations row was created for the 15-minute doctor walkthrough.
-- Mirrors video_visit_requests.accepted_by/accepted_at/video_consultation_id
-- exactly (20260723120000), minus the columns that model's slot-negotiation
-- doesn't apply here (declined_reason, proposed_*, accepted_at's sibling
-- fields) — this flow is a direct doctor-picks-a-time assignment, not a
-- slot-picker.
alter table public.lab_result_consult_requests
  add column if not exists accepted_by uuid references public.clinical_staff (id) on delete set null,
  add column if not exists accepted_at timestamptz,
  add column if not exists video_consultation_id uuid references public.video_consultations (id) on delete set null;

create index if not exists lab_result_consult_requests_accepted_by_idx
  on public.lab_result_consult_requests (accepted_by)
  where accepted_by is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'lab_result_consult_requests'
      and column_name = 'video_consultation_id'
  ) then
    raise exception 'FAIL: video_consultation_id was not added to lab_result_consult_requests';
  end if;
end $$;

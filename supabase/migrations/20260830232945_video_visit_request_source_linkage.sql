-- Tarragon Health — attribution linkage for video_visit_requests created off
-- an uploaded result's "discuss this with a doctor" CTA, or bundled inline
-- with a Synlab partner-billed lab booking.
--
-- Both columns are write-once, set only at INSERT time by the creating
-- server action (requestVideoVisit / createAndPayForPartnerLabOrder) — never
-- updated afterward, so no frozen-after-set trigger logic is needed the way
-- reviewed_by/interpretation_sent_at need one on lab_result_documents.
-- private.pin_video_visit_amount() (20260723120000_video_visit_requests.sql)
-- does not reference either column, so it passes whatever the INSERT sets
-- through unchanged, same as note/slot_id today.
--
-- Deliberately NOT a new booking table (consult_addon_orders or similar):
-- video_visit_requests already carries the real price book
-- (video_visit_prices), the real request->pay->accept->refund lifecycle, and
-- the real doctor-tier-gated accept/decline RPCs. Reusing it means a
-- consult booked off an upload or bundled with a lab order goes through
-- EXACTLY the same doctor review and refund guarantees as any other video
-- visit request on the platform, with no parallel status machine to keep in
-- sync.

alter table public.video_visit_requests
  add column source_lab_result_document_id uuid
    references public.lab_result_documents (id) on delete set null,
  add column source_lab_order_id uuid
    references public.lab_orders (id) on delete set null;

comment on column public.video_visit_requests.source_lab_result_document_id is
  'Set at insert when the patient requested this visit from an uploaded result''s "discuss with a doctor" CTA. Never updated after insert.';
comment on column public.video_visit_requests.source_lab_order_id is
  'Set at insert when this visit was bundled with a partner-billed (Synlab) lab order at booking time. Never updated after insert. Attribution only — pricing still comes from video_visit_prices via private.pin_video_visit_amount(), never derived from the linked order.';

create index video_visit_requests_source_document_idx
  on public.video_visit_requests (source_lab_result_document_id)
  where source_lab_result_document_id is not null;
create index video_visit_requests_source_lab_order_idx
  on public.video_visit_requests (source_lab_order_id)
  where source_lab_order_id is not null;

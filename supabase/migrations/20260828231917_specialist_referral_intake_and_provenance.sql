-- Tarragon Health — Specialist Referral Engine, part 4/7: referral creation
-- provenance + intake fields (task spec §11.3, §11.4).
--
-- Confirmed before writing this: the ONLY place a specialist_referrals row
-- is ever inserted today is the abnormal-result-handler Edge Function
-- (automated, Category 2->1 upgrade). There is no clinician/nurse-facing
-- "create a referral" UI anywhere, even though
-- 20260715125456_clinician_originated_orders.sql gave lab_orders/
-- pharmacy_orders an `ordered_by` column + a clinician-facing creation flow
-- for exactly this reason, and its own comment explicitly left
-- specialist_referrals out ("has always been staff/trigger-created only").
-- §11.3 of the task spec lists a Tarragon doctor/nurse and chronic-disease
-- programmes as referral originators alongside the automated paths — this
-- closes that gap. Nothing here touches specialist matching/ranking or the
-- self-arranged fulfilment model; it is purely about who created the
-- referral and what they asked for.
--
-- referred_by is nullable and NEVER inferred/backfilled, same discipline as
-- doctor_tier and every other null-gated attribution column in this
-- codebase (CLAUDE.md "What Claude Must Never Do") — existing
-- trigger-created rows simply have no referred_by, which is the honest
-- state, not a gap to paper over. It is server-derived by the new
-- create-referral server action from the acting clinician's own
-- clinical_staff row, the same trust model clinician_originated_orders
-- already established for ordered_by (RLS already restricts insert to
-- is_org_staff; a DB trigger re-deriving it would just be re-proving what
-- RLS already guarantees for an org's own staff — see that migration's own
-- comment for the precedent).
--
-- preferred_consultation_type/preferred_location capture the referral's OWN
-- ask (§11.4 "preferred consultation type", "preferred location") as a soft
-- preference on the letter — never a filter that ranks or auto-assigns a
-- specific specialist_providers row, which stays exactly as guardrailed.
--
-- parent_referral_id links a referral created because an earlier referral's
-- specialist recommended onward specialist input (§11.16
-- "specialist-to-specialist referral... chain remains linked to the
-- original care episode") — self-referencing, nullable, never inferred.

alter table public.specialist_referrals
  add column if not exists referred_by uuid references public.clinical_staff (id) on delete set null,
  add column if not exists preferred_consultation_type text
    check (preferred_consultation_type is null or preferred_consultation_type in ('telemedicine', 'in_person', 'either')),
  add column if not exists preferred_location text,
  add column if not exists parent_referral_id uuid references public.specialist_referrals (id) on delete set null;

comment on column public.specialist_referrals.referred_by is
  'The clinical_staff member who created this referral, when it was clinician-initiated (task spec §11.3/§11.4). Null for automated/trigger-created referrals (e.g. the abnormal-result-handler Edge Function) — never inferred or backfilled, same discipline as doctor_tier.';
comment on column public.specialist_referrals.preferred_consultation_type is
  'A soft preference captured on the referral itself (§11.4) — telemedicine, in_person, or either. Never used to auto-assign or rank a specialist_providers row; the matching/ranking engine stays guardrailed per CLAUDE.md.';
comment on column public.specialist_referrals.parent_referral_id is
  'Links this referral to an earlier one that prompted it (specialist-to-specialist onward referral, §11.16). Self-referencing FK; null for a referral that is its own episode''s start.';

create index if not exists specialist_referrals_referred_by_idx
  on public.specialist_referrals (referred_by) where referred_by is not null;
create index if not exists specialist_referrals_parent_referral_idx
  on public.specialist_referrals (parent_referral_id) where parent_referral_id is not null;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'specialist_referrals' and column_name = 'referred_by'
  ) then
    raise exception 'specialist_referrals.referred_by missing after migration';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'specialist_referrals' and column_name = 'parent_referral_id'
  ) then
    raise exception 'specialist_referrals.parent_referral_id missing after migration';
  end if;
  raise notice 'PASS: specialist_referrals intake/provenance columns present';
end $$;

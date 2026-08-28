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
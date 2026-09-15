-- Tarragon Health — whole-body/advanced diagnostic imaging referral (scaffold).
--
-- docs/FULL_SPECIFICATION_V4.md's competitor-teardown table lists a
-- "Prenuvo-style" whole-body MRI referral as an idea, never built. Founder
-- decision 2026-09-01: referral fee only, never owned/bundled equipment —
-- same non-bundling posture as the BP-cuff/glucometer device decision
-- (CLAUDE.md's Device & Wearable Integration section) and the same
-- self-arranged-fulfilment principle already used for labs (the patient
-- pays the imaging provider directly; Tarragon is paid for coordination +
-- the doctor's read, not a markup on the scan itself).
--
-- No imaging partner is signed yet, so this ships inactive — same
-- scaffold-first posture as ahc_full_panel and the BLE "supported devices"
-- list: the purchasable primitive is real, the price is a placeholder, and
-- nothing is offered to a patient until a real partner and price exist.
-- price_kobo is the coordination fee only — never the cost of the scan
-- itself, which is billed by the imaging partner directly and has no
-- Tarragon service_products row at all (there is nothing to sell until a
-- partner is signed).

insert into public.service_products (code, name, description, price_kobo, currency, access_duration_days, features, is_active)
values (
  'advanced_diagnostic_referral_mri',
  'Advanced Diagnostic Imaging Referral',
  'Coordination fee for a whole-body or targeted imaging referral: Tarragon identifies the right scan, connects you with an imaging partner, and a doctor reads the result against your record. You pay the imaging partner directly for the scan itself — this fee is for coordination only. No partner is signed yet.',
  0, -- placeholder — no real coordination fee until a partner is signed
  'NGN',
  90, -- single-use-style redemption window once a partner exists, matching ahc_full_panel's shape
  '{}',
  false -- inactive: no imaging partner signed yet
)
on conflict (code) do nothing;

do $$
begin
  if not exists (select 1 from public.service_products where code = 'advanced_diagnostic_referral_mri') then
    raise exception 'FAIL: advanced_diagnostic_referral_mri was not seeded';
  end if;
  if (select is_active from public.service_products where code = 'advanced_diagnostic_referral_mri') then
    raise exception 'FAIL: advanced_diagnostic_referral_mri must ship inactive — no imaging partner is signed yet';
  end if;
  raise notice 'PASS: advanced_diagnostic_referral_mri scaffolded, inactive pending a real partner';
end $$;

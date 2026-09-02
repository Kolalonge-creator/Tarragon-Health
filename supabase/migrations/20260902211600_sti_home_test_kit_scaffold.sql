-- Sexual & Reproductive Health platform — gap closure 1/3: a real, honest
-- integration point for home STI test kits (spec §47.4 — "Where home
-- testing is available through appropriate partners, the platform can
-- integrate the service").
--
-- Renamed from its original 20260829120000 timestamp during the main-dev
-- merge reconciliation (2026-09-02): that version number collided with
-- 20260829120000_wearable_granular_consent_and_patient_control, an
-- unrelated migration from a different branch that landed on main-dev
-- first and already occupies that version live. Content unchanged.
--
-- No home-test-kit partner is under contract today (confirmed: this
-- platform currently has exactly one active laboratory at all, Synlab
-- Nigeria, switched on in 20260821193144_switch_on_synlab.sql — every other
-- lab/pharmacy/home-visit/logistics partner catalogue is deliberately
-- dormant, is_active = false, "the same dormant-until-real pattern already
-- used for home_visit_providers / logistics_partners"). Building a fake or
-- placeholder home-kit checkout would misrepresent a service nobody can
-- actually fulfil — the same reasoning CLAUDE.md already applies to BP-cuff/
-- glucometer bundling and to wearable cloud-sync credentials that don't
-- exist yet: a real, honest, credential-drop-in-ready scaffold, not a fake
-- live feature.
--
-- home_visit_providers (a nurse collects a sample at your home, the sample
-- still goes to a contracted lab) already exists as separate, dormant,
-- generic infrastructure — lab_orders.home_visit_provider_id — and is NOT
-- what this column is for. A home TEST KIT is a materially different thing:
-- a self-administered test (e.g. an HIV self-test) with no clinical
-- collection step and no lab order at all. Conflating the two would
-- misrepresent both.
--
-- screen_types.home_kit_available is deliberately just a catalogue flag,
-- mirroring the imaging screen_types added in 20260802212103 (a reference
-- row with zero fulfilling lab_tests rows, shown as "not yet available"
-- until a real partner exists) — not a new provider table, order flow, or
-- price, because there is nothing yet to configure for either.

alter table public.screen_types
  add column if not exists home_kit_available boolean not null default false;

comment on column public.screen_types.home_kit_available is
  'Whether a self-administered home test kit is a clinically real option for this screen (independent of whether Tarragon has a partner to fulfil it today — see this column''s migration header). Purely informational until a home-test-kit partner exists: no order flow reads this column yet.';

update public.screen_types
set home_kit_available = true
where code in ('hiv', 'syphilis', 'chlamydia_gonorrhoea', 'hep_b', 'hep_c');

do $$
begin
  if (select count(*) from public.screen_types where home_kit_available) <> 5 then
    raise exception 'FAIL: expected exactly 5 screen_types flagged home_kit_available';
  end if;
  raise notice 'PASS: home_kit_available scaffold installed on the 5 STI-relevant screen_types';
end $$;

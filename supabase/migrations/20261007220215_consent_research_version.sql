-- Consent (S83 audit items 1.2, 1.6): a current, optional version for the `research` consent.
--
-- Of the 11 consent_type values only 4 had a current consent_versions row, so the others could be neither granted nor withdrawn through the
-- privacy screens. This adds the one whose purpose now has a real gate: S81 private.research_eligible() reads exactly this consent, and a
-- de-identified export includes only people who hold it and have not withdrawn it. The wording below says only what that gate does.
--
-- Deliberately NOT added here (nothing yet obeys them, so a withdraw switch would control nothing; see OQ-313): marketing, device_data,
-- wearable_device_data (wearables already carry per-connection consent), care, care_circle_sharing and scribe_default (the scribe asks per
-- consultation, and Care Circle has its own access grants; a second consent would be a second source of truth).
--
-- The consent is optional and off until the person chooses it. Nothing is recorded for anyone by this migration: no consent row is written.
-- Counts at write time: 0 research consent rows exist.

insert into public.consent_versions (consent_type, version, title, body, is_current, is_optional, published_at)
select 'research', '2026-10-07', 'Use my information in approved research',
  'I agree that my information may be used in research, but only research that an ethics committee has approved, and only under a written agreement with the research team. Before anything leaves Tarragon Health, my name and anything that could identify me is taken out. My information is never sold or licensed. I can stop at any time in the app. After I stop, my information is left out of any later release, but it cannot be taken back out of results that were already published. Choosing not to join changes nothing about my care.',
  true, true, now()
where not exists (select 1 from public.consent_versions where consent_type = 'research' and is_current);

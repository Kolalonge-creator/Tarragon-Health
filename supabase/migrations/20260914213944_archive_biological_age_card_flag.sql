-- Biological Age (a linear rescale of the Health Score into a fake age, no
-- biomarkers of its own, no validated methodology) is retired in favour of
-- Heart Age (see 20260914213943_heart_age_card_feature_flag.sql) — a real
-- SCORE2 risk-age conversion. Archiving rather than deleting the row
-- preserves feature-flag history as an audit trail; it was never switched
-- on ('off' since it was created), so this changes nothing observable.
update public.feature_flags
set status = 'archived'
where key = 'biological_age_card' and status = 'off';

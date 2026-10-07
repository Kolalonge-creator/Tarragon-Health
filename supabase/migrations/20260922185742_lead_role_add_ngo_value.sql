-- Adds the "ngo" lead role so an NGO/PHC/government contact-form submission
-- (the new partner offer on the Corporate marketing page, see
-- docs/FUNDING_STRATEGY.md) can be categorised correctly rather than forced
-- into "other". ALTER TYPE ... ADD VALUE cannot share a transaction with
-- anything that uses the new value, so this is its own migration.
alter type public.lead_role add value if not exists 'ngo';

-- S55 (spec 9.1): a "when to seek care" category in the Learning Centre library.
-- Separate file because ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it. No content is seeded here:
-- anything written for this category is a draft until the CMO signs it (a clinical-safety category, never AI or agent authored
-- as reviewed).
alter type public.health_education_category add value if not exists 'when_to_seek_care';

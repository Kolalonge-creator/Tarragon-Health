-- Module 20 (Health Education Platform) §20.1 — content types beyond article/video.
-- `health_education_content_type` has only ever had 'article'/'video' (20260717150000).
-- Adding the remaining spec'd types: audio, infographic, faq, quiz, interactive_module.
-- "clinician-authored content" from the same spec line is not a type — it's the existing
-- `clinician_reviewed`/`reviewed_by_name` pair on health_education_content.
--
-- Deliberately its own migration, no other statement in this file: a newly ADDed enum
-- value cannot safely be used (e.g. in a DEFAULT, an INSERT, or another DDL statement)
-- inside the same transaction it was added in.
alter type public.health_education_content_type add value if not exists 'audio';
alter type public.health_education_content_type add value if not exists 'infographic';
alter type public.health_education_content_type add value if not exists 'faq';
alter type public.health_education_content_type add value if not exists 'quiz';
alter type public.health_education_content_type add value if not exists 'interactive_module';

-- Sexual & Reproductive Health platform — gap closure 3/3, step 1/2: a new
-- health_education_category value.
--
-- 'sexual_health' as ITS OWN category rather than folding this content into
-- 'womens_health'/'mens_health' — the spec is explicit that this module "is
-- broader than the women's and men's health modules ... applicable to the
-- wider population" (§47 intro), and consent/healthy relationships are not
-- gendered topics. In its own migration because ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction that later reads the new value
-- (same reason 20260821192305_emergency_source_exposure_report.sql and
-- 20260829090200's genitourinary_medicine addition are each their own file).

do $$ begin
  alter type public.health_education_category add value if not exists 'sexual_health';
exception when duplicate_object then null; end $$;

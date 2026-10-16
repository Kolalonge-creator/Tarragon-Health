-- S68a: three more growth indicators for the WHO 2006 standards (Module 16, function 16.10).
-- ALTER TYPE ... ADD VALUE gets its own migration: a new enum value cannot be used in the transaction that adds it,
-- and S68b loads reference rows that use all three.
--   weight_for_length  : weight for recumbent length, 45 to 110 cm, children aged 0 to 24 months (WHO 2006)
--   weight_for_height  : weight for standing height, 65 to 120 cm, children aged 24 to 60 months (WHO 2006)
--   muac_for_age       : mid-upper-arm circumference for age, 3 to 59 months (WHO 2006)
-- growth_measurement_type is used by growth_reference_lms (EMPTY on every database until S68b) and by no column. Nothing else changes here.
alter type public.growth_measurement_type add value if not exists 'weight_for_length';
alter type public.growth_measurement_type add value if not exists 'weight_for_height';
alter type public.growth_measurement_type add value if not exists 'muac_for_age';

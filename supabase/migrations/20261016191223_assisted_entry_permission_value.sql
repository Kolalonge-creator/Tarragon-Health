-- Assisted entry, part 1 of 2: the one new caregiver capability.
--
-- A caregiver may enter a blood pressure or glucose reading ON BEHALF of the person they support only when that person has given
-- them the `log_readings` capability. ALTER TYPE ... ADD VALUE cannot be used in the transaction that adds it, so this value gets its
-- own file; the next migration (assisted_entry_and_caregiver_red_care) is the one that spends it.
--
-- Backward compatible by construction: profile_access.permissions NULL still means "unrestricted" (every capability a manage grant
-- implies), so every grant made before this value existed keeps working exactly as before. Only a grant that was deliberately
-- narrowed to a list that does not name log_readings stops being able to enter readings, which is what narrowing means.
alter type public.caregiver_permission add value if not exists 'log_readings';

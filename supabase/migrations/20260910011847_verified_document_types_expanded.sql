-- New verified_document_type values.
--
-- Its own migration because ALTER TYPE ... ADD VALUE cannot be used in the same
-- transaction as anything that references the new value, and the migration that
-- follows this one prices each of these individually.
--
-- WHAT IS DELIBERATELY ABSENT, AND MUST STAY ABSENT
-- -------------------------------------------------
-- Pre-employment medicals, visa and immigration medicals, NYSC medicals and
-- driver medicals are NOT on this list, and no future migration should add them.
--
-- A Nigerian pre-employment medical examination requires physical examination --
-- vitals taken by the examiner, motor function, and in several sectors a chest
-- radiograph. Visa medicals for the UK, US, Canada and Australia must be issued
-- by a panel physician designated by the destination country; there is no
-- telehealth substitute and a document from anyone else is not merely weaker,
-- it is not the document at all. A doctor who certifies fitness for employment
-- without examining the person has signed something they cannot support, and
-- the exposure is the doctor's licence rather than Tarragon's revenue.
--
-- Every type below is one a doctor can honestly attest to from a record they
-- hold. Several are stronger evidence than a ten-minute walk-in examination,
-- because the record covers months of readings rather than one morning -- but
-- that is an argument for these, not a bridge to the ones above.

alter type public.verified_document_type add value if not exists 'return_to_work';
alter type public.verified_document_type add value if not exists 'medication_carry_letter';
alter type public.verified_document_type add value if not exists 'specialist_referral_letter';
alter type public.verified_document_type add value if not exists 'school_health_form';
alter type public.verified_document_type add value if not exists 'insurance_medical_summary';

-- Lets a patient tag a testimonial with the condition it's about (e.g.
-- "hypertension", "diabetes") so a condition marketing page
-- (apps/web/src/app/(marketing)/hypertension|diabetes/page.tsx) can show
-- only testimonials relevant to it via TestimonialsSection's new `condition`
-- filter prop, instead of every published quote regardless of topic.
--
-- Nullable and untyped against an enum on purpose: it mirrors
-- PRODUCT_PAGES's slug keys in apps/web/src/app/(marketing)/_content/products.ts,
-- which are app-code, not a DB enum, and grow independently of this
-- migration. A null condition (every existing row, and any future general
-- quote) is unscoped and still shows on the homepage's unfiltered
-- TestimonialsSection.
--
-- No RLS/grant change needed: patient_testimonials_select/_insert/_update
-- and the anon SELECT grant already apply at row/table level, not per
-- column, so they already cover this column.

alter table public.patient_testimonials
  add column condition text;

comment on column public.patient_testimonials.condition is
  'Optional condition-page slug this quote is about (matches PRODUCT_PAGES in apps/web/src/app/(marketing)/_content/products.ts), e.g. hypertension, diabetes. Null = general, shown unfiltered on the homepage only.';

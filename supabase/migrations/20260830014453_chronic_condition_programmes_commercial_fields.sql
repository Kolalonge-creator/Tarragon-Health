-- Tarragon Health — episodic-fee rebuild, step 1/6.
--
-- The subscription model is being retired: Nigerians aren't used to recurring
-- billing, and Paystack subscription auth failures/churn make it a poor fit.
-- Chronic-disease care moves to a one-time, bounded-window fee (a "12-Week
-- Hypertension Programme" and similar) instead of an open-ended subscription.
-- This is step 1: give chronic_condition_programmes the commercial fields a
-- purchasable programme needs. Price/duration/content are left NULL here —
-- never invented in a migration — and are set by the founder via the admin
-- console (Chronic conditions settings, extended in the same effort) before a
-- programme can actually be bought. The purchase trigger (step 3) fails closed
-- on a null price rather than guessing one.
--
-- default_duration_weeks mirrors the existing, purely-descriptive
-- lifestyle_programmes.duration_weeks naming (20260717140000_lifestyle_coaching.sql)
-- — it is the catalogue's advertised length. The actual purchase snapshots its
-- own duration_weeks at insert time (step 3), so changing this later never
-- alters an already-sold purchase's window.

alter table public.chronic_condition_programmes
  add column if not exists price_kobo             bigint,
  add column if not exists default_duration_weeks integer check (default_duration_weeks > 0),
  add column if not exists purchase_summary        text;

comment on column public.chronic_condition_programmes.price_kobo is
  'One-time fee for this programme, in kobo. NULL means not yet configured — the purchase trigger refuses to sell it until an admin sets a real price.';
comment on column public.chronic_condition_programmes.default_duration_weeks is
  'Advertised programme length in weeks, admin-editable. Purely descriptive at the catalogue level — a purchase snapshots its own duration_weeks at insert time, so this can change without touching already-sold purchases.';
comment on column public.chronic_condition_programmes.purchase_summary is
  '"What''s included" copy shown on the patient-facing product/purchase page. Admin-editable, not a contractual line item, never snapshotted onto a purchase.';

-- Hypertension is the launch product — backfill its known length. Diabetes'
-- price/duration/content stay NULL until the founder configures them.
update public.chronic_condition_programmes
  set default_duration_weeks = 12
  where code = 'hypertension' and default_duration_weeks is null;

do $$
begin
  if (select default_duration_weeks from public.chronic_condition_programmes where code = 'hypertension') is distinct from 12 then
    raise exception 'FAIL: hypertension default_duration_weeks was not backfilled to 12';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'chronic_condition_programmes'
      and column_name in ('price_kobo', 'default_duration_weeks', 'purchase_summary')
    having count(*) = 3
  ) then
    raise exception 'FAIL: chronic_condition_programmes commercial columns missing';
  end if;
end $$;

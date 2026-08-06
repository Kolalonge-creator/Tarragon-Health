-- Retires the sponsor-statement / sponsor-statement_usd scaffold rows added a
-- few hours earlier today in 20260805201640_add_sponsor_statement_addon_scaffold.sql.
--
-- Reconsidered before either of that migration's own listed gaps got closed:
-- the data behind a "statement" (total funded, per-person breakdown, vouchers
-- used) is already free and visible on /patient/supporting today. Charging
-- ₦2,000/month for exporting and consolidating data the platform already
-- shows for free reads as monetising transparency itself, sitting awkwardly
-- next to the platform's own No-Hidden-Cost Promise ("we will always tell you
-- clearly whether something is already included"). The export is being
-- shipped as a free feature on the same page instead (see
-- supported-people.tsx's exportStatementCsv) — the exportable statement the
-- add-on promised, at no charge, rather than a paid convenience layered on
-- top of information the sponsor can already see.
--
-- Safe to delete outright rather than merely deactivate: is_active was false
-- from the moment these rows were created, so nothing was ever synced to
-- Paystack/Stripe and no subscription_add_ons row can reference either code.

do $$
begin
  if exists (
    select 1 from public.subscription_add_ons sao
      join public.add_ons a on a.id = sao.add_on_id
     where a.code in ('sponsor-statement', 'sponsor-statement_usd')
  ) then
    raise exception 'sponsor-statement add-on has live subscribers; do not delete, deactivate and migrate them instead';
  end if;
end $$;

delete from public.add_ons where code in ('sponsor-statement', 'sponsor-statement_usd');

do $$
begin
  if exists (select 1 from public.add_ons where code in ('sponsor-statement', 'sponsor-statement_usd')) then
    raise exception 'sponsor-statement add_ons rows should be gone';
  end if;
end $$;

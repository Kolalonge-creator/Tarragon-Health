-- Withdraw two below-cost STI products and correct the Synlab chlamydia/gonorrhoea cost.
--
-- WHAT WAS WRONG
-- `20260829090000_sti_chlamydia_gonorrhea_catalogue` seeded four provider rows for
-- lab_tests.code = 'chlamydia_gonorrhoea' at ₦9,000–₦10,000. None of those figures came
-- from a partner price list; they were invented alongside the feature. Synlab Nigeria's
-- actual 2026 price list (the contracted partner, and the only provider whose list we
-- hold) has no ₦9,500 line for this test at all. It prices:
--     Chlamydia trachomatis DNA                                  ₦100,000
--     Neisseria gonorrhoeae DNA                                  ₦100,000
--     Chlamydia trachomatis / N. gonorrhoeae DNA (PCR)           ₦200,000  <- what
--       'Chlamydia & Gonorrhoea NAAT' promises: both organisms, one combined assay
-- So the stored Synlab cost understates the real one by 21x. Every other Synlab row in
-- lab_tests (20 of 21) matches that spreadsheet to the naira, which is what identifies
-- this block as fabricated rather than the price list being stale.
--
-- The two panel_bundles built on it are consequently sold below cost:
--   single_chlamydia_gonorrhoea  ₦9,500  vs ₦200,000 true cost   -> -₦190,500/order
--   sti_panel_full              ₦42,000  vs ₦260,900 true cost   -> -₦218,900/order
--     (HIV 8,900 + RPR 17,700 + HepB 15,300 + HepC 19,000 + C/G 200,000)
-- sti_panel_full is under-priced even on the costs already stored: its five components
-- sum to ₦70,400 against a ₦42,000 price.
--
-- WHY NO MONEY HAS BEEN LOST
-- screen_types.price_kobo for 'chlamydia_gonorrhoea' is NULL (the catalogue migration
-- inserted the screen_type without a price), and private.set_lab_order_computed_price
-- refuses to price a partner order when any test code is unpriced. Verified live against
-- this project inside a rolled-back transaction: inserting a fulfilment='partner' order
-- for either bundle raises
--     "Cannot bill this review — no price on file for: chlamydia_gonorrhoea."
-- So both products fail closed today. lab_orders holds 3 rows total, none for either
-- bundle. The exposure is latent, not realised — but the two cards still render to
-- patients at ₦9,500 and ₦42,000 with a pay button that errors, so they are
-- simultaneously mispriced and non-functional.
--
-- WHAT THIS MIGRATION DOES
--   1. Withdraws both bundles (is_active + self_bookable = false). Reversible; it does
--      not delete the rows, the test_codes, or the screen_type, so the clinical pathway
--      (sti-risk-assessment, exposure_retest_rules) is untouched.
--   2. Corrects the Synlab cost to the real ₦200,000, scoped to the Synlab provider row.
--      lab_tests has no unique index on `code` alone (four providers carry this code),
--      so the update MUST be provider-scoped.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
--   - It does not reprice either bundle. Every other bundle in the catalogue sits at
--     exactly Synlab cost +20%, which would put sti_panel_full at ₦84,500 and
--     single_chlamydia_gonorrhoea at ₦240,000 — but the founder is actively weighing
--     +15% against the current +20%, and Synlab's list carries separate Administrative
--     (₦30,600) / Handling (₦19,800) / Medical Report (₦22,300) lines whose per-
--     requisition applicability is unconfirmed. Repricing before those two questions are
--     settled would just install a second wrong number. Withdrawal is the safe,
--     reversible half; the price is a founder decision.
--   - It does not give chlamydia_gonorrhoea a screen_types.price_kobo. That NULL is what
--     makes both bundles fail closed today, and it is also why
--     private.assert_test_price_covers_cost() ("Tarragon would pay to run this test")
--     never fired on this row: the guard compares screen_types.price_kobo against the
--     dearest active provider cost and skips silently when the patient price is NULL.
--     Setting that price is repricing, so it waits on the same founder decision.
--   - It does not touch the Cerba Lancet / Healthtracka / Afriglobal rows for this code,
--     which carry the same fabricated ₦9,000–₦10,000 prices. We hold no price list for
--     those three, and lab_tests.price_kobo is NOT NULL (default 0), so they cannot be
--     set to "unknown" to fail closed the way screen_types.price_kobo does without a
--     schema change. Correcting them needs real partner price lists.

begin;

update public.panel_bundles
   set is_active = false,
       self_bookable = false
 where code in ('single_chlamydia_gonorrhoea', 'sti_panel_full');

-- private.restrict_lab_test_partner_edit_to_availability() is a BEFORE UPDATE trigger
-- that silently reverts price_kobo (and provider_id/code/name/commission/turnaround) to
-- OLD unless the caller passes private.is_admin() or holds 'partners.labs.manage'.
-- is_admin() resolves through auth.uid(), which is NULL for a migration, so a plain
-- UPDATE here reports "1 row updated" and changes nothing at all. That is not
-- hypothetical: the first version of this migration did exactly that, and only the
-- closing assertion block caught it. Disable that one trigger for the length of this
-- transaction — targeted rather than session_replication_role, so the
-- lab_tests_price_covers_cost guard stays armed while we write.
alter table public.lab_tests disable trigger lab_tests_restrict_partner_edit;

update public.lab_tests lt
   set price_kobo = 20000000  -- ₦200,000: Synlab combined C. trachomatis / N. gonorrhoeae DNA (PCR)
  from public.lab_providers lp
 where lp.id = lt.provider_id
   and lp.name = 'Synlab Nigeria'
   and lt.code = 'chlamydia_gonorrhoea';

alter table public.lab_tests enable trigger lab_tests_restrict_partner_edit;

do $$
declare
  v_still_live int;
  v_synlab_cost bigint;
begin
  select count(*) into v_still_live
    from public.panel_bundles
   where code in ('single_chlamydia_gonorrhoea', 'sti_panel_full')
     and (is_active or self_bookable);
  if v_still_live <> 0 then
    raise exception 'FAIL: % below-cost STI bundle(s) still active or self-bookable', v_still_live;
  end if;

  select lt.price_kobo into v_synlab_cost
    from public.lab_tests lt
    join public.lab_providers lp on lp.id = lt.provider_id
   where lp.name = 'Synlab Nigeria' and lt.code = 'chlamydia_gonorrhoea';
  if v_synlab_cost is distinct from 20000000 then
    raise exception 'FAIL: Synlab chlamydia_gonorrhoea cost is %, expected 20000000', v_synlab_cost;
  end if;

  -- The other three providers must be untouched: this migration corrects only the row
  -- it holds evidence for, and a stray catch-all update would hide the remaining gap.
  if (select count(*) from public.lab_tests lt
        join public.lab_providers lp on lp.id = lt.provider_id
       where lt.code = 'chlamydia_gonorrhoea'
         and lp.name <> 'Synlab Nigeria'
         and lt.price_kobo between 900000 and 1000000) <> 3 then
    raise exception 'FAIL: expected the 3 non-Synlab chlamydia_gonorrhoea rows to be left as-is';
  end if;

  if (select tgenabled from pg_trigger
       where tgrelid = 'public.lab_tests'::regclass
         and tgname = 'lab_tests_restrict_partner_edit') <> 'O' then
    raise exception 'FAIL: lab_tests_restrict_partner_edit was left disabled';
  end if;

  raise notice 'PASS: both below-cost STI bundles withdrawn; Synlab C/G cost corrected to ₦200,000';
end $$;

commit;

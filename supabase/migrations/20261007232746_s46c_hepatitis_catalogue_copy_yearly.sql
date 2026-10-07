-- S46c: catalogue copy for hepatitis B and C (founder instruction, 2026-10-07).
--
-- The Know Your Basics bundle description (20260821191743, rewritten 20260821192511 and 20260911203129) still told patients that
-- hepatitis B and C are done once and that they would never be asked to pay again. That stopped being true when the S46 serology
-- rule became active (20261007231627): hepatitis C is tested yearly, hepatitis B yearly until a positive anti-HBs is recorded.
-- Blood group and genotype stay once for life. This rewrites the live copy only. No behaviour changes here: the exclusion
-- function and the pricing whitelist already follow the S46 rule. No em dashes.
--
-- Not applied to production by the author.

update public.panel_bundles
   set description = 'Blood group, genotype and hepatitis B and C. Your blood group and genotype never change, so those are done once and kept for life. Hepatitis B and C can be tested every year, because a result only describes the day of the test. Hepatitis B testing stops once your care team records that you are protected. You will never be charged for a repeat you do not need.'
 where code = 'know_your_basics';

do $$
begin
  if exists (select 1 from public.panel_bundles
              where code = 'know_your_basics'
                and (description ilike '%never be asked to pay%' or description like '%—%'
                     or description !~* 'every year')) then
    raise exception 'S46c: the Know Your Basics copy still carries the old once-ever promise';
  end if;
  if exists (select 1 from public.panel_bundles
              where description ~* '(hepatitis|hbsag|hcv)[^.]*(done once|once and|for life|lifetime)' and code <> 'know_your_basics') then
    raise exception 'S46c: a catalogue bundle description still says hepatitis is done once';
  end if;
end $$;

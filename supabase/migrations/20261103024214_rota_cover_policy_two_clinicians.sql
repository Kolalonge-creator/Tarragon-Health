-- Rota cover policy: TWO credentialed on-call clinicians are the minimum (founder decision, 2026-11-03).
--
-- WHY: W-03 (20261027192444_w03_red_page_ladder_drilled.sql) shipped rota_cover_policy.required_clinicians = 5 as a PROPOSED value for the
-- founder/CMO to confirm. Checked live on 2026-11-03: the real roster is two credentialed doctors (one senior medical officer, the chief
-- medical officer) who alternate primary and backup and cover every hour of the 28-day window (hours_uncovered 0, hours_without_backup 0);
-- meets_minimum was false ONLY because 2 < 5. A policy asking for five with two real doctors keeps the red-ladder card on "below the
-- minimum" for good and, from 30 days before the sole-CMO exception sunset (2027-01-31), the daily sunset sweep would open an ops incident
-- every day. The founder decided: two doctors is enough to start 24/7 cover; amend the proposed value rather than staff to it.
--
-- WHAT CHANGES: the one policy row (required_clinicians 5 -> 2, note) and the column default (5 -> 2) so a fresh replay agrees with the
-- live row. window_days (28) and sole_cmo_exception_sunset (2027-01-31, still PROPOSED) are untouched. ROWS AFFECTED: 1.
-- WHAT DOES NOT CHANGE: private.rota_coverage still demands a credentialed primary for every hour of the window, so a gap in the rota
-- still fails the minimum; the S18 gap sweep (uncovered, unconfirmed or no-backup hours in the next 48 hours) is a separate check and is
-- not relaxed here. Nothing patient-facing changes.
-- MIRROR: packages/shared/src/proposed-config rota.cover_policy v2; proof packages/db/tests/w03_red_page_ladder.sql (section 4).
-- Nothing here is destructive.

-- rota-cover-policy-v2-begin
alter table public.rota_cover_policy alter column required_clinicians set default 2;
update public.rota_cover_policy
   set required_clinicians = 2,
       note = 'Founder decision 2026-11-03: two credentialed on-call clinicians cover a 28-day rota (W-03 had proposed five; two doctors alternating primary and backup is enough to start 24/7 cover). The sole-CMO on-call exception still ends after 2027-01-31 (Lagos), PROPOSED.',
       updated_at = now();
-- rota-cover-policy-v2-end

do $$
declare pol public.rota_cover_policy;
begin
  select * into pol from public.rota_cover_policy;
  if pol.required_clinicians <> 2 then raise exception 'rota_cover_policy.required_clinicians should be 2, is %', pol.required_clinicians; end if;
  if pol.window_days <> 28 then raise exception 'rota_cover_policy.window_days should still be 28, is %', pol.window_days; end if;
  if pol.sole_cmo_exception_sunset <> date '2027-01-31' then raise exception 'sole_cmo_exception_sunset should still be 2027-01-31, is %', pol.sole_cmo_exception_sunset; end if;
  if (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'rota_cover_policy' and column_name = 'required_clinicians') <> '2' then
    raise exception 'rota_cover_policy.required_clinicians default should be 2';
  end if;
end $$;

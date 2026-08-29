-- Tarragon Health — Diagnostic Safety Pathway, part 3/6: specialist
-- referral linkage (60.9).
--
-- "If specialist input is needed: abnormal result -> clinical review ->
-- specialist required -> referral created -> ... -> specialist assessment
-- -> report -> primary care follow-up. This connects directly to the
-- specialist pathway discussed elsewhere." specialist_referrals already
-- carries a real 8-stage status pipeline
-- (pending_payment/payment_confirmed/pending/waitlisted/booked/confirmed/
-- completed/declined) and already has a screening_upgrade_id FK — this
-- migration only wires that existing FK through to the new
-- diagnostic_episodes row so the episode's closure checklist can see it,
-- never touches referral routing/matching logic (out of scope per
-- CLINICAL_NETWORK_SPEC.md §3's matching-engine guardrail — this is purely
-- "link an existing referral into its episode", not ranking/assigning one).

create or replace function private.sync_diagnostic_episode_from_referral()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.screening_upgrade_id is not null then
      update public.diagnostic_episodes
        set requires_referral = true,
            referral_id = coalesce(referral_id, new.id)
        where screening_upgrade_id = new.screening_upgrade_id;
    end if;
    return new;
  end if;

  -- UPDATE of status: 'completed' means the specialist was seen (8.9
  -- "specialist assessment" step) — only the referral this episode is
  -- actually tracking can satisfy its closure checklist, so match on
  -- referral_id, not screening_upgrade_id (an episode may have moved on to
  -- a different/replacement referral since creation).
  if new.status = 'completed' and old.status is distinct from 'completed' then
    update public.diagnostic_episodes
      set referral_completed_at = coalesce(referral_completed_at, now())
      where referral_id = new.id;
  end if;

  return new;
end;
$$;

comment on function private.sync_diagnostic_episode_from_referral() is
  '60.9: links a newly-created specialist_referrals row (via its existing screening_upgrade_id FK) to the matching diagnostic_episodes row and sets requires_referral=true; when that referral''s status reaches completed (specialist seen), stamps diagnostic_episodes.referral_completed_at. Purely a linkage sync — never touches referral status transitions, routing, or the matching/ranking engine (out of scope, see CLINICAL_NETWORK_SPEC.md §3).';

revoke all on function private.sync_diagnostic_episode_from_referral() from public, anon;

create trigger specialist_referrals_sync_diagnostic_episode
  after insert or update of status on public.specialist_referrals
  for each row execute function private.sync_diagnostic_episode_from_referral();

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'specialist_referrals_sync_diagnostic_episode'
      and tgrelid = 'public.specialist_referrals'::regclass and not tgisinternal
  ) then
    raise exception 'specialist_referrals_sync_diagnostic_episode trigger was not created';
  end if;
  raise notice 'PASS: specialist_referrals <-> diagnostic_episodes linkage sync installed';
end $$;

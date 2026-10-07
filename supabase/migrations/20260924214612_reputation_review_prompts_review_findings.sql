-- Fast-follow for the Reputation & Review-Generation Engine, from a
-- /code-review high pass on the feature before it shipped:
--
-- 1. Flag-disabled path returned silently instead of recording
--    'skipped_flag_disabled' (the enum value existed but nothing ever wrote
--    it) -- violates this same migration's own "recorded, not silently
--    dropped" principle for the cooldown-skip case. Fixed: both paths now
--    go through one status computation.
-- 2. No email on file left the trustpilot_email row stuck at 'queued'
--    forever with no distinct status -- indistinguishable in the admin
--    funnel from an ask about to go out. Fixed: that channel's row is
--    simply never created when there's no email to send it to (the
--    native_app_store row, which needs no email, still is).
-- 3. TOCTOU race: two qualifying events for the same patient in overlapping
--    transactions could both read the cooldown as clear before either
--    committed, both enqueueing and both emailing -- the documented
--    "whichever fires second sees the first's row and skips" invariant
--    depended on serialization that was never actually enforced. Fixed:
--    an advisory xact lock keyed on the patient serializes concurrent
--    enqueue attempts for the same patient.
-- 4. claim_pending_reputation_review_prompt() did a SELECT ... FOR UPDATE
--    followed by a separate UPDATE -- two round trips for one logical
--    claim. Fixed: one UPDATE ... WHERE id = (subselect) RETURNING *.
-- 5. Efficiency/simplification cleanup: count(*) -> exists() for a
--    boolean check; the two near-duplicate 2-row INSERT blocks (queued vs.
--    skipped) collapsed into one parametrised insert; the notification
--    insert's redundant re-SELECT of the row just inserted replaced with
--    RETURNING; a partial index added for the claim lookup's actual filter
--    (patient_id, channel, status), which the existing
--    (patient_id, queued_at) index didn't cover.
--
-- Confirmed separately and left alone (not a bug): a mobile-client fix for
-- the composite-NULL/PostgREST truthiness gotcha and the availability-check
-- ordering, and an edge-function fallback for a missing BROADCAST_LINK_SECRET,
-- are TypeScript-only changes with no schema impact -- not in this migration.
--
-- NOTE: this migration's own first cut of the status computation had a
-- regression of its own (both prompt rows should share the skip status;
-- this version only wrote it to the native_app_store row) -- caught by the
-- regression test itself before merge and fixed in the very next migration,
-- 20260924215058_fix_skip_status_both_channels.sql. Left as originally
-- applied here rather than edited in place, matching this feature's own
-- established practice of a fresh migration per found issue rather than
-- rewriting one already applied live.

create index reputation_review_prompts_claim_lookup_idx
  on public.reputation_review_prompts (patient_id, queued_at)
  where channel = 'native_app_store' and status = 'queued';

create or replace function private.enqueue_reputation_review_prompt(
  p_organisation_id uuid,
  p_patient_id uuid,
  p_trigger_event public.reputation_review_trigger_event,
  p_source_table text,
  p_source_id uuid
) returns void
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_status public.reputation_review_prompt_status;
  v_is_rate_limited boolean;
  v_patient_email text;
  v_trustpilot_prompt_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('reputation_review_prompt:' || p_patient_id::text));

  if not private.is_feature_enabled('reputation_review_prompts', p_patient_id) then
    v_status := 'skipped_flag_disabled';
  else
    select exists(
      select 1 from public.reputation_review_prompts
      where patient_id = p_patient_id
        and queued_at > now() - interval '90 days'
        and status not in ('skipped_rate_limited', 'skipped_flag_disabled')
    ) into v_is_rate_limited;
    v_status := case when v_is_rate_limited then 'skipped_rate_limited' else 'queued' end;
  end if;

  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'native_app_store', v_status)
  on conflict (source_table, source_id, channel) do nothing;

  if v_status <> 'queued' then
    return;
  end if;

  select email into v_patient_email from auth.users where id = p_patient_id;
  if v_patient_email is null then
    return;
  end if;

  insert into public.reputation_review_prompts
    (organisation_id, patient_id, trigger_event, source_table, source_id, channel, status)
  values
    (p_organisation_id, p_patient_id, p_trigger_event, p_source_table, p_source_id, 'trustpilot_email', 'queued')
  on conflict (source_table, source_id, channel) do nothing
  returning id into v_trustpilot_prompt_id;

  if v_trustpilot_prompt_id is null then
    return;
  end if;

  insert into public.notifications
    (organisation_id, recipient_id, channel, status, template, payload, content_class, source_table, source_id)
  values
    (p_organisation_id, p_patient_id, 'email', 'pending', 'reputation_review_request_trustpilot',
     jsonb_build_object('to_email', v_patient_email, 'reputation_review_prompt_id', v_trustpilot_prompt_id),
     'non_clinical', 'reputation_review_prompts', v_trustpilot_prompt_id);
end;
$function$;

revoke all on function private.enqueue_reputation_review_prompt(
  uuid, uuid, public.reputation_review_trigger_event, text, uuid
) from public, authenticated;

create or replace function public.claim_pending_reputation_review_prompt()
returns public.reputation_review_prompts
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_row public.reputation_review_prompts;
begin
  update public.reputation_review_prompts
  set status = 'shown', shown_at = now()
  where id = (
    select id
    from public.reputation_review_prompts
    where patient_id = (select auth.uid())
      and channel = 'native_app_store'
      and status = 'queued'
    order by queued_at asc
    limit 1
    for update skip locked
  )
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.claim_pending_reputation_review_prompt() from public;
grant execute on function public.claim_pending_reputation_review_prompt() to authenticated;

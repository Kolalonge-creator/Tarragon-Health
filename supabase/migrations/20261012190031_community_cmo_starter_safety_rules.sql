-- Community: the emergency and self-harm wording the Chief Medical Officer approved in chat on 2026-10-12 (docs/DECISIONS.md COM-21), ready
-- to load into a draft with one click. Loading is NOT signing: the draft has no force until the Chief Medical Officer activates it on the
-- Community > Rules page, and the database lets only an active Chief Medical Officer do either step.
--
-- The draft is built from the live rule set (or rule set 1 if none is live yet), so the four contact detectors and the hold rules carry
-- over, plus the safety rules from docs/community/CMO_SAFETY_TERMS_PROPOSAL.md. The disordered-eating hold rules stay; the three most
-- severe eating phrases also go to a safety reviewer and show the self-harm care card (founder and CMO decision).
create or replace function public.community_cmo_load_starter_safety_rules() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_new integer;
  v_from integer;
  v_existing integer;
begin
  if (select auth.uid()) is null then raise exception 'sign in required' using errcode = '28000'; end if;
  if not private.credential_is_cmo() then raise exception 'the Chief Medical Officer only' using errcode = '42501'; end if;
  -- If a draft that already carries safety rules exists, open that one instead of making a second.
  select d.version into v_existing from public.community_filter_rule_sets d
   where d.status = 'draft' and exists (select 1 from public.community_filter_rules r where r.rule_set_version = d.version and r.class in ('self_harm', 'emergency'))
   order by d.version desc limit 1;
  if v_existing is not null then return jsonb_build_object('status', 'already_loaded', 'version', v_existing); end if;

  select version into v_from from public.community_filter_rule_sets where status = 'active';
  if v_from is null then select min(version) into v_from from public.community_filter_rule_sets; end if;
  if v_from is null then return jsonb_build_object('status', 'refused', 'reason', 'not_ready'); end if;

  v_new := (select max(version) from public.community_filter_rule_sets) + 1;
  insert into public.community_filter_rule_sets (version, status, params, created_by, notes)
  select v_new, 'draft', params, (select auth.uid()), 'Starter safety rules approved by the CMO on 2026-10-12. Activate this set to sign it.'
    from public.community_filter_rule_sets where version = v_from;
  -- carry over everything except safety rules already in the source set (none yet, or the CMO's own)
  insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action, note)
  select v_new, class, kind, pattern, action, note from public.community_filter_rules where rule_set_version = v_from;

  insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action, note) values
    (v_new, 'self_harm', 'regex', '\y(?:kill|hurt|harm|cut) myself\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:end|take) my (?:own )?life\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:want|wanna|going) to die\y|\ywish i (?:was|were) dead\y|\ybetter off dead\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:no reason|point) (?:to|in) (?:live|living|go on|going on)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\ysuicid(?:e|al)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:overdose|od) on (?:my )?(?:tablets|pills|insulin|metformin|medication)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:stop|stopped) taking (?:my )?(?:insulin|medication|tablets) on purpose\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\ymaking myself (?:sick|throw up|vomit)\y', 'safety', 'Severe disordered eating, CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\y(?:have not|havent|haven''t|not) eaten (?:in|for) (?:[2-9] days|days|a week)\y', 'safety', 'Severe disordered eating, CMO approved 2026-10-12'),
    (v_new, 'self_harm', 'regex', '\ylaxatives? to lose weight\y', 'safety', 'Severe disordered eating, CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:chest|heart) pain\y.{0,40}\y(?:now|right now|since|spreading|crushing)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:can(?:''|)t|cannot|struggling to) breathe\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:face|arm|leg) (?:is )?(?:drooping|numb|weak)\y|\yslurred speech\y|\ysudden(?:ly)? (?:cannot|can(?:''|)t) (?:speak|see|move)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:blood sugar|glucose|sugar) (?:is )?(?:very low|below [0-9]{2})\y.{0,40}\y(?:shaking|confused|faint|unconscious)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:just )?(?:passed out|collapsed|fainted)\y', 'safety', 'CMO approved 2026-10-12'),
    (v_new, 'emergency', 'regex', '\y(?:blood pressure|bp) (?:is )?(?:over|above) (?:2[0-9]{2}|1[89][0-9])\y.{0,60}\y(?:headache|chest|vision|confus)\y', 'safety', 'CMO approved 2026-10-12');
  perform private.community_log_event(null, null, null, 'starter_safety_rules_loaded', (select auth.uid()), 'v' || v_new, '[]'::jsonb);
  return jsonb_build_object('status', 'ok', 'version', v_new);
end $$;

revoke all on function public.community_cmo_load_starter_safety_rules() from public, anon, authenticated, service_role;
grant execute on function public.community_cmo_load_starter_safety_rules() to authenticated;

-- Community, Phase 1, part 4 of 4: the `community` go-live guard (INV-14), its conditions, and the launch seed.
--
-- Design: docs/COMMUNITY_SPEC.md sections 4.3 and 8. Decisions: COM-1 to COM-10 (docs/DECISIONS.md, 2026-10-09).
--
-- NOTHING IS SWITCHED ON. The guard is born off. Groups are seeded as DRAFTS. The v1 filter rule set is a DRAFT with no
-- emergency or self-harm rules: those, their phrase lists and the card wording are the Chief Medical Officer's to write and
-- sign (OQ-COM-05). Engineering does not invent them.
--
-- PATCHING go_live_conditions IN PLACE. The live private.go_live_conditions() carries branches (research_export_enabled,
-- symptom_checker_enabled) that exist on other unmerged branches and in no migration file on this branch, so replacing the
-- function with a copy from a file would silently delete them (the standing lesson in CLAUDE.md: other branches share this
-- database). Instead this migration reads the CURRENT definition with pg_get_functiondef, adds ONE branch, and re-creates it.
-- It is idempotent, and it raises if the expected anchor is missing rather than guessing.

-- ---------------------------------------------------------------------------
-- 1. The conditions for the `community` guard
-- ---------------------------------------------------------------------------
create or replace function private.community_go_live_conditions(p_key text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_mods integer;
  v_safety integer;
  v_groups integer;
begin
  select count(distinct s.profile_id) into v_mods
    from public.community_staff s join public.profiles p on p.id = s.profile_id and p.is_active
   where s.scope = 'moderator' and s.revoked_at is null;
  select count(distinct s.profile_id) into v_safety
    from public.community_staff s join public.profiles p on p.id = s.profile_id and p.is_active
   where s.scope = 'safety_reviewer' and s.revoked_at is null;
  select count(*) into v_groups from public.community_groups where status = 'active';
  return jsonb_build_array(
    private.go_live_cond('moderation_team_named', 'At least one named moderator and one named safety reviewer hold an active grant',
      v_mods >= 1 and v_safety >= 1, 'data', v_mods || ' moderators, ' || v_safety || ' safety reviewers'),
    private.go_live_cond('moderated_hours_declared', 'The moderated hours (Africa/Lagos) are declared and the weekend sweep is staffed',
      private.go_live_attested(p_key, 'moderated_hours_declared'), 'attestation', null),
    private.go_live_cond('rule_set_signed_by_cmo', 'A live filter rule set carries emergency and self-harm rules and was activated by the Chief Medical Officer',
      exists (
        select 1 from public.community_filter_rule_sets rs
         where rs.status = 'active'
           and exists (select 1 from public.clinical_staff cs where cs.profile_id = rs.approved_by and cs.active and cs.doctor_tier = 'chief_medical_officer')
           and exists (select 1 from public.community_filter_rules r where r.rule_set_version = rs.version and r.class = 'emergency')
           and exists (select 1 from public.community_filter_rules r where r.rule_set_version = rs.version and r.class = 'self_harm')),
      'data', (select 'version ' || version from public.community_filter_rule_sets where status = 'active')),
    private.go_live_cond('crisis_owner_named', 'A named person owns the self-harm queue and its response time is recorded',
      private.go_live_attested(p_key, 'crisis_owner_named'), 'attestation', null),
    private.go_live_cond('consent_text_approved', 'Counsel has approved the join consent text and the retention periods',
      private.go_live_attested(p_key, 'consent_text_approved'), 'attestation', null),
    private.go_live_cond('a_group_is_live', 'At least one group is live (rules present and, where its topic needs it, approved by the Chief Medical Officer)',
      v_groups >= 1, 'data', v_groups || ' live'),
    private.go_live_cond('clinical_safety_case_current', 'A current clinical safety case and hazard log, signed off',
      private.go_live_attested(p_key, 'clinical_safety_case_current'), 'attestation', null),
    private.go_live_cond('tabletop_passed', 'The safety hand-off was rehearsed end to end with a test account',
      private.go_live_attested(p_key, 'tabletop_passed'), 'attestation', null),
    private.go_live_cond('cmo_switch', 'Chief Medical Officer sign-off', true, 'switch', 'Given by the Chief Medical Officer pressing the switch'));
end $$;

revoke all on function private.community_go_live_conditions(text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Add the branch to the CURRENT go_live_conditions (idempotent; fails loudly if the anchor moved)
-- ---------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_anchor constant text := E'\n  end if;\n  -- An unknown key has no conditions';
  v_new text;
begin
  v_def := pg_get_functiondef('private.go_live_conditions(text, uuid)'::regprocedure);
  if v_def like '%community_go_live_conditions%' then
    return;
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception 'private.go_live_conditions no longer ends with the expected fall-through; add the community branch by hand' using errcode = '55000';
  end if;
  v_new := replace(v_def, v_anchor,
    E'\n  elsif p_key = ''community'' then\n    return private.community_go_live_conditions(p_key);\n  end if;\n  -- An unknown key has no conditions');
  execute v_new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. The guard row (born off)
-- ---------------------------------------------------------------------------
insert into public.go_live_guards (key, label, blocks, condition_text, switch_role, enforced_in, not_enforced_in) values
  ('community', 'Community groups', 'Joining, reading and posting in community groups (members-only topic groups)',
   'Named moderator and safety reviewer; CMO-signed filter rule set with emergency and self-harm rules; crisis owner named; counsel-approved consent text; a live group; safety case; tabletop passed',
   'cmo',
   array['community_list_groups', 'community_get_group', 'community_join_group', 'community_feed', 'community_replies',
         'community_submit_post', 'community_edit_post', 'community_react', 'community_report_post', 'community_posting_gate'],
   'Staff configuration (groups, topics, rule sets, staff grants) is not behind the guard so the team can prepare before launch. is_test accounts pass it so the safety hand-off can be rehearsed. Notification templates are not yet rendered by the sender.');

-- ---------------------------------------------------------------------------
-- 4. Versioned configuration (PROPOSED). Mirrored by packages/shared/src/proposed-config community.rules; a test fails on drift.
--    The CMO and founder confirm a value by publishing a NEW version.
-- ---------------------------------------------------------------------------
-- community-rules-begin
insert into public.community_config (version, is_active, params) values (1, true, $json$
{
  "post_max_chars": 2000,
  "edit_window_minutes": 15,
  "new_member_premoderated_posts": 3,
  "rate_posts_per_hour": 6,
  "rate_posts_per_day": 30,
  "block_cooldown": { "max_blocks": 3, "window_minutes": 10, "cooldown_minutes": 60 },
  "auto_hide_report_threshold": 3,
  "removed_body_retention_days": 90,
  "unmask": { "min_reason_chars": 20, "max_per_day": 5 },
  "consent_version": "DRAFT-UNAPPROVED",
  "feed_page_size": 20,
  "max_page_size": 50,
  "avatars": ["leaf", "sun", "river", "hill", "star", "seed", "cloud", "stone", "wave", "bird"],
  "handle_words": {
    "adjectives": ["calm", "brave", "bright", "gentle", "steady", "kind", "warm", "quiet", "bold", "clever", "cheerful", "patient", "sunny", "swift", "wise", "lively", "hopeful", "honest", "mellow", "sturdy", "tender", "vivid", "witty", "zesty", "noble", "merry", "serene", "spry", "plucky", "radiant"],
    "nouns": ["river", "hill", "leaf", "sparrow", "baobab", "palm", "harbour", "lantern", "meadow", "pebble", "breeze", "cedar", "comet", "dune", "ember", "falcon", "garden", "heron", "island", "jasmine", "kestrel", "lagoon", "maple", "orchid", "plateau", "quartz", "reed", "savanna", "thistle", "willow"]
  }
}
$json$::jsonb);
-- community-rules-end

-- ---------------------------------------------------------------------------
-- 5. Launch topics and DRAFT groups (COM-2: no sensitive group; COM-9: weight loss needs the CMO's rules approval)
-- ---------------------------------------------------------------------------
insert into public.community_topics (code, label, description, sort_order, requires_cmo_rules) values
  ('hypertension', 'High blood pressure', 'Living well with high blood pressure.', 10, false),
  ('diabetes', 'Diabetes', 'Living well with diabetes.', 20, false),
  ('weight_loss', 'Healthy weight and habits', 'Steady, healthy habits. No weights, calories or targets.', 30, true),
  ('general_health', 'General health', 'Everyday health, prevention and support.', 40, false);

-- The groups are seeded only where an admin account exists to give them an organisation; a fresh database gets none and the
-- admin creates them in the console. created_by stays null: a seeded group is never attributed to a person.
insert into public.community_groups (organisation_id, slug, name, description, topic_code, rules_text, join_mode)
select a.organisation_id, v.slug, v.name, v.description, v.topic_code, v.rules_text, 'open'
  from (select organisation_id from public.profiles where role = 'admin' and is_active and organisation_id is not null order by created_at limit 1) a
 cross join (values
  ('high-blood-pressure', 'High blood pressure', 'Share what helps you live well with high blood pressure.', 'hypertension',
   E'Be kind. We are all learning.\nKeep phone numbers, emails, links and social media names out of the group.\nDo not sell or promote anything.\nDo not tell anyone to start, stop or change a medicine. Talk to your care team about that.\nThis group is not medical advice. In an emergency, go to your nearest hospital.'),
  ('diabetes', 'Diabetes', 'Share what helps you live well with diabetes.', 'diabetes',
   E'Be kind. We are all learning.\nKeep phone numbers, emails, links and social media names out of the group.\nDo not sell or promote anything.\nDo not tell anyone to start, stop or change a medicine or insulin. Talk to your care team about that.\nThis group is not medical advice. In an emergency, go to your nearest hospital.'),
  ('healthy-habits', 'Healthy weight and habits', 'Steady, healthy habits together.', 'weight_loss',
   E'Be kind. We are all learning.\nPlease do not share weights, calories or target numbers, and no before-and-after posts.\nKeep phone numbers, emails, links and social media names out of the group.\nDo not sell or promote diets, supplements or detox products.\nThis group is not medical advice. If food or weight is hurting how you feel, talk to your care team.'),
  ('general-health', 'General health', 'Everyday health, prevention and support.', 'general_health',
   E'Be kind. We are all learning.\nKeep phone numbers, emails, links and social media names out of the group.\nDo not sell or promote anything.\nDo not tell anyone to start, stop or change a medicine. Talk to your care team about that.\nThis group is not medical advice. In an emergency, go to your nearest hospital.')
 ) as v(slug, name, description, topic_code, rules_text);

-- ---------------------------------------------------------------------------
-- 6. Filter rule set v1: a DRAFT. Contact blocking, selling and promotion, cure claims, medicine instructions, threats, spam.
--    No emergency or self-harm rules: the CMO writes and signs those (OQ-COM-05). Activating v1 is an admin or CMO act.
--    These patterns are moderation holds, not clinical thresholds; the CMO still reviews the whole set when signing.
-- ---------------------------------------------------------------------------
insert into public.community_filter_rule_sets (version, status, params, notes)
values (1, 'draft', '{"allowed_hosts": ["tarragonhealth.ng", "www.tarragonhealth.ng", "app.tarragonhealth.ng"]}'::jsonb,
        'Seeded draft. PROPOSED: the CMO reviews every pattern when signing. No emergency or self-harm rules yet.');

insert into public.community_filter_rules (rule_set_version, class, kind, pattern, action, note) values
  (1, 'contact', 'detector', 'phone_digits', 'block', 'Phone and account numbers, including spaced, spelled-out and look-alike digits'),
  (1, 'contact', 'detector', 'email', 'block', 'Email addresses, including at/dot spellings'),
  (1, 'contact', 'detector', 'url', 'block', 'Any link that is not on the Tarragon allow-list (exact hostname)'),
  (1, 'contact', 'detector', 'handle', 'block', 'Social media style @names'),
  (1, 'contact', 'regex', '\y(?:dm|inbox|pm) me\y|\y(?:call|text|whatsapp|message|contact|reach|add|chat) me (?:on|at|via|through|privately|in private)\y|\ysend me a (?:dm|message|text)\y|\yprivate message\y', 'block', 'Asking to move the conversation out of the group'),
  (1, 'contact_platform', 'regex', '\y(?:whats ?app|telegram|snap ?chat|instagram|facebook|tiktok|twitter|wa\.me|t\.me)\y', 'hold', 'Naming an outside app: a moderator looks'),
  (1, 'commerce', 'regex', '\y(?:for sale|selling|i sell|we sell|order now|place an order|discount|promo code|account number|delivery available|available at|dm for price)\y', 'hold', 'Selling and promotion'),
  (1, 'cure_claim', 'regex', '\y(?:cure|cures|cured|reverse|reverses|reversed|reversal)\y.{0,40}\y(?:diabetes|hypertension|blood pressure|sugar|cancer|hiv)\y|\y(?:herbal|herbs|detox|miracle)\y|\yno more (?:drugs|tablets|medication|insulin)\y', 'hold', 'Cure and product claims'),
  (1, 'medicine_instruction', 'regex', '\y(?:stop|quit|skip|abandon|throw away)\y (?:taking |using )?(?:your |ur |the |all |those |these )?(?:drugs?|tablets?|pills?|medicines?|medication|insulin|metformin|amlodipine|lisinopril|losartan|glibenclamide|nifedipine)\y', 'hold', 'Telling others to stop a medicine (second person; "I skip my tablets" is not matched)'),
  (1, 'medicine_instruction', 'regex', '\y(?:don''?t|do not) take\y (?:your |ur |the |any |those |these )?(?:drugs?|tablets?|pills?|medicines?|medication|insulin|metformin|amlodipine|lisinopril|losartan|glibenclamide|nifedipine)\y', 'hold', 'Telling others not to take a medicine'),
  (1, 'medicine_instruction', 'regex', '\y(?:increase|double|reduce|cut) (?:your|the|ur) (?:dose|dosage|tablets?)\y', 'hold', 'Telling others to change a dose'),
  (1, 'abuse', 'regex', '\y(?:i will|i''?ll|i''?m going to|im going to) (?:kill|beat|hurt|find) (?:you|u)\y|\yi know where you live\y', 'hold', 'Threats'),
  (1, 'spam', 'regex', '(.)\1{9,}|\y(?:click here|free money|make money|investment opportunity|forex|bitcoin|crypto)\y', 'hold', 'Spam and get-rich-quick');

-- ---------------------------------------------------------------------------
-- 7. Self-check: nothing was switched on, no sensitive group, no safety rule invented
-- ---------------------------------------------------------------------------
do $$
begin
  if (select is_on from public.go_live_guards where key = 'community') is distinct from false then
    raise exception 'community self-check: the guard must be born off';
  end if;
  if exists (select 1 from public.community_groups where status <> 'draft') then
    raise exception 'community self-check: a seeded group is not a draft';
  end if;
  if exists (select 1 from public.community_filter_rules where action = 'safety') then
    raise exception 'community self-check: the seed must not contain emergency or self-harm rules';
  end if;
  if exists (select 1 from public.community_filter_rule_sets where status <> 'draft') then
    raise exception 'community self-check: the seeded rule set must be a draft';
  end if;
  if (private.go_live_conditions('community', null)) is null then
    raise exception 'community self-check: go_live_conditions has no community branch';
  end if;
end $$;

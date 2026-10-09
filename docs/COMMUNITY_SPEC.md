# Community: patient peer-support groups

> **Status: design only. Nothing here is built, and no migration has been written.** This is a design and
> reconciliation document, not a build order. It follows the house convention of the other `*_SPEC.md`
> files. Building starts only after the founder answers the blocking questions `OQ-COM-01` to `OQ-COM-04`
> in `docs/COMMUNITY_OPEN_QUESTIONS.md` (to be folded into `docs/OPEN-QUESTIONS.md` section E). Dated 2026-10-09.
> Verify every table, function and column named below against the live schema before the first migration
> (see the standing lessons in `CLAUDE.md`).

## 0. What was asked, and the one conflict to settle first

Founder request (2026-10-09): patients can join communities by topic (hypertension, diabetes, weight loss,
general health, and more); a Tarragon admin can create new groups; moderation blocks sharing of phone
numbers, emails and similar. All three phases are to be built, in order.

**This collides with `docs/BUILD-SPEC-v5.md` Part C.1** (line 2174): "Public feeds, public profiles, public
maps and body-metric leaderboards ... Stigma, location-safety risk and eating-disorder triggers;
unmoderatable by a small team." Module 17 (line 1709) repeats it: "No public feeds, profiles or
body-metric leaderboards." The v5 plan for community is private cohorts with challenges and anonymised
group totals only (S69, `docs/v5-sessions/S69-module-17-care-circle-and-community.md`).

The proposal below is deliberately **not** the thing C.1 forbids. It is members-only (sign-in required, an
adult Tarragon account), pseudonymous (system-issued handles, no profile pages, no photos), topic-scoped,
text-only, with no direct messages and no body-metric leaderboards. But C.1's last clause is a staffing
claim, and the honest reading is that this feature needs a moderation capacity the company may not have yet.
So the design is built to be **dormant behind a go-live guard** and to scale moderation load down with
mechanisms (pre-moderation for new members, hold-by-default on risky patterns, report thresholds) rather
than assume a large team. `OQ-COM-01` asks the founder to confirm the reading explicitly, because per
`CLAUDE.md` a v5 conflict is written down and the piece stops until decided.

## 1. Goals and non-goals

Goals
- Give a patient with a long-term condition people who understand it, which is the main reason people keep
  logging readings and taking medicines.
- Feed the existing paid funnel (a doctor's time, the 12-week programme) without free consults in groups.
- Never become a route by which a patient's condition, identity or phone number leaks.
- Never become a place where a medical emergency goes unseen.

Non-goals (all deliberate)
- No direct messages between members. DMs are the main route to off-platform contact exchange and selling.
- No images, files, voice notes, links or embeds in Phase 1 and 2. Images carry phone numbers and faces.
- No public pages, no search-engine indexing, no share-out buttons (spec: "No WhatsApp sharing").
- No leaderboards, no ranking of members, no display of any reading or body metric.
- No advertising and no pharma or brand sponsorship (C.1).
- No use of community activity for risk scoring, pricing, sponsor or employer reporting (section 5.5).
- No doctor answering free in a group (the doctor's time is the paid product). Doctor content is pinned,
  reviewed, authored once, and carries real attribution (section 6.3).

## 2. What already exists and is reused (do not rebuild)

| Need | Existing piece | How the community uses it |
|---|---|---|
| Go-live gating (INV-14) | `public.go_live_guards` (S37, migration `20261006183147_s37_go_live_guards.sql`) | New key `community`, `switch_role = 'cmo'`; the whole feature is dormant until it is on |
| CMO-signed safety rules | triage rule-set pattern (`private.triage_rule_sets_guard`, `..._approver_is_cmo`) | Safety-class filter rules can only be activated by the CMO |
| Emergency guidance and path | `emergency_events`, `emergency_source` enum (`20260716224736_emergency_escalation.sql`) | One new enum value, author-initiated only (section 4.4) |
| AI governance | `ai_systems` registry, `runGovernedAi()` (`apps/web/src/lib/ai-governance/`) | Phase 2 AI classifier is a registered, advisory-only system |
| Attribution of clinician content | null-gated `ReviewedByDoctor`, `reviewed_by`, `reviewed_at` | Pinned group content shows "reviewed" only with a real record |
| Private groups, challenges, moderators, opt-out | S69 / Module 17 (`cohorts`, `challenges`, `group_sessions`; **not yet built**) | Phase 3 hands off to it. The moderation tables here are generic so 17.9 reuses them |
| Sponsor and NGO cohorts | `funding_programmes` (`20260922184145_ngo_funded_cohort_schema.sql`), dormant module `ngo_funded_cohort` | Phase 3 sponsor groups; aggregate reporting only |
| Notifications | `public.notifications` with `content_class` CHECK, inbox-first rule | New fixed template, neutral wording (INV-07), section 7 |
| Config for tunables | `packages/shared/src/proposed-config` + mirror tests | Every number in this doc marked PROPOSED goes there, never in code |
| Staff console | `apps/console`, `CONSOLE_AREAS` in `packages/auth/src/console-areas.ts` | Moderation area is built in the console directly. Read `docs/design/S01d.md` first |

## 3. Data model

All tables live in `public`, have RLS enabled, an explicit `grant ... to authenticated` (new tables get no
automatic grant, and `anon` gets none, per the standing lessons), and `organisation_id` where it makes
sense. **Decision needed on the org column: `OQ-COM-07`.** Default proposed: every group row belongs to the
single Tarragon platform organisation, and membership, not organisation, controls access.

### 3.1 Core

`community_groups` (admin-created only)
- `id`, `organisation_id`, `slug` unique, `name`, `description`, `rules_text`, `rules_version int`
- `topic` text check against a small admin-managed list (hypertension, diabetes, weight_loss, general_health,
  and more are rows in `community_topics`, not enum values, so an admin adds a topic without a migration)
- `sensitivity` check in (`standard`, `sensitive`). Sensitive groups are hidden from browse and search,
  join by invitation or approved request only, and are **not created at launch** unless `OQ-COM-02` says so
- `join_mode` check in (`open`, `request`, `invite`)
- `min_age int not null default 18`
- `status` check in (`draft`, `active`, `read_only`, `archived`)
- `moderated_hours` jsonb (declared staffed hours, drives the new-member rule in 4.2)
- `created_by`, `created_at`, `updated_at`. Hard delete is blocked; archive instead

`community_topics`: `code` pk, `label`, `sort_order`, `is_active`.

`community_memberships` (the only place a profile is tied to a group)
- pk (`group_id`, `profile_id`); `handle` text; `avatar_code` text (preset set only)
- `role` check in (`member`, `moderator`) ; `status` check in (`pending`, `active`, `left`, `suspended`, `banned`)
- `rules_accepted_version int`, `rules_accepted_at`, `joined_at`, `left_at`, `muted_until`
- `approved_post_count int` (drives trust level, 4.2)
- unique (`group_id`, `handle`), case-insensitive. **Handles are per group**, not per account, so someone in
  both a diabetes group and a sensitive group cannot be linked by handle

`community_posts`
- `id`, `group_id`, `author_profile_id`, `parent_post_id` (one level of reply only, enforced), `body` text
  check (length between 1 and the PROPOSED limit, default 2000)
- `state` check in (`visible`, `held`, `auto_hidden`, `removed`, `deleted_by_author`)
- `hold_reason_code`, `filter_rule_set_version`, `created_at`, `edited_at` (edits allowed 15 min, re-scanned)
- `removed_at`, `removed_by`, `removed_reason_code`

`community_reactions`: (`post_id`, `profile_id`) pk, `kind` check in (`support`). One kind only. No counts
are shown in `sensitive` groups.

### 3.2 Moderation (generic, so S69 17.9 can reuse it)

- `community_reports`: `id`, `subject_kind` (`post`, later `cohort_post`), `subject_id`, `reporter_profile_id`,
  `reason_code`, `detail` (length-limited), `status`, `created_at`, `resolved_by`, `resolved_at`. Unique per
  (`subject_id`, `reporter_profile_id`)
- `community_sanctions`: `id`, `profile_id`, `group_id` nullable (null = platform-wide), `kind` check in
  (`warning`, `mute`, `suspend`, `ban`), `starts_at`, `ends_at`, `reason_code`, `issued_by`, `appeal_state`
- `community_moderation_events`: **append-only** (same trigger pattern as `triage_events_append_only`).
  `id`, `subject_id`, `action`, `actor_id` (null for the system), `reason_code`, `filter_hits jsonb` (rule ids and
  classes only, **never the matched text**), `created_at`
- `community_filter_rule_sets`: versioned (INV-16). `version`, `status` (`draft`, `active`, `retired`),
  `approved_by`, `approved_at`, `content_hash`. A DB guard makes a rule set containing any `safety` or
  `emergency` class rule activatable only by an account that is the CMO (mirrors
  `private.triage_rule_sets_approver_is_cmo`)
- `community_filter_rules`: `rule_set_version`, `class`, `pattern`, `action`, `note`. Classes and actions are
  in 4.3

### 3.3 Safety and content

- `community_safety_signals`: `id`, `post_id`, `author_profile_id`, `kind` (`emergency_language`,
  `self_harm_language`, `reviewer_concern`), `status`, `emergency_event_id` nullable, `handled_by`,
  `handled_at`, `created_at`. Readable only by safety reviewers (5.4)
- `community_pinned_content`: `id`, `group_id`, `title`, `body`, `authored_by` (clinical_staff), `reviewed_by`
  (clinical_staff, nullable), `reviewed_at` (nullable), `pinned_at`. The shared "reviewed by" component renders
  only when both review columns are set (null-gated rule)
- `community_staff`: `profile_id`, `scope` check in (`moderator`, `safety_reviewer`, `admin`), `group_id`
  nullable, `granted_by`, `granted_at`, `revoked_at`. Grants, not an account role (see `OQ-COM-03`)

### 3.4 Not stored

No table links a community membership to a clinical table, a sponsor, an employer, an HMO, a voucher or a
risk score. There is no foreign key from any clinical table to a community table, and a repo test asserts it
(section 9).

## 4. Moderation pipeline

All writes go through `SECURITY DEFINER` RPCs with `set search_path = ''`. The browser can never insert into
`community_posts` directly. The database is the system of record for filtering so no client can bypass it. A
TypeScript mirror of the normaliser exists only to give the author instant feedback, with a drift test
against a shared fixture of positive and negative examples (the same technique as the `*-mirror.test.ts`
files).

### 4.1 Submit path: `community_submit_post(group_id, parent_id, body, client_request_id)`

1. Caller is authenticated, adult (age from the profile's date of birth, verify the column name), has an
   `active` membership, accepted the current `rules_version`, is not muted or sanctioned, and the group is
   `active`.
2. Rate limit per member (PROPOSED: posts per hour and per day, blocked-attempt cool-down). `client_request_id`
   makes a retry safe.
3. **Normalise** (`private.community_normalise_text`): Unicode NFKC, strip zero-width and bidi characters,
   fold look-alike characters (Cyrillic and full-width digits, `O`/`0`, `l`/`1` inside digit runs), lowercase,
   convert number words to digits ("zero eight zero three" to `0803`), remove separators between digits
   (spaces, dots, dashes, parentheses, emoji), expand "at"/"dot" and `[at]`/`(dot)` email forms.
4. Run the **active rule set** over the normalised text (4.3). The result is a decision, never a string.
5. Apply the decision (4.3), write a `community_moderation_events` row, return a status the app renders with
   kind, non-accusing wording from `packages/i18n`.

### 4.2 Trust levels and staffing-proof defaults

A small team cannot read everything, so the system reads less by design:
- **New members** (fewer than a PROPOSED number of approved posts, default 3): every post is `held` until a
  moderator approves it. Approved posts increment `approved_post_count`.
- **Established members**: posts publish immediately after the filters pass; reports and thresholds do the
  rest.
- **Outside declared moderated hours**: new-member posts stay held until hours resume. Established members
  keep posting; reports auto-hide at a lower threshold.
- A member whose post was removed for a `block` or `hold` class reason in the last PROPOSED days drops back
  to pre-moderation.

### 4.3 Rule classes and actions

| Class | Examples (normalised) | Action | Author sees |
|---|---|---|---|
| `contact` | digit runs of 7+ after folding; `+234`, `080/081/070/090/091` prefixes; emails incl. "at/dot" forms; **any** URL or domain; `wa.me`, `t.me`, "whatsapp", "telegram", "ig:", "@name" handles; "dm me", "call me", "inbox me"; bank-account style 10-digit runs | `block` (post not stored, only hit class logged) | "Please keep contact details out of the group. Your care team can help you reach people safely." |
| `commerce` | prices, "buy", "order", "delivery", "available at", "contact me for", brand lists | `hold` | "A moderator will look at this first." |
| `cure_claim` | "cure", "reverse diabetes in N days", "herbal" plus outcome words, "detox" | `hold` | same |
| `medicine_instruction` | "stop taking", "don't take your drugs", "increase your dose", "skip your tablets" | `hold` + nudge | "Talk to your care team before changing any medicine." |
| `abuse` | slurs, threats, harassment, sexual content, doxxing words | `hold`; repeat offender, `auto sanction` ladder | same |
| `self_harm` | CMO-signed list | **withhold**, show crisis resources, raise a safety signal (4.4) | crisis card, not a rejection |
| `emergency` | CMO-signed list of first-person emergency phrasing | **withhold**, show emergency guidance, raise a safety signal (4.4) | emergency card |
| `spam` | repeat text, rapid duplicates, all-caps floods | `block` or `hold` | neutral message |

Notes
- `contact` blocks rather than holds, because the harm is immediate and the false-positive cost is a retyped
  sentence. The text is **not stored**, so a blocked attempt cannot itself leak a number into our database.
- Probing is expected ("zero8o three"). Every blocked attempt counts toward a short cool-down, and repeated
  blocks escalate through the sanctions ladder (warn, 24h mute, 7 days, ban). Each rung and each count is
  PROPOSED config.
- `self_harm` and `emergency` rules, plus their user-facing wording, belong to clinical governance. They ship
  inactive until the CMO signs the rule set. Until then the platform shows the standing safety banner but
  does not claim it is detecting anything (no fake assurance).
- The first release launches with the deterministic classes only. No language model is in this path (INV-01
  spirit: safety logic is code first).

### 4.4 Safety hand-off (the important part)

A community post must never become a place where an emergency is missed, and must never turn a false alarm
into an alert to someone's family.

1. A `self_harm` or `emergency` hit **withholds** the post (peers never see it) and returns a card to the
   author at once: the existing emergency guidance ("go to the nearest hospital now" for emergency language;
   the human crisis response for self-harm, see `OQ-COM-05`), with the care-team path.
2. The system writes a `community_safety_signals` row and a `community_moderation_events` row.
3. The author can choose **"Alert my emergency contact"**. That is an explicit tap, and it invokes the
   existing emergency path (`emergency_events`, with a new `emergency_source` value `community_post`,
   added in a migration that lands **before** any migration that uses it, because a new enum value cannot be
   used in the transaction that adds it). **There is no auto-notify of an emergency contact from a
   community post**, because the phrase match cannot tell "my chest is tight now" from "my mum had chest pain
   last year", and a false positive must not message a patient's family.
4. A safety reviewer is paged on the signal. They are staff with the `safety_reviewer` grant, see only the
   flagged post and the handle, and can release the post, keep it withheld, or escalate. Escalation to the
   care team (revealing identity and the excerpt to a clinician) is the only de-pseudonymising step in the
   product. It needs the author's consent recorded at join time, with counsel-approved wording
   (`OQ-COM-06`). Without that consent the reviewer can only message the author in-app.
5. Free-plan carve-out (`CLAUDE.md`, 2026-08-10): Free consumes no doctor time. The patient safety card and
   the self-initiated emergency path work on every plan. A care-team **task** from a flagged post is a
   paid-plan feature behind a new feature flag, mirroring `vitals_red_flag_doctor_escalation`. The wording
   of the Free-plan experience is `OQ-COM-05`.
6. The same safety rules run on **replies** and on **edits**.

### 4.5 After publish: reports and queues

- Any member can report a post. Reporter identity is hidden from the author and visible only to moderators.
- N distinct reporters (PROPOSED, default 3) set `state = 'auto_hidden'`, pending review. A single report
  from a moderator hides immediately.
- Queue order: safety signals, then abuse, then contact leaks that slipped through, then commerce, then other.
  Target response times are PROPOSED config, not constants in code.
- A removed post leaves a tombstone ("removed by a moderator") so replies still make sense. The removed body
  is kept for a PROPOSED retention window for appeals and abuse evidence, then purged. Retention values are a
  proposal until counsel confirms them (`OQ-COM-06`; the general retention proposals are in OQ-263).

### 4.6 Phase 2 addition: AI second pass

A model may only add a **hold** or a **flag**. It can never remove a post, apply a sanction, or clear a
safety signal, and it is never in the self-harm or emergency path. It is registered in `ai_systems` (next
free `AI-0nn` code, owner role named, `fallback_behaviour` required, `is_enabled` default false) and every
call goes through `runGovernedAi()`. No evaluation run, prompt approval or knowledge-source approval is
seeded (those are a human's judgement). If governance switches it off, the deterministic filters and the
human queue carry on unchanged.

## 5. Row-level security

### 5.1 Principles

- Staff and institutions get **nothing** by being staff. `private.is_org_staff()` is **not** used by any
  community policy and must not be widened (it gates about 110 tables). Clinicians, care coordinators,
  org admins, HMO and corporate admins, payer staff, pharmacists, lab partners, finance and analysts are all
  refused. Only the `community_staff` grants below can read moderation data.
- The base tables are not readable by members. Members read through RPCs that return the **handle**, never
  `profile_id` (RLS is row-level, not column-level, so column hiding needs the RPC boundary).
- Every function: `revoke all ... from public` then `grant execute ... to authenticated`. `anon`
  inherits execute through the `PUBLIC` pseudo-role, so revoke from `public`, and verify live with
  `has_function_privilege('anon', ..., 'EXECUTE')` for every function (the recurring gotcha).
- A new function overload on anything already called with untyped literals needs every call site re-cast in
  the same migration. This design adds no overloads of `can_read_clinical`, and does not touch it.
- Group data is not a clinical record. Even so, the `reproductive_health` lesson applies in spirit: write each
  policy fresh, do not copy an older sibling table's shape, and prove refusal with a simulated session.

### 5.2 Policy matrix (target)

| Table | Member (active) | Member (own row) | `moderator` (their group) | `safety_reviewer` | admin | superadmin | all other roles |
|---|---|---|---|---|---|---|---|
| `community_groups` | list `active` non-sensitive via RPC | | read | read | CRUD | CRUD | none |
| `community_memberships` | none (RPC returns handles only) | read/update own (leave, avatar) | read (handle, status, no identity) | none | read (no identity) | identity only via unmask RPC | none |
| `community_posts` | feed via RPC, `visible` only | read own, any state | read all states in group | read flagged | read | read | none |
| `community_reactions` | via RPC | write own | none | none | none | none | none |
| `community_reports` | insert via RPC | read own | read | read | read | read | none |
| `community_sanctions` | none | read own | write in group | none | write | write | none |
| `community_moderation_events` | none | none | read in group | read | read | read | none |
| `community_safety_signals` | none | read own status (no internals) | none | read/update | none | read | none |
| `community_filter_rules*` | none | | none | none | draft | draft | none (activation of safety classes: CMO only) |
| `community_pinned_content` | via RPC | | read | | CRUD (clinical authors only for body) | | none |

### 5.3 Pseudonymity protections

- Handles are **issued by the system** from a word list plus digits and can be re-rolled, never typed. This
  makes "put your number in your handle" impossible.
- Avatars are a preset set only. No uploads, so no faces and no stray text in images.
- Real-identity resolution is a single RPC, `community_unmask_member(group_id, handle, reason)`, granted to
  superadmin only, reason of at least 20 characters, written to `audit_log` and to a notification to the
  CMO and the DPO. It exists for safety and for lawful requests, and is rate-limited.
- Group membership must be absent from the admin patient search and any admin or clinician "patient 360"
  view (INV-12 and the admin global search): a membership in a diabetes group reveals a condition. A test
  asserts the search result shape contains no community field.
- Institutions (employers, HMOs, payers, NGOs, sponsors) see **no** community data, and no counts per
  organisation. Counts for a small cohort are re-identifying, so any later aggregate respects a minimum group
  size (PROPOSED, S38 "smallest group shown" pattern).

### 5.4 Roles for staff

Grants, not a clinical tier, so `CLAUDE.md`'s "never re-split the account role" rule is untouched:
`community_staff.scope = moderator | safety_reviewer | admin`. Whether a moderator logs in as a new account
role or as an existing staff role plus a grant is `OQ-COM-03`. Whichever it is, the capability is a separate
function `private.is_community_moderator(group_id)` that never calls `is_org_staff()`.

### 5.5 What community data must never feed

Risk scores, `patient_risk_scores`, sponsor reports, employer or HMO reports, price or eligibility decisions,
marketing audiences, ad targeting (there is none), the AI Coach context, research exports. Group membership is
never inferred into the clinical record ("joined the diabetes group" does not add a diagnosis). The AI Coach
does not read community posts. A repo test greps for community table names outside the community module.

## 6. Experience

### 6.1 Patient (web `apps/web`, then mobile `apps/mobile`)

- Browse (non-sensitive groups only), group page with rules summary, a "Not medical advice" banner, join,
  accept rules, receive a handle, feed, post, reply, support reaction, report, leave, mute a group.
- Posting always shows the safety footer ("In an emergency go to your nearest hospital"). The emergency
  guidance content is bundled offline, as elsewhere (INV-06).
- Leaving a group removes the member's handle link. The member's earlier posts are tombstoned or deleted at
  the member's choice (default: delete the body, keep a "former member" tombstone so replies read correctly).
- The community tab is inert for under-18s (`OQ-COM-04`) and for accounts that have not verified.
- Everything works with no notification ever delivered (house rule).
- Copy rules: "your care team", never "your doctor"; no "cure", "instant doctor" or "free healthcare"; no
  em dashes; English only (en-NG); all strings in `packages/i18n`, none in components.

### 6.2 Admin and moderation (`apps/console`)

- Group management (create, edit rules, change status, archive), topic list, rule-set editor (draft), the
  moderation queue, the safety queue, sanctions, appeals, and basic health counts.
- Read `docs/design/S01d.md` and add the area to `CONSOLE_AREAS` before building. Never widen the console to a
  role whose area has not been extracted.
- Creating a group does not need a deploy: a row, a rules text, a topic, a moderator assignment.

### 6.3 Doctor-reviewed content (the funnel, without free consults)

- A small number of pinned posts per group, authored by a clinician, reviewed by a second clinician, signed
  off by the CMO for the group template. Rendered with the shared null-gated attribution component. No
  `reviewed_by`/`reviewed_at`, no "reviewed" badge.
- Each group carries a fixed call to action to the paid per-piece-of-work flow ("Ask your care team"), never
  a free consult. The feature does not change prices or the services catalogue.

## 7. Notifications

- Inbox first. Push and email are optional and never required for any action (INV-07 and the house rule).
- One fixed template key (for example `community_activity`). Its body is a fixed string: no group name, no
  handle, no post excerpt, no condition word (a lock screen reveals a condition). The lint test for clinical
  terms must pass for it.
- Verify the allowed `content_class` values in the live CHECK, and add one for community if none fits. Do not
  reuse a clinical class.
- Per-group mute, a global "no community notifications" switch, and quiet hours. Default for push is off;
  digests (Phase 2) are opt-in.
- Never SMS (INV-08). Never WhatsApp.

## 8. Go-live guard and rollout

`go_live_guards` key `community`, `switch_role = 'cmo'`, with `enforced_in` listing every place that checks it
(RPCs, web route, mobile route, console route). It may only be switched on when all of these are true and
recorded in the change note:
1. A named moderator and a named safety reviewer exist, with declared hours (`OQ-COM-03`).
2. The CMO has signed filter rule set v1 including the safety and emergency classes.
3. The crisis-response path for `self_harm` has a named human owner (`OQ-COM-05`).
4. Counsel has approved the join consent text (`OQ-COM-06`).
5. The under-18 and sensitive-group decisions are recorded.
6. A tabletop run of the safety hand-off passed with a test account (`is_test`, INV-13).

Test accounts are excluded from all community metrics and cannot see real members' groups unless flagged.

## 9. Tests (the guard rails, not afterthoughts)

Every confirmed behaviour below gets a `BEGIN/ROLLBACK` proof in `packages/db/tests/`, registered in
`ci.manifest`, with at least one **sabotage step** that reverts the fix and confirms the test fails.

DB proofs
1. Non-member, left, suspended and banned members read nothing.
2. Each staff role (clinician, care_coordinator, admin without grant, hmo_admin, corporate_admin, payer_admin,
   provider_org_staff, pharmacist, lab_partner, finance, analyst, ngo_admin) is refused every community table.
   Control: a granted moderator succeeds.
3. The feed RPC never returns `profile_id` or any identity column (structural check of the returned shape).
4. A fixture of contact-detail variants is blocked, with a matching fixture of innocent text that must pass
   (BP "140/90", dates, doses "500 mg", pregnancy weeks, 7-digit non-phone numbers where reasonable). Run the
   same fixture in Jest against the TypeScript mirror (drift test).
5. A `contact` block stores no body text anywhere (inspect every table).
6. `held` and `auto_hidden` posts are invisible to other members.
7. Rule set safety classes cannot be activated by anyone but the CMO.
8. New-member pre-moderation, rate limit, and cool-down escalate as configured.
9. `has_function_privilege('anon', f, 'EXECUTE')` is false for every community function; `authenticated` true.
10. Unmask requires superadmin, a long reason, writes `audit_log`, notifies.
11. A sensitive group is absent from browse and search for a non-member.
12. Under-18 cannot join; the age check cannot be bypassed by editing the profile after joining.
13. Account deletion removes or tombstones the member's posts per policy.
14. No clinical, sponsor, voucher or risk table references a community table; no community table is read by
    the risk, sponsor, AI Coach or admin-search code paths.
15. The emergency hand-off creates no emergency event without the author's tap.

App tests
- Jest next to the code for the normaliser mirror, the submit-result mapping, the notification template lint,
  and the pinned-content null-gating. Following the existing `jest.mock("@/lib/supabase/server", ...)` shape.
- `/code-review high` before each PR, naming consent/privacy and silent-failure classes. `/code-review ultra`
  for any change touching RLS on these tables, because of the PHI exposure class this feature adds.

## 10. Phased build plan (sequential; each phase ends with the guard still off until the owner flips it)

Migrations: always take the timestamp from the tool or the clock, never hand-typed. Before applying, check
`list_migrations` on the live project for anything recent you do not recognise. Splice only your own types
into `database.types.ts`; never regenerate it wholesale. Ship the code first, the schema second for any
removal. Add new enum values in an earlier migration than the one that uses them.

### Phase 1: Moderated topic groups (text only)

- Schema: topics, groups, memberships, posts, reactions, reports, sanctions, moderation events, rule sets and
  rules, safety signals, pinned content, staff grants, `emergency_source` value, guard row.
- RPCs: browse, join and leave, accept rules, submit post, edit, delete own, react, report, feed, my groups,
  mute, plus moderator and admin RPCs, and the unmask RPC.
- Filters: deterministic classes (4.3), normaliser, rule set v1 with the CMO-signed safety classes inactive
  until signed.
- Safety: guidance card, signal queue, author-initiated emergency path.
- Surfaces: web patient screens, console moderation and safety queue, notification template and inbox item.
- Proofs: section 9, items 1 to 15.
- Launch groups: hypertension, diabetes, weight loss, general health. Everything else is an admin row.

### Phase 2: Scale the moderation, deepen the value

- Trust levels and peer moderators (volunteer `moderator` role in a group, powers limited to hold and report).
- AI second pass (4.6), registered and advisory only.
- Programme-linked groups for the 12-week chronic-care programme, with a cohort start date.
- Staff-posted scheduled threads and clinician "ask us anything" windows (paid-flow call to action).
- Group digests, discovery and search for non-sensitive groups, and mobile (`apps/mobile`) screens.
- Paid-plan care-team task from a flagged first-person emergency post, with the consent from `OQ-COM-06`.
- Appeals workflow and moderator quality sampling (a second moderator re-reviews a sample).

### Phase 3: Connect to private cohorts and live support

- Hand-off with S69: private cohorts (church, mosque, union, estate, workplace), challenges and anonymised
  totals, using the generic moderation tables. Individual values never appear in challenge views.
- Sponsor and NGO groups tied to `funding_programmes`, aggregate reporting only, minimum group size applied.
- Clinician-led live audio sessions for programme members (17.8), on the video provider interface already in
  place. No recording of members.
- Opt-in buddy pairing (pseudonymous, structured prompts, no free-form DM).
- Images or voice notes **only if** pre-moderated, scanned for contact details, and approved in a written
  founder decision. Default: not built.
- Sensitive groups if `OQ-COM-02` approves them, each with its own moderator, consent and hidden listing.

## 11. Known risks, stated plainly

| Risk | Why it is real | Mitigation in this design |
|---|---|---|
| Moderation load exceeds staff | This is C.1's stated reason | New-member pre-moderation, hold-by-default on risky patterns, dormant behind a guard that requires named staff and hours |
| Condition leakage | A membership list is a condition list | Per-group handles, no DMs, no admin-search exposure, neutral notifications, no institutional access |
| Missed emergency | Patients post instead of using the vitals flow | Signed deterministic emergency rules, immediate guidance card, safety queue, author-initiated emergency path |
| False emergency alert to family | Phrase match cannot read intent | No auto-notify from a community post |
| Contact exchange and fraud | Common in health groups | No DMs, no links, no images, normalised digit and email detection, blocked text not stored |
| Cure and product selling | Widespread in Nigerian health groups | `commerce` and `cure_claim` holds, sanctions ladder |
| Peer medical advice | "Stop your tablets" | `medicine_instruction` hold, standing banner, nudge to the care team |
| Eating disorders (weight loss groups) | Named in C.1 | No numeric body-metric display or ranking; `self_harm`/`emergency` list covers disordered-eating language once the CMO signs it; group rules text approved by the CMO |
| Minors | Safeguarding exposure | Adults only until `OQ-COM-04` is decided |
| Regulatory | NDPA sensitive data, health claims | Counsel review of consent and retention before the guard goes on |

## 12. Not decided here

Everything in `docs/COMMUNITY_OPEN_QUESTIONS.md` under `OQ-COM-01` to `OQ-COM-10`. The four that block any build are
01 (the Part C.1 conflict), 02 (sensitive groups at launch), 03 (who moderates, and how many hours), and 04
(under-18 policy).

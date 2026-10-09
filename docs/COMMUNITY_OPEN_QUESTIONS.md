# Community open questions (OQ-COM-01 to OQ-COM-10)

Raised 2026-10-09 with `docs/COMMUNITY_SPEC.md`. **To be folded into `docs/OPEN-QUESTIONS.md` as section E**
(that file is about 310 KB, which the tooling used to push this branch could not rewrite safely; a session with
local git should append this text there and delete this file).

Numbered `OQ-COM-nn` on purpose: the plain OQ-nnn sequence already has several parallel-branch collisions
(for example OQ-170 to OQ-185 each appear twice), and this section should not add another. Nothing in the
community feature is built until 01 to 04 are answered. 05 to 07 must be answered before the go-live guard
`community` can be switched on. 08 to 10 can wait for their phase.

### OQ-COM-01 Does the founder's community request override Part C.1? (BLOCKS ALL BUILD)
- Blocks: every community migration, screen and function.
- Conflict: `docs/BUILD-SPEC-v5.md` C.1 (line 2174) says do not build "public feeds, public profiles, public maps and body-metric leaderboards" because they are "unmoderatable by a small team", and Module 17 (line 1709) repeats "No public feeds, profiles or body-metric leaderboards". v5's community is private cohorts, challenges and anonymised totals only (S69). The 2026-10-09 request is for condition groups (hypertension, diabetes, weight loss, general health, more) with posts, created by an admin. The design in the spec is members-only, pseudonymous, text-only, with no DMs, no profile pages, no photos, no links and no leaderboards, so it is not "public", but it is a feed, and the staffing clause in C.1 still applies. The request message did not mention C.1, so it is not yet a written decision that waives it.
- Options: (a) confirm: members-only moderated topic groups are allowed, C.1 is read as forbidding public and body-metric surfaces, the feature ships dormant behind the `community` go-live guard (recommended); (b) confirm but narrow Phase 1 to fewer groups (for example hypertension and diabetes only) until moderation capacity is proven; (c) keep C.1 as written and fold community into S69 cohorts only (no open topic groups).
- Recommend (a) with the launch narrowing of (b) as a policy inside the guard, not a code change: the admin simply activates groups one at a time. The guard (`OQ-COM-03`, `-05`, `-06`) is what answers C.1's staffing concern.
- Decision: pending. On confirm, copy the outcome into `docs/DECISIONS.md` and add one line to C.1 saying members-only moderated topic groups are permitted.

### OQ-COM-02 Sensitive groups at launch? (BLOCKS BUILD of the group creation form and the browse list)
- Blocks: group visibility rules, the sensitive-tier consent, `reproductive_health`-adjacent topics.
- Question: which, if any, of these exist at launch: HIV, mental health, sexual and reproductive health, pregnancy and fertility, substance use, eating disorders, women's health. These carry the highest harm if membership leaks, and the reproductive tier has the repeated RLS regression history in `CLAUDE.md`.
- Options: (a) none at launch; the schema supports `sensitivity = 'sensitive'` but no sensitive group is created until a later decision (recommended); (b) women's health and pregnancy only, invite or approved-request join, hidden from browse; (c) all of them with a named moderator each.
- Recommend (a). Launch with hypertension, diabetes, weight loss and general health. Revisit after the first moderated quarter. Mental health groups additionally need a human crisis owner (`OQ-COM-05`) and are not an AI or peer-moderated space.
- Decision: pending.

### OQ-COM-03 Who moderates, in which hours, and as what kind of account? (BLOCKS BUILD of the console area; BLOCKS GO-LIVE)
- Blocks: the console moderation area, `community_staff` grants, the go-live guard condition 1.
- Question: C.1 says a small team cannot moderate a feed. Who actually does it? (1) Named moderators and a named safety reviewer, employed, freelance, or both. (2) Declared moderated hours (Africa/Lagos). (3) Whether a moderator is a new `user_role` value (like `finance`, `analyst`, `lab_liaison`) or an existing staff role plus a `community_staff` grant. The `CLAUDE.md` rule against splitting the account role is about clinical tiers; a moderator is operational, but it is still a role-model decision.
- Options: (a) one named safety reviewer and one or two moderators, declared weekday hours plus a weekend sweep, a `community_staff` grant on an existing non-clinical staff role, no new enum value (recommended); (b) a new `community_moderator` account role; (c) outsource moderation to a vendor (a processor-register and data-sharing question, extends OQ-268).
- Recommend (a). The spec already makes new-member posts wait for review outside declared hours, so thin staffing slows posting rather than letting unreviewed posts through.
- Decision: pending.

### OQ-COM-04 Under-18 policy (BLOCKS BUILD of the join rule)
- Blocks: the age check, group `min_age`, the S69 cohort rules, extends OQ-129 (consultations are adults only) and OQ-154 (written questions for under-18s).
- Question: can a child or adolescent be a member? There is a live parent/dependant model (`profile_access`) and a paediatric module, and a guardian can already act for a dependant; a child posting in a pseudonymous group is a safeguarding exposure the platform has not carried before.
- Options: (a) adults only (18 and over) for every group at launch, no exceptions, enforced from the profile's date of birth and re-checked on every post (recommended); (b) 16 and 17 allowed in a separate moderated group with a guardian waiver; (c) children allowed in guardian-supervised groups only.
- Recommend (a). Revisit with counsel and the CMO. A caregiver or parent uses their own account; no one posts as a dependant.
- Decision: pending.

### OQ-COM-05 Safety wording, the crisis owner, and what a Free patient gets (BLOCKS GO-LIVE; CMO)
- Blocks: the `community` guard (condition 2 and 3), activation of rule-set classes `self_harm` and `emergency`.
- Question: (1) The CMO must write and sign the emergency and self-harm phrase lists and the card wording, as with triage (OQ-88, OQ-251); no list is invented by engineering. (2) Who answers a self-harm signal, and how fast (the platform has no named human crisis owner for this yet; Part C requires "immediate human crisis response"). (3) The Free-plan rule (`CLAUDE.md`, 2026-08-10) says Free consumes no doctor time; on Free a flagged post gets the guidance card and the self-initiated emergency path but no care-team task. Is that acceptable, and what is the honest wording? (Compare OQ-251, where TRI-002 promised a review Free patients do not get.)
- Options: (a) CMO signs v1 lists; a named safety reviewer owns the self-harm queue within a PROPOSED target; Free gets the card and the path only, with wording that makes no promise of a clinician review (recommended); (b) the same, but the care-team task also applies on Free for self-harm only (a deliberate exception to the 2026-08-10 rule, needs a written founder decision).
- Decision: pending.

### OQ-COM-06 Consent and retention for community data (BLOCKS GO-LIVE; counsel)
- Blocks: the `community` guard (condition 4), the safety escalation, deletion behaviour.
- Question: (1) The join consent text, including the one case where a pseudonym is resolved to a person: a safety escalation to the care team, and a lawful request. (2) Retention of removed posts for appeals and evidence, retention of reports and moderation events, and what happens to posts on account deletion (there is no executable erasure path yet, OQ-262; retention periods are all empty, OQ-263, and are proposals until counsel confirms them). (3) Whether group membership is "sensitive personal data" under NDPA 2023 for the DPO register, given that a membership list can reveal a condition.
- Options: (a) counsel drafts the consent and retention text; proposed defaults are in the spec (PROPOSED config) until then (recommended); (b) ship with only the in-app messaging path for safety (no identity to the care team without a separate in-the-moment consent).
- Decision: pending.

### OQ-COM-07 Which organisation owns a community group?
- Blocks: the `organisation_id` column on the community tables, RLS shape.
- Conflict: `CLAUDE.md` says every table has `organisation_id` and RLS filters by it. A topic community must span organisations, otherwise a hypertension group for one employer's staff and another for a second is just a set of private cohorts (that is S69, not this).
- Options: (a) every group belongs to the single Tarragon platform organisation; membership, not organisation, gates access; institutions have no access at all (recommended; document it as the one deliberate exception to org-wide filtering); (b) per-organisation groups only; (c) both, a `scope` column, with cross-org groups owned by the platform organisation.
- Decision: pending. Needs `/code-review ultra` on whichever is chosen.

### OQ-COM-08 Volunteer (peer) moderators (Phase 2)
- Blocks: Phase 2 trust levels only.
- Question: may an experienced patient become a group moderator with limited powers (hold, report, never remove or sanction)? A peer sees post content, which may be sensitive, and the moderator can infer who is active.
- Options: (a) not at launch; revisit after Phase 1 data (recommended); (b) yes in non-sensitive groups with training, a code of conduct and removable at any time; (c) never.
- Decision: pending.

### OQ-COM-09 Weight loss and other higher-risk topics (Phase 1 group rules)
- Blocks: the rules text for the weight-loss group, the CMO's approval of the group template.
- Question: C.1 names eating-disorder triggers as a reason for the leaderboards rule. A weight-loss group invites weight and body talk. Should the group forbid numbers (weights, calories, target weights), diet-product talk and "before and after" posts, and should "fasting" and "detox" claims always hold? Related to the C.1 intermittent-fasting row.
- Options: (a) rules ban weights, calories and target figures; the CMO approves the template; weight-loss is framed as healthy habits, with a pinned reviewed post on when to see the care team (recommended); (b) allow numbers, hold only on cure and detox claims; (c) do not launch a weight-loss group.
- Decision: pending.

### OQ-COM-10 Links, images, voice notes and direct messages (default: never in Phases 1 and 2)
- Blocks: nothing in Phase 1 or 2 (they are not built). Phase 3 only.
- Question: the spec forbids direct messages and all of these attachments because each is a route for contact exchange, selling and identifying images. Confirm that, and decide whether images or voice notes may ever be added (pre-moderated, scanned, written founder decision), and whether a link to a Tarragon-owned page (for example a pinned education article) may be allowed through an allow-list while every other URL stays blocked.
- Options: (a) no DMs ever; no images or voice in Phases 1 and 2; an allow-list for Tarragon links only (recommended); (b) also allow images in Phase 3 behind pre-moderation; (c) allow no links at all.
- Decision: pending.

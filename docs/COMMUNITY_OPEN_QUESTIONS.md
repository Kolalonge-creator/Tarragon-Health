# Community open questions (OQ-COM-01 to OQ-COM-10): ALL DECIDED 2026-10-09

Raised 2026-10-09 with `docs/COMMUNITY_SPEC.md`. **To be folded into `docs/OPEN-QUESTIONS.md` as section E and
copied to `docs/DECISIONS.md`** (that file is about 310 KB, which the tooling used to push this branch could
not rewrite safely; a session with local git should append this text there and delete this file).

Answered in-session on 2026-10-09 by the founder, who is also acting as CMO. Two things this does **not** do:
(1) it does not sign the CMO's in-system acts. The community filter rule set (v1) with its `self_harm` and
`emergency` phrase lists and card wording, the weight-loss group template, and the `community` go-live guard
switch are still separate acts by the CMO account, recorded in the system (see the go-live list at the end).
(2) it does not waive any invariant: INV-14 (go-live guard) applies regardless.

Numbered `OQ-COM-nn` on purpose: the plain OQ-nnn sequence already has parallel-branch collisions.

## Summary of decisions

| ID | Decision |
|---|---|
| 01 | Allowed. Topic groups open to **Free and paid members alike** (membership is not required). Ships dormant behind the `community` guard |
| 02 | No sensitive groups at launch |
| 03 | Small named team; `community_staff` grant on an existing non-clinical staff role; no new account role |
| 04 | Adults only, 18 and over |
| 05 | Free member gets the safety card and their own emergency button; no promise of a clinician review |
| 06 | Consent at join, counsel drafts the text |
| 07 | One Tarragon-owned space; institutions see nothing |
| 08 | No peer moderators at launch |
| 09 | Weight-loss group bans weights, calories and targets; CMO approves the template |
| 10 | No DMs ever; Tarragon-owned links only; no images or voice in Phases 1 and 2 |

---

### OQ-COM-01 Does the founder's community request override Part C.1? -- DECIDED
- Blocks: every community migration, screen and function.
- Conflict: `docs/BUILD-SPEC-v5.md` C.1 (line 2174) bans "public feeds, public profiles, public maps and body-metric leaderboards" as "unmoderatable by a small team"; Module 17 (line 1709) repeats it. v5's community was private cohorts, challenges and anonymised totals only (S69).
- Decision (founder, 2026-10-09, free-text answer): "People on both free tier and members should be able to join groups. This will help to build more people that can join membership too." Read as: yes, build members-only topic groups; access is **not** gated by plan; community is an acquisition route into the paid membership. The answer did not address the dormant-guard option, and **does not need to**: the `community` guard is INV-14 and stays. If this reading is wrong, say so before the guard is switched on.
- Consequences: (1) no plan check anywhere in the community code paths; a Free member can read, post, react and report like anyone else. (2) Posting does not create doctor-time cost, so the 2026-08-10 Free rule is untouched (see OQ-COM-05). (3) A membership upgrade prompt may appear as a fixed, non-condition-naming call to action (never an ad, never based on what the member posted or which group they are in). (4) Add one line to C.1 saying members-only moderated topic groups are permitted and public, profile-based or metric-ranked surfaces remain forbidden. Copy to `docs/DECISIONS.md`.

### OQ-COM-02 Sensitive groups at launch? -- DECIDED
- Decision (founder, 2026-10-09): none at launch (recommended option). Launch groups: hypertension, diabetes, weight loss, general health. The schema keeps `sensitivity = 'sensitive'` for later; no sensitive group is created without a new written decision. Mental health additionally needs a human crisis owner first.

### OQ-COM-03 Who moderates, in which hours, and as what kind of account? -- DECIDED (names and hours still to be filled in)
- Decision (founder, 2026-10-09): a small named team: one named safety reviewer plus one or two moderators, declared weekday hours plus a weekend sweep, via a `community_staff` grant on an existing non-clinical staff role. **No new `user_role` value.** New-member posts wait for review outside declared hours.
- Still owed before go-live (guard condition 1): the actual names, their accounts, and the declared Africa/Lagos hours.

### OQ-COM-04 Under-18 policy -- DECIDED
- Decision (founder, 2026-10-09): adults only, 18 and over, for every group, no exceptions. Enforced from the profile's date of birth and re-checked on every post. A caregiver or parent uses their own account; nobody posts as a dependant. Extends OQ-129 and OQ-154.

### OQ-COM-05 Safety wording, the crisis owner, and what a Free patient gets -- DECIDED (CMO acts still owed)
- Decision (founder, 2026-10-09): a Free member whose post is flagged gets the **immediate safety card** and their **own one-tap emergency-contact button**. No promise of a clinician review is made on Free. Paid plans may additionally get a care-team task (Phase 2, behind a feature flag, with the consent from OQ-COM-06). No exception to the 2026-08-10 Free rule is made for self-harm.
- Still owed from the CMO as in-system acts before go-live (guard conditions 2 and 3): (a) write and sign the `self_harm` and `emergency` phrase lists and the card wording as part of filter rule set v1; (b) name the human who owns the self-harm queue and the target response time (PROPOSED config). This decision picks the Free-plan behaviour; it does not write or sign those lists.

### OQ-COM-06 Consent and retention for community data -- DECIDED (counsel text owed)
- Decision (founder, 2026-10-09): consent at join, in plain language: Tarragon may identify you to your care team only if a post suggests you may be in danger. Counsel drafts the wording. Without that consent the reviewer can only message the member in the app.
- Still owed before go-live (guard condition 4): counsel-approved consent text; retention for removed posts, reports and moderation events (PROPOSED defaults in the spec until then); the erasure behaviour on account deletion (depends on OQ-262); whether membership counts as sensitive personal data on the DPO register.

### OQ-COM-07 Which organisation owns a community group? -- DECIDED
- Decision (founder, 2026-10-09): one Tarragon-owned space. Every group belongs to the Tarragon platform organisation; membership gates access; employers, HMOs, payers, NGOs and sponsors see no community data and no per-organisation counts. This is the one deliberate exception to org-wide filtering and must be documented in the migration header. Requires `/code-review ultra` on the RLS.

### OQ-COM-08 Volunteer (peer) moderators -- DECIDED
- Decision (founder, 2026-10-09): not at launch. Staff moderators only. Revisit in Phase 2 with real data.

### OQ-COM-09 Weight loss and other higher-risk topics -- DECIDED (CMO approval owed)
- Decision (founder, 2026-10-09): the weight-loss group bans weights, calories, target figures and before-and-after posts, and is framed as healthy habits. Diet, detox and fasting claims are held. A pinned reviewed post says when to see the care team.
- Still owed: the CMO approves the group rules text and the pinned post (null-gated review attribution), as an in-system act.

### OQ-COM-10 Links, images, voice notes and direct messages -- DECIDED
- Decision (founder, 2026-10-09): no direct messages ever. No images or voice notes in Phases 1 and 2. Every outside link is blocked; **only links to Tarragon-owned pages are allowed**.
- Build note for the allow-list: parse the URL and match the **exact hostname** against a short list kept in versioned configuration (never a substring or suffix test, so `tarragonhealth.ng.example.com` and `tarragonhealth.ng@evil.com` are rejected). Normalise first (case, punctuation, look-alike characters) so obfuscated links are still caught. The contact filter test fixtures must include allowed, look-alike and obfuscated cases.

---

## Spec amendments to apply to `docs/COMMUNITY_SPEC.md`

1. Section 0 and 1: state that groups are open to Free and paid members alike; no plan gate in any code path (OQ-COM-01).
2. Section 4.3, `contact` row: "any URL or domain" becomes "any URL or domain except an exact-hostname match on the Tarragon allow-list" (OQ-COM-10).
3. Section 4.4 item 5 and Phase 2 care-team task: unchanged, restated as Free = card + own button only (OQ-COM-05).
4. Section 3.1 `community_groups.organisation_id`: always the Tarragon platform organisation (OQ-COM-07).
5. Section 6.1: add the fixed membership call to action rule (OQ-COM-01 consequence 3).
6. Phase 2: remove "peer moderators" from the default scope (OQ-COM-08 is no at launch; revisit only on data).

## What unblocks, and what still blocks go-live

Phase 1 build is **unblocked**: OQ-COM-01 to 04 are decided. The `community` guard stays off until all of the
following are recorded in the system:
1. Named moderators and safety reviewer, with declared hours (OQ-COM-03).
2. CMO-signed filter rule set v1, including the `self_harm` and `emergency` classes (OQ-COM-05).
3. A named human owner and target time for the self-harm queue (OQ-COM-05).
4. Counsel-approved join consent text and retention values (OQ-COM-06).
5. CMO approval of the weight-loss group rules and pinned post (OQ-COM-09).
6. A tabletop run of the safety hand-off with a test account (`is_test`).

# Community: Clinical Safety Case and Hazard Log

**Status: DRAFT v0.1, 13 October 2026. Not signed.** Prepared for the Chief Medical Officer to read, correct and, if satisfied, sign.
Nothing in this document has been approved by anyone. It becomes version 1.0 only when the CMO records their sign-off (see section 9).

**Scope:** the patient Community feature (members-only, adult, pseudonymous, text and pre-moderated pictures, topic groups, doctor question sessions).
**Out of scope:** direct messages, voice or live video and public groups (none exist, decision COM-26); any automatic picture-checking vendor (hook built, off, COM-24).
**Design record:** `docs/COMMUNITY_SPEC.md`. **Decisions:** `docs/DECISIONS.md` (COM-1 to COM-26). **Wording of the safety rules:** `docs/community/CMO_SAFETY_TERMS_PROPOSAL.md`.
**Method:** a hazard log in the style of a clinical risk-management file (hazard, cause, harm, controls, residual risk, owner, status). The scales below are this file's own; no regulator has reviewed them.

## 1. What the feature is, in one paragraph

Adults (18 and over, date of birth required) who live with a condition such as high blood pressure or diabetes can join topic groups and talk with each other under a made-up name that is different in every group. The team can see the made-up name and the words, never the person, except in one case: when a post suggests someone may be in danger, a doctor, the CMO or an administrator may look up who wrote it. Moderators and safety reviewers are named staff on a rota. The feature is off. It cannot be switched on until the go-live conditions are met and the CMO presses the switch.

## 2. Safety argument

The main clinical risk of a peer-support group is **harm that goes unseen**: someone in danger writes something and nobody acts, or peers give advice that harms. The design answers this in layers, and each layer is independent of the others:

1. **Prevent** most harmful content reaching members (adults only, blocked contact details, held posts for risky wording, every new member's first post and every picture checked by a person first).
2. **Detect** danger in words (the CMO's emergency and self-harm rules) and by members (a report that says someone may be in danger raises a safety signal).
3. **Respond fast and visibly:** the post is withheld, the author is shown a care card at once, a safety reviewer is alerted, and an overdue alert fires if nobody has looked.
4. **Keep the people safe who can see identity:** a lookup needs a live concern, a written reason and is limited and announced.
5. **Prove it works before launch:** a rehearsed safety drill, a staffed 24-hour rota and a running overdue check are launch conditions.

The argument is only as strong as its weakest layer. **Section 6 lists what is still open. Launch should wait until the items marked "before launch" are closed.**

## 3. Risk scales

| Severity | Meaning |
|---|---|
| 5 Catastrophic | A death or lasting serious harm to a member |
| 4 Major | Serious harm or a serious privacy breach |
| 3 Moderate | Avoidable distress or a harmful decision a person could recover from |
| 2 Minor | Inconvenience, no harm |
| 1 Negligible | No effect |

| Likelihood | Meaning (per year, after controls) |
|---|---|
| 5 Frequent | More than monthly |
| 4 Probable | A few times a year |
| 3 Occasional | About once a year |
| 2 Remote | Less than once a year |
| 1 Improbable | Not expected |

Risk = severity × likelihood. **1-4 low, 5-9 medium, 10-14 high, 15-25 unacceptable.** Likelihoods before launch are estimates, not measured: there is no live data yet.

## 4. Hazard log

Controls named here exist in the shipped database and application code and are covered by the proof scripts in `packages/db/tests/community_*.sql` and the application tests. "Open" means not done.

| ID | Hazard | Possible harm | Controls in place | Sev | Lik | Residual | Open actions |
|---|---|---|---|---|---|---|---|
| H1 | A member writes about harming themselves or an emergency and the rules do not catch the words | Death or serious harm | The CMO's emergency and self-harm rules (16 phrases and patterns, approved 12 Oct); a report of "someone may be in danger" raises a safety signal; any moderator can hand a post to a safety reviewer; a rota covers every hour | 5 | 3 | **15 unacceptable on paper** until the drill and the rota are done | Review a sample of live posts weekly for misses; add patterns the CMO approves; accept that text rules cannot catch everything |
| H2 | A safety post is caught but nobody looks in time | Death or serious harm | The post is withheld; the author sees a care card at once; an overdue alert fires after 30 minutes and every 10-minute check is recorded; Community cannot be switched on unless the overdue check has run in the last 45 minutes; a rota covering all 168 hours is a launch condition | 5 | 2 | 10 high | **Before launch:** name the safety reviewers and fill the rota; run and record the drill; add the two secrets the overdue check needs |
| H3 | The care card cannot start the emergency flow, or gives the member nothing to act on | Delay in getting help | The emergency start is a separate route with its own failure message that tells the member to call their contact or go to the nearest hospital; retries are de-duplicated | 5 | 2 | 10 high | **Before launch:** the self-harm card names no helpline or number. The CMO decides whether to add a verified local number. Test the emergency start on a real phone |
| H4 | A peer tells another to stop or change a medicine | Harmful medicine change | Wording held for a moderator ("stop taking...", "do not take...", dose changes); group rules forbid it; pinned doctor-reviewed notes; "not medical advice" shown | 4 | 3 | 12 high | Watch the hold rate and false holds in the first month; the CMO reviews the patterns |
| H5 | Cure claims and product selling reach members | Harmful purchase or treatment | Held for a moderator; selling words held; links and contact details blocked | 3 | 3 | 9 medium | None beyond monitoring |
| H6 | Disordered-eating content in the weight group | Harm to someone vulnerable | The group's rules need the CMO's approval before it can go live; numbers, calories and before-and-after posts are banned by rule; related wording is held, three severe phrases go to a safety reviewer; pictures cannot be turned on for that topic | 4 | 3 | 12 high | **Before launch:** the CMO approves the Healthy weight rules. Consider whether this group should open later than the others |
| H7 | A member's condition is disclosed through the group (re-identification) | Serious privacy harm | Made-up names different per group; no profile page; the community tables can only be reached through checked functions, not by any client or the server key; notices carry fixed text and no content; employers, insurers and sponsors can read nothing; consent states this | 4 | 2 | 8 medium | **Before launch:** counsel has not reviewed the consent text (recorded honestly in the go-live note) |
| H8 | Staff look up a member without good reason | Privacy harm, loss of trust | Lookup works only with a live safety concern from the last 30 days, needs a written reason of at least 20 characters, is limited to 5 a day, is written to a private log, and the CMO is told every time; a missing name and a missing concern look identical; moderators and safety reviewers cannot look anyone up | 4 | 2 | 8 medium | Review the lookup log monthly |
| H9 | A person under 18 uses the groups | Exposure of a child to adult content or strangers | An adult check (date of birth, active, not merged, not a dependant account) on every action; fails closed when the date is missing | 4 | 2 | 8 medium | Spot-check accounts without a date of birth after launch |
| H10 | Contact exchange, grooming or harassment | Harm to a vulnerable adult | Phone numbers, emails, links and social handles are blocked; no private messages exist; reports, mutes, suspensions and bans; a member can hide one person | 4 | 2 | 8 medium | None beyond monitoring |
| H11 | Harmful content waits too long in the moderation queue | Harm while it is visible or held | A new member's first post is held; a queue-overdue alert fires after 60 minutes; three reports hide a post automatically | 3 | 3 | 9 medium | Staff the rota as above |
| H12 | The filter rules are missing or broken | Unchecked posts | With no live rule set, posting is refused; a rule set cannot go live without the four contact-blocking rules, and cannot drop the safety rules once they have been live; slow patterns are refused when saved | 4 | 1 | 4 low | None |
| H13 | A picture shows something harmful or identifying | Privacy harm or distress | Pictures are off by default; every picture waits for a moderator; location data is stripped; files are in a private store served only after a check; pictures are never enabled for the weight topic | 3 | 2 | 6 medium | None |
| H14 | A member is removed or banned wrongly and is distressed | Distress, loss of support | Appeals decided by a different moderator; a share of decisions rechecked by a second moderator; a member in crisis is never turned away with "slow down" and a muted member's danger words still reach the safety path | 3 | 2 | 6 medium | Safety-withheld posts cannot be appealed. This is deliberate and should be reviewed after launch |
| H15 | A doctor question session gives advice a member takes as a consultation | Wrong decision | Text only; limited to named senior doctors; real name shown; answers refused if they contain contact details; limited questions per member; the group states it is not medical advice | 3 | 2 | 6 medium | Wording check on the session page before the first session |
| H16 | Removed or deleted posts are kept too long | Privacy breach | Removed and deleted text is wiped after 90 days; deleting an account unlinks posts from the person | 2 | 2 | 4 low | None |
| H17 | Members use the group instead of seeking care | Delayed care | Every group rule and card says to go to the nearest hospital in an emergency; the group is described as not medical advice | 4 | 2 | 8 medium | Review wording after the first month |

## 5. What the evidence is

- **Database proofs** that run on every change: access and isolation, posting and safety, filters and rule sets, the extra controls (appeals, sampling, hiding), pictures, rota and the overdue check, and search. Each includes a check that fails when the protection is removed.
- **Application tests** for each screen, including accessibility checks.
- **Live checks of 13 October 2026:** all 26 community tables locked to checked functions only; no public or signed-out access to any community function; the switch is off; no safety rules are live yet.
- **Not yet evidence:** a rehearsed drill, a staffed rota, real moderators, real members, or counsel's view. There is no operating history.

## 6. What must happen before launch

1. Name the moderators and safety reviewers, and fill all 168 hours of the rota (admin).
2. Run the safety drill end to end and record it (CMO). It must pass.
3. Add the two settings the overdue check needs so it runs every 10 minutes, then confirm it has been seen running.
4. Load and sign the emergency and self-harm rules (CMO).
5. Approve the Healthy weight group rules (CMO).
6. Decide whether the care cards should carry a verified helpline or number (CMO), and test the emergency start on a real phone.
7. Counsel reviews the consent text. It can be recorded as accepted now with that stated, but launch to the public should not rely on it alone.
8. Agree who reads the weekly sample of posts for missed danger and how quickly the rules are updated.

## 7. Residual risk statement (draft)

If items 1 to 6 are done, the highest remaining risks (H1, H2, H4, H6) fall to medium or high rather than unacceptable, and rest on text rules and on named people responding within the stated times. If they are not done, **H1 and H2 are unacceptable and the feature should not be switched on.** This statement is a draft for the CMO to change.

## 8. After launch

- Review the first month's holds, safety signals, false alarms, appeals and lookups, and update the likelihoods in section 4 from real numbers.
- Re-run the drill at least every 90 days. The go-live condition checks this.
- Any change to the safety rules, the consent text or the topic list is a new version of this document.

## 9. Sign-off

| | |
|---|---|
| Document and version | Community Clinical Safety Case and Hazard Log, v1.0 (becomes v1.0 only when signed) |
| Prepared by | Claude (drafting assistant) on 13 October 2026, from the shipped design and tests. Not a clinical author. |
| Reviewed and signed by | _Chief Medical Officer: name, date. Not yet signed._ |
| Corrections made at review | _CMO to list_ |
| Recorded on the platform | Sign-off hub, Community groups, "The clinical safety case", note naming this title, version and signer |

The CMO should read sections 4 and 6 closely. A hazard missing from section 4, a control claimed here that does not exist, or a likelihood that feels wrong is a reason to change this document before signing, not after.

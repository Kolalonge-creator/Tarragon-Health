# Community: audit against competitor health communities (2026-10-09)

Scope: public guidelines and published research for Mayo Clinic Connect, Inspire, Diabetes UK forum,
PatientsLikeMe, Beyond Type 2 and Noom. Omada's peer groups: no public detail found (only that groups are small
and programme-bound). This compares policies and structure, not pixel layouts; none of these products was used
hands-on. Our side is checked against `docs/COMMUNITY_SPEC.md` and the built pages.

## What the competitors do, and how we compare

| Area | Competitor practice | Tarragon Phase 1 | Verdict |
|---|---|---|---|
| Personal information | Mayo: advises against phone, address, email; staff remove it afterwards. PatientsLikeMe: same advice, uses private messages instead. | Blocked before posting (phone, email, handle, link detectors, evasion-resistant normaliser). Blocked text is never stored. No DMs. | Stronger than all. |
| Pseudonyms | Inspire: strongly recommends not using real name. | Per-group system-issued handles, no profile ids in any member or staff output, unmask is audited and notifies the CMO. | Stronger (enforced, not advised). |
| Moderation timing | Mayo: posts go live at once, report-driven, enforcement rare. | Pre-moderation for first 3 posts, then automatic filters plus reports; auto-hide at report threshold. | Safer, slower for newcomers. Watch drop-off. |
| Reporting | Inspire: anonymous report on every post and profile. | Report on every post; reporter never shown to the author. | Matches. |
| Medical advice | Mayo, Diabetes UK: share your own experience, do not tell others what to do; not a substitute for care. | Medicine-instruction and cure-claim rules, a group-level disclaimer, reviewed clinician notes pinned in groups. | Matches, plus clinician-reviewed pins. |
| Staffed moderators | Inspire: professional moderators. Mayo: staff plus volunteer mentors. | Small named team via `community_staff`; no peer moderators (COM-8). | Matches Inspire; skips Mayo's mentors by decision. |
| Crisis handling | Few publish one. Noom reporting: coaches with 300-400 users each, untrained for acute mental health; its eating-disorder screen can be bypassed. | Emergency and self-harm text is withheld, shown only to the author and a safety reviewer, author gets guidance at once; moderators cannot see it. Needs the CMO-signed word lists. | Stronger on design; empty until signed. |
| Weight loss | Noom's risk is eating disorders in a coached setting. | Weight-loss group bans weights, calories and targets; no leaderboards. | Appropriate. Disordered-eating terms must be in the CMO safety list. |
| Member controls | Inspire and Diabetes UK: ignore or hide a specific member; public or private posts. Diabetes UK: split off-topic threads. | Mute a whole group only. No hide-a-handle. No thread splitting. | GAP (see below). |
| Search and discovery | Mayo, Diabetes UK: searchable archives. | No search by decision (privacy); browse by topic only. | Deliberate difference. |
| Small cohorts | Omada-style programme groups are small. | Open groups, any size. | Open question: very large groups feel anonymous and harsh to newcomers. |

## Gaps found, ranked

1. **Hide a handle (Inspire, Diabetes UK).** A member cannot stop seeing one person who upsets them, short of
   reporting or leaving. Small to build (a per-membership hidden list, applied in the feed RPC). Proposed for
   Phase 2; no schema blocker. Worth doing before wide launch.
2. **Disordered-eating language is only covered if the CMO puts it in the safety lists.** Add a checklist line:
   starving, purging, laxative abuse, "stop eating", extreme fasting. This is a CMO signing item, not code.
3. **Newcomer friction from pre-moderation (first 3 posts).** Mayo posts immediately. Measure time-to-approve and
   first-post drop-off in the first month; the count is PROPOSED config, so it can be lowered without a deploy.
4. **No thread splitting or moving.** Low priority with one-level replies.
5. **Group size.** Decide a soft cap or a "new members welcome thread" per group before launch. Needs a product
   decision, not code.
6. **Visible moderator presence.** Mayo and Inspire show who the moderators are. We show no staff presence in a
   group. Consider a standing "Tarragon team" notice and the pinned clinician notes as the visible signal.

## What we deliberately do differently

No DMs, no images, no outside links, no search engine exposure, no institutional access, no leaderboards, and a
membership is never shown to any other part of the platform. Competitors accept more openness for engagement;
we accept less engagement for privacy and for the stigma risk of a condition-revealing member list (COM-1, COM-7).

## Limits of this audit

Public documentation only. No competitor product was tried. Moderation staffing numbers and response times are
not public for any of them. The Noom findings come from press reporting, not Noom policy.

Sources: Mayo Clinic Connect guidelines and moderation pages (connect.mayoclinic.org), Mayo "Staying safe in
online patient communities", Inspire guidelines and terms (inspire.com), Diabetes UK forum rules
(forum.diabetes.org.uk), PatientsLikeMe support and terms (patientslikeme.com), Beyond Type 1/2 coverage
(diatribe.org, mightynetworks.com), Noom support FAQ and Business Insider reporting.

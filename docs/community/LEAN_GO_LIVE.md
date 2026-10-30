# Community: lean go-live (2026-10-30)

Founder instruction: Community must go live now, with the fewest sign-offs that still protect people. Too many gates distract the people who have to watch the safety items.

## What was actually in the way

Checked against the live database on 2026-10-30:

| Item | State | Blocks opening? |
|---|---|---|
| Chief Medical Officer signatures (rule set, weight-loss rules, crisis owner, consent, safety case) | All recorded. Rule set v2 is live and CMO-activated; the weight group's rules are approved. Nothing is waiting on the CMO. | No |
| Go-live "conditions" on the Community guard | Under G-01 a feature's conditions are shown for information and never block the switch. | No |
| Parent master `clinical_operations_enabled` | Off, held on hypertension-protocol facts unrelated to a peer group. A feature under a closed master reads closed. | **Yes. This was the real blocker.** Removed by migration `20261030223010`. |
| Moderator and safety reviewer named | None. New members' first posts are held for a moderator, so nobody could post. | In practice, yes. Needs two grants (people, not code). |
| A live group | All four are drafts. The three ordinary topics need no CMO approval; the weight group is already approved. | In practice, yes. Set to active. |
| 24/7 rota, safety drill, safety case | Informational only. | No |
| Overdue-work check | Scheduled but its two GitHub secrets are missing, so it has never recorded a run. It is the alarm for a queue item waiting too long. | No, but turn it on in the first week |

## What stays, and why

- Instant, automatic safety path: a flagged self-harm or emergency post shows the member the safety card and their own emergency-contact button straight away, and the post is held for a safety reviewer. No person has to be awake for the member to be safe.
- First three posts per member are held for a moderator; contact details, links, selling and cure claims are filtered; no direct messages, no voice notes, no leaderboards (COM-1, COM-10).
- Pictures only through the pre-moderated path.
- Anyone can switch Community off at any time, without a note.

## How it compares

Comparison drawn from general knowledge of these products and their published norms. It was not re-verified product by product on 2026-10-30, and the local picture comes from how these groups are commonly run rather than a survey.

| | Public condition forums (Patient.info, Mayo Clinic Connect, Inspire, HealthUnlocked) | Reddit and Facebook groups | WhatsApp and Telegram groups, the usual local choice | Tarragon Community |
|---|---|---|---|---|
| Identity | Username, some real names | Username or real name | Phone number visible to every member | Generated handle and avatar; only the CMO can unmask, for a safety reason, and is told when it happens |
| Moderation | Staff or trained volunteers, post-hoc and pre-moderation for new members | Volunteers, uneven | The group admin, no tools | New members held; every flagged post waits for a named person; clear queue and appeal path |
| Self-harm and emergencies | Signposting to a helpline, manual | Mostly none | None | Automatic safety card plus the member's own emergency-contact button, CMO-signed rules |
| Selling, cure claims, medicine advice | Rules and removal after the fact | After the fact | Rampant; direct messages carry the selling | Filtered before it appears; no direct messages |
| Contact details leak | Possible | Possible | Built in | Blocked by the text filter and by the absence of DMs |
| Open to the public | Often readable by anyone | Yes | By invitation link | Members only |
| Link to care | None or advertising | None | None | Same account as the care team; no ads; a fixed, condition-blind membership prompt only |

Where Tarragon is stricter than the field on purpose, it gives up some of what makes those communities feel lively (private messages, public profiles). That is a founder decision and is not reopened here.

## To open (no signatures)

1. Merge the migration PR.
2. Grant a moderator and a safety reviewer.
3. Set the three ordinary groups, and the approved weight group, to active.
4. Switch the `community` guard on (admin or CMO, with a one-line note).
5. First week: add `COMMUNITY_CRON_URL` and `CRON_SECRET` to the repository secrets (see `OPERATIONS_SETUP.md`), and run one rehearsal with a test account.

# Proposed safety wording for the CMO to review and sign (Community)

Status: a PROPOSAL written by the engineering side. Nothing here is live. Only the Chief Medical Officer can write or activate
emergency and self-harm rules (enforced in the database), and rule set v1 ships without any. Pick, change or discard anything below,
then enter the rules through the admin Community > Rules page (a draft copy of v1 is created, you add the safety rules, you activate it).
Until you sign, nothing is withheld for safety and the group stays off.

How the classes work: a safety rule withholds the post (nobody sees it), shows the writer the matching guidance card straight away,
and puts it in front of a safety reviewer only. A hold rule only sends the post to a moderator. Regex is Postgres, run on lower-cased
text with look-alike characters folded; `\y` is a word boundary; patterns are at most 400 characters.

## Already in the draft as HOLD (moderator sees it; they can send it to a safety reviewer)

Class `eating_disorder`: self-induced vomiting and starving ("starving myself", "make myself throw up", "purge after"), laxatives, diet
pills and slimming teas, eating-disorder vocabulary (pro ana, thinspo, bulimia, anorexia), signs of restriction or body distress
("stopped eating", "only eat once a day", "hate my body", "fasting for 3 days"). Left out on purpose so ordinary talk is not caught:
"water pills" (a normal blood pressure medicine), "skipped lunch", "not eating" and "diet" on their own.

## Suggested for you to sign as SAFETY (decide each)

Self-harm (`self_harm`, shows the self-harm card with the care team message link):
- `\y(?:kill|hurt|harm|cut) myself\y`
- `\y(?:end|take) my (?:own )?life\y`
- `\y(?:want|wanna|going) to die\y|\ywish i (?:was|were) dead\y|\ybetter off dead\y`
- `\y(?:no reason|point) (?:to|in) (?:live|living|go on|going on)\y`
- `\ysuicid(?:e|al)\y`
- `\y(?:overdose|od) on (?:my )?(?:tablets|pills|insulin|metformin|medication)\y`
- `\y(?:stop|stopped) taking (?:my )?(?:insulin|medication|tablets) on purpose\y`   (consider: may also catch non-suicidal talk; moderators decide)

Emergency (`emergency`, shows the "go to the nearest hospital now" card and the author-initiated emergency contact button):
- `\y(?:chest|heart) pain\y.{0,40}\y(?:now|right now|since|spreading|crushing)\y`
- `\y(?:can(?:'|)t|cannot|struggling to) breathe\y`
- `\y(?:face|arm|leg) (?:is )?(?:drooping|numb|weak)\y|\yslurred speech\y|\ysudden(?:ly)? (?:cannot|can(?:'|)t) (?:speak|see|move)\y`
- `\y(?:blood sugar|glucose|sugar) (?:is )?(?:very low|below [0-9]{2})\y.{0,40}\y(?:shaking|confused|faint|unconscious)\y`
- `\y(?:just )?(?:passed out|collapsed|fainted)\y`
- `\y(?:blood pressure|bp) (?:is )?(?:over|above) (?:2[0-9]{2}|1[89][0-9])\y.{0,60}\y(?:headache|chest|vision|confus)\y`

Disordered eating that you may want to treat as safety instead of hold: "making myself sick every day", "have not eaten in days",
"laxatives to lose weight". These would show the self-harm card (class `self_harm`). Decide whether the card wording suits.

## Still owed by you in the system (not things I can do)

1. Sign and activate a rule set that contains your emergency and self-harm rules (go-live condition).
2. Approve the weight-loss group's rules text (`community_cmo_approve_group_rules`).
3. Name the crisis owner (who reads the safety queue, and their hours).
4. Review the wording of the two guidance cards and the consent line with counsel.
5. Run the tabletop test: post a test phrase, watch it withheld, watch the reviewer see it, watch the card appear.

Test every pattern against real, everyday posts (blood pressure and diabetes talk) before activating. The rules page has a "try this
text" check; a pattern that is slow or catches everyday talk is refused or will annoy members.

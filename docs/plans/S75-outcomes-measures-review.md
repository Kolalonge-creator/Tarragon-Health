# outcomes.measures v1: plain-language text for the Chief Medical Officer to read before signing

Prepared 2026-10-07 for the CMO. **Nothing has been signed.** This is the full content of the PROPOSED configuration `outcomes.measures` version 1 (code registry `packages/shared/src/proposed-config/registry.ts`, database table `outcome_measure_config`, migration `20261007213829_s75b_outcome_measures.sql`). You sign it on the go-live sign-off screen. If you ask for changes, the change becomes version 2 and needs its own signature; a version can never be edited after the fact.

How to read the evidence tags (the same convention as the S70 to S75 pack):
- **V** verified against a primary source in this project.
- **SEC** seen in a secondary source (a summary, a review, a search result), primary text not re-read.
- **NV** not verified here. It is a long-standing convention or comes from memory. Treat it as a proposal to check, not as a fact.
- **DESIGN** a choice made for this platform, with no guideline behind it. It needs your clinical judgement, not a citation.

I have not tagged anything V. No primary guideline text was read for this note.

## 1. What happens before you sign, and after
- Until you sign version 1, the HbA1c, weight, PHQ-9 and GAD-7 reports return the words "awaiting the Chief Medical Officer's signature" and **no figure at all**. The sponsor pilot pack shows the same words for those four measures. Data are still collected and stored in the background (one row per person, measure and day), so nothing is lost while you decide.
- If your newest decision is "changes requested", the reports are withheld again. A new version starts unsigned.
- Blood pressure reports (day 90 and day 180) are not behind this gate; they use the earlier configuration (decision S75-1: each person's own home target if set, otherwise 140/90, which can overstate control because home readings run lower than clinic readings).
- No row of any person is ever listed to staff. Reports are group figures only, with small groups withheld (see section 9).

## 2. Who is counted at all (applies to all four measures)
- **Day 0** is the day the person joined (their first Membership or care pack). **Day 90** and **day 180** are 90 and 180 days after that. [DESIGN, same anchor as the blood pressure reports]
- **Adults only: age 18 or over** on the day they joined. Anyone under 18, and anyone with no date of birth on record, is excluded from all four measures and has no value stored. [DESIGN. Adolescent mental-health instruments differ, so they are left out rather than guessed.]
- **Pregnancy** (HbA1c and weight only): anyone currently marked pregnant is excluded from both ends of the comparison. This uses the pregnancy flag as it stands when the snapshot is made, not at the time of the result (open question OQ-381). PHQ-9 and GAD-7 still apply in pregnancy. [DESIGN, following C7 in the pack]
- **Test accounts** never appear in any figure.
- A snapshot is made once its window has closed plus **3 days' grace** for readings that sync late. A reading that arrives after that is never added to the past snapshot (it is counted as a data-quality finding instead). [DESIGN]
- **The result nearest to the target day inside the window is used.** One result per person per day, never an average. [DESIGN]

## 3. HbA1c
- Source: final, corrected or amended laboratory HbA1c results held in the patient's lab history. Preliminary results are ignored. Results in percent are used as they are; results in mmol/mol are converted with percent = 0.09148 x mmol/mol + 2.152. [conversion NV, standard NGSP/IFCC relation from memory]. Any other unit is ignored. A value outside **3.0 to 20.0 percent** after conversion is treated as implausible and ignored. [DESIGN]
- **Windows**: baseline = from **90 days before** joining to **14 days after**; day 90 and day 180 = **plus or minus 30 days** around the day. [DESIGN: HbA1c is only done every few months, so the windows are wide]
- **"Improved"** = HbA1c has fallen by **at least 0.5 percentage points** from the starting value. [NV: commonly used as a meaningful change; confirm]
- **"Under target"** = the follow-up value is **below 7.0 percent**. Shown as a share among those measured. [SEC: the 7% adult target excludes people with frailty or pregnancy; Tarragon excludes pregnancy but does not detect frailty, so the share under 7% is not an individual target. Individual targets set for a patient are not used here.]
- Shown: how many people had a usable result at both ends (the pairs), how many of them improved, the average change, the share under 7%, and **coverage** (of people whose day was due, how many had a usable pair, and how many had nothing recorded) beside every rate.

## 4. Weight
- Source: validated weight readings (readings a clinician has not had to hold). Body weight between 20 and 400 kg only. [DESIGN]
- **Windows**: baseline = 14 days before to 14 days after joining; day 90 and 180 = **plus or minus 14 days**. [DESIGN]
- **"Improved"** = a loss of **at least 5 percent** of the starting weight. [NV: common programme benchmark]
- Pregnant and under-18 members are excluded as above. Weight gain is not counted as a separate finding; a person who gained is simply "not improved". [DESIGN. Say if you want people with a low starting weight excluded, because a loss may not be wanted for them. That is not in this version.]

## 5. PHQ-9 (low mood) and GAD-7 (worry)
- Source: the member's own completed screens in the app.
- **Windows**: baseline = 30 days before to 14 days after joining; day 90 and 180 = **plus or minus 21 days**. [DESIGN]
- **Severity bands by the starting score** (results are always shown by starting band, never as one overall figure):
  - PHQ-9: minimal 0 to 4, mild 5 to 9, moderate 10 to 14, moderately severe 15 to 19, severe 20 to 27. [NV: standard published bands from memory]
  - GAD-7: minimal 0 to 4, mild 5 to 9, moderate 10 to 14, severe 15 to 21. [NV: standard published bands from memory]
- **"Responded"** = the score fell by **at least 50 percent** from the start. **"In remission"** = the follow-up score is **below 5**. [NV for both]
- **Meaningful change values in the configuration**: 5 points for PHQ-9 and 4 for GAD-7. [SEC: the pack notes these are the common figures but estimates vary with starting severity.] They are stored for your reference; the reports use response and remission, not a fixed point rule, and every mental-health table carries the caveat that what counts as meaningful depends on where a person starts and published estimates differ.
- The usual screening cut-off of 10 or more [SEC] is not used to include or exclude anyone.

### The safeguarding rule (PHQ-9 only)
- A PHQ-9 screen counts as **safeguarding** if any one of these is true: the answer to **item 9 (thoughts of self-harm) is above zero**; the screen carries the **crisis flag**; the **total score is 20 or more**. [DESIGN, decision S75-2. These are the lines you asked for; no guideline sets them for a reporting rule.]
- If a safeguarding screen falls in a person's window, that person is **excluded for that day and has no value, no score and no band stored at all**. They are in no figure, so they can never be described, ranked or inferred from a report. Because they have no baseline pair, they also drop out of every later comparison.
- They are **routed to the existing mental-health follow-up**, not to a report. The existing system already raises an emergency event for the crisis flag and a clinician alert for a high band when a screen is saved. As a second safety net, if the outcomes check meets a safeguarding screen that has neither on record, it raises a clinician alert (urgent, 24-hour review) naming the screen. This does not page anyone beyond what the existing route does.
- Their other measures (for example HbA1c) are unaffected: only PHQ-9 is excluded.
- GAD-7 has no equivalent rule in this version. Severe GAD-7 already creates a clinician alert through the existing trigger. Say if you want GAD-7 exclusions added.

## 6. Retention, engagement, programme completion (a separate family, not clinical outcomes)
- **Retained at day 30, 90, 180** = still holding an active Membership or care pack on that day. **Engaged** = logged at least one reading in the 30 days ending that day. [DESIGN]
- **Programme completion** (decision S75-7, founder and CMO): of Memberships and care packs whose term has ended, the share that were **fully used**, meaning every consultation and test item in them was used (or the term ended with the clinical items used). Refunded or cancelled ones are not counted. This is an engagement measure and is never combined with a clinical outcome.

## 7. Response times, escalation and follow-up
- Tasks are grouped by how urgent they were: **urgent = priority classes 1 to 2, soon = 3 to 5, routine = 6 to 9**. [DESIGN, taken from the task priority classes in use]
- Shown per group: share completed, share completed by the due time, share escalated, share handed back, the middle and slowest-tenth time to first claim, and the middle time to completion. Follow-up = the adherence follow-up task type.
- By the tier of the clinician who finished the task, but **only when at least 3 different clinicians stand behind that tier**. No individual clinician is ever named or shown. It is not a ranking and never a reason to deny care. [DESIGN]

## 8. The sponsor pilot pack: the fixed evaluation-design note (word for word)
"What this pack is: a descriptive before-and-after summary of the members who agreed to share group figures, taken at the day they joined and again 90 and 180 days later. There is no comparison group, members were not chosen at random, and the people who stay are not the same as the people who leave. For these reasons the figures describe what happened to these members and cannot show what would have happened without the programme. Differences between months or groups can arise from who joined, not from anything the programme did."

"A change in a measure is not a verdict on the programme. Results for the same programme will differ with who joined, how long they stayed and how often they were measured."

Both are always printed in the pack and cannot be switched off. The pack, the CSV and the PDF are refused if any sentence claims that the programme caused a result (words such as caused, led to, resulted in, because of the programme, saved, return on investment). A sentence that states a limit, such as "this does not show that the programme caused any change", is allowed.

## 9. Small numbers
Any group smaller than **20** people is not shown (30 for a cut by two attributes), and neither is a group with any category of 1 to 19. When one group is withheld the next smallest is withheld too, so it cannot be worked out by subtraction. The number 20 is a founder choice pending counsel or the DPO (OQ-233); the Nigeria Data Protection Act names no number.

## 10. What I would most like you to look at
1. The safeguarding lines (item 9 above zero, crisis flag, score 20 or more) and whether GAD-7 needs one.
2. Whether response (50 percent fall) and remission (below 5) are the right headline for each starting band, especially the minimal band, where improvement is nearly impossible by construction.
3. The 0.5 percentage point HbA1c and 5 percent weight thresholds, and the wide HbA1c windows (plus or minus 30 days).
4. Whether adults-only and the pregnancy rule are what you want, and whether low starting weight should exclude someone from the weight figure.
5. The share under 7 percent, given that frailty is not detected.

The tags above show where I could not confirm a basis. Please treat every NV and DESIGN line as needing your judgement.

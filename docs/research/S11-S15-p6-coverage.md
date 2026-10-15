# P6 coverage: research (2026-10-13)

Tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. Searches were run for the vendors below; where a
vendor publishes nothing about its internal rule, that is stated, not guessed. Nothing was copied (code, text or visual design).

## Silence and adherence tasks for enrolled members
- Omada, Livongo, Hello Heart, Teladoc, Dario, Glooko: no public document found for how many days without a reading raise a coach
  or care-team task, or which devices count [NV]. Omada publishes that device data (scale, glucose, BP) reaches the care team and
  that care-team feedback, not app nudges alone, moved weight outcomes [V]. Adopted: silence is a task for a person, not just a
  nudge, only for enrolled (Member) patients. Not adopted: any vendor's day count; ours is the CMO's signed 7 days in rule set v3.
- Cadence: an out-of-threshold reading raises an alert that a nurse follows up; it reports about 0.2 percent of alerts reach the
  partner physician [V]. Adopted: silence and adherence are amber, never red, and create one routine task, not a page. Unsuitable
  for Nigeria: nurse-first staffing; Tarragon's default is direct doctor review (CLAUDE.md founder principle).
- Heartbeat Health, Livongo care-team consoles: nothing public found [NV].

## Showing a clinician WHY a task exists
- FDA clinical decision support guidance (28 Sep 2022), criterion 4: the software or labeling must give the clinician plain-language
  inputs, logic and validation so the recommendation can be independently reviewed, and a single selected output invites automation
  bias [G]. Adopted: the task page shows rule id, rule set code and version, the grade and the exact facts the rule was given
  (`triage_events.context`), says it is a fixed rule with no model, and the doctor can disagree. Nothing is hidden behind a score.
- NICE Evidence Standards Framework and IMDRF SaMD: not read in full in this pass [NV]; the FDA text above is what shaped the design.
- Omada, Cadence, Hello Heart consoles: no public screens found showing the triggering rule [NV]. Inspiration here is the regulator
  guidance, not a vendor.

## Showing a patient a graded reading
- Omron Connect lists reading categories (reported by a third party as critically high, high, borderline, normal, low) [NV]. Withings,
  Qardio: nothing found [NV]. Adopted: three plain grades (green, amber, red) in words ("No action needed", "Worth another look",
  "Needed prompt attention") beside the approved guidance for that reading, folded away so history stays short. Not adopted: a
  five band label or any condition name; Nigeria's low health literacy and the no-fear-wording brand rule favour three bands.
- Wrist versus upper arm: wrist devices can match arm devices if held at heart level, but positioning is the weak point, and one
  maker argues upper arm is better for home monitoring [V]; Stiftung Warentest found only one wrist model rated good [NV].
  CMO decision Q4 is followed: a wrist reading is graded normally, the clinician sees an upper-arm repeat suggestion, and a red is never
  downgraded for cuff type.

## Unsafe or unsuitable
- Nurse-first escalation (Cadence) and coach-first nudges (Omada) assume a staffing model Tarragon does not run.
- Any vendor "AI summary of why" would break INV-01; ours is a deterministic rule record.

# Ops desk resilience

Who this is for: the person at the ops desk during on-call hours, and the founder, who sets who that is.
Plan reference: `docs/plans/S16-S20-review-and-build-plan.md` decision 10 (final fallback is a named ops person phoning on-call and the CMO) and work item W5.6.
Related: `docs/PLATFORM_OUTAGE_RUNBOOK.md` (platform down), `docs/BUSINESS_CONTINUITY_DR_SPEC.md` (targets and dependencies), `docs/runbooks/on-call-device-setup.md`.

Pages are never sent by SMS or WhatsApp. The last line of defence for an urgent page is a human with a phone. This document makes sure that human can work when the lights or the internet go.

## 1. Power

The grid fails often enough that this is a routine event, not an emergency. For whoever staffs the desk:

| Item | Minimum | Check |
|---|---|---|
| Laptop on battery with the console open | Charged to at least 80 percent at shift start | Look at it at hand-over |
| Inverter or UPS for the laptop, router and phone charger | Enough for at least 4 hours | Pull the mains plug once a month to test it |
| Power banks | Two, charged, for the desk phone and the router | Date written on each; recharge monthly |
| Phone for calls | A normal mobile phone with credit and a charger | Not the same handset used for the console |

PROPOSED: 4 hours of backup. The founder confirms the figure and buys the equipment.

## 2. Internet

- Two independent links: the primary (broadband or fibre) and a second one on a different network (a mobile hotspot on a different carrier from the primary, with data loaded).
- Test the second link monthly by switching the laptop to it and opening `/admin/ops/wall`.
- If the console will not load on either link, phone the CMO and the on-call clinician from the list below using the mobile phone, and work from the paper list. Then follow `docs/PLATFORM_OUTAGE_RUNBOOK.md`.

## 3. When a page expires: who phones whom

An "expired" page means the whole ladder ran out and nobody acknowledged it. It raises an incident and an alarm to the clinical lead and to ops. The ops person on duty does this, in this order, without waiting for anyone to tell them to:

1. Open the page in `/admin/ops/incidents` (the incident title says a page expired) and note the time. Do not open the patient's chart: the desk does not need it.
2. Phone the **primary on-call clinician** (number in section 4). If they answer, tell them there is an unacknowledged page on the On call screen and stay on the line until they say they have it. Write down the time.
3. If no answer within 2 minutes, phone the **backup on-call clinician** the same way.
4. If no answer within a further 2 minutes, phone the **Chief Medical Officer**.
5. If nobody has answered after all three, phone the CMO's named deputy (section 4) and keep trying in turn until someone acknowledges. Record each attempt and its time in the incident.
6. When someone acknowledges, note it and close the loop in the incident. If the cause was a phone problem, ask the clinician to run Device check.

PROPOSED: 2 minute gaps. They are shorter than the 5 and 10 minute page timers on purpose, because by now the patient has already waited. The CMO confirms them.

If the page is for a patient who needs an ambulance and nobody can be reached, the desk follows the emergency instruction in the clinical protocol; it does not wait for a doctor to be found.

## 4. The list (fill in; keep one printed copy and one in the desk phone)

Do not put real numbers in the repository. Keep the list in the place the founder chooses and update it every time the rota changes.

| Role | Name | Mobile | Second number |
|---|---|---|---|
| Ops person on duty | | | |
| Chief Medical Officer | | | |
| CMO's deputy (named by the CMO) | | | |
| Founder | | | |
| On-call primary and backup | Read from the rota, `/clinician/rota` | | |

## 5. Each shift

- At hand-over: laptop charged, power bank charged, both internet links up, phone has credit, list is current.
- Once a week: open `/admin/fire-drills` and read the latest result. Anyone who missed a drill gets a call to run Device check.
- Once a month: test the inverter and the second internet link (sections 1 and 2).

## 6. Open items for the founder

- Name the ops person for each on-call period and a deputy.
- Buy and test the inverter or UPS, the power banks and the second link.
- Confirm the PROPOSED 4 hour backup and the 2 minute call gaps with the CMO.
- Decide where the printed list lives and who keeps it current.

# Protocol drafts awaiting Clinical Director sign-off

Each file here is a **paste-ready draft** for the signing form at
`/admin/settings/protocols` (Sidebar → Settings → Clinical Protocols → Clinical
protocols). Every file contains the four fields that form asks for —
`protocol_id`, Title, Change summary, Protocol content — plus a provenance
section naming the exact file and line where each threshold is implemented, so
review can verify the text against the running code rather than trusting it.

**These are drafts written by an engineer from the implemented behaviour. They
are not clinically approved and must not be treated as approved.** Nothing here
is signed until the Clinical Director reads it and presses Sign. Signing is
append-only: there is no edit or delete, and a correction means signing a new
version.

## What is signed today

| Protocol | Status |
|---|---|
| `chronic_hypertension_who` v1 | signed 2026-08-13 |
| `chronic_diabetes_who` v1 | signed 2026-08-13 |
| `chronic_obesity_who` v1 | signed 2026-08-13 |

## What is live and unsigned

These drive real patient-facing behaviour today with no signed protocol behind
them. Drafts in this folder, in the order I would sign them:

| Draft | Why it matters | File |
|---|---|---|
| `vitals_red_flag_thresholds` | Decides which readings show a patient emergency guidance and which page a clinician. The highest-consequence unsigned logic on the platform. | [vitals-red-flag-thresholds.md](vitals-red-flag-thresholds.md) |
| `escalation_sla_targets` | How long a clinician has to acknowledge each alert class. The live row (v5) contains entries whose own notes say "DRAFT, needs Clinical Director sign-off". | [escalation-sla-targets.md](escalation-sla-targets.md) |
| `womens_health_cycle_red_flags` | Four bleeding-pattern flags shown to patients in the cycle tracker, one of them urgent. Newest, smallest, least entangled. | [womens-health-cycle-red-flags.md](womens-health-cycle-red-flags.md) |

## What does NOT need signing yet

`public.clinical_rules` holds 7 rules, none signed — but **all 7 are `status =
'shadow'`**, meaning they evaluate without acting on a patient. They need
sign-off *before activation*, not now. Signing them today would attest to
behaviour nobody has observed in production.

For the same reason this folder does not draft protocols for the ~47 pure
calculators in `apps/web/src/lib/rules/` that implement a published instrument
unmodified (FINDRISC, CKD-EPI/eGFR, KDIGO, PHQ/GAD scoring). Their protocol is
the published instrument; a Tarragon protocol version would add governance
overhead without adding a clinical decision. If any of them is ever *modified*
away from the published instrument, that modification needs its own signed
protocol — that is the line.

## Reviewing these

The useful question for each threshold is not "is this number reasonable" but
**"is this the number I want a Tarragon doctor held to, given what happens when
it fires"**. Each draft therefore states, per threshold, what the platform
actually does when it trips — patient-facing guidance, a clinician alert, or
both — because that consequence is what is really being signed.

Where a value is Tarragon's own choice rather than lifted from published
guidance, the draft says so explicitly. Those are the lines that most deserve
your attention.

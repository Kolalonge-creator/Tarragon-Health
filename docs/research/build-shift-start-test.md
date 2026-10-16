# Research: shift-start test page (2026-10-16)

Question: how do on-call products and handover practice prove that the person who is about to be paged can actually be reached, and what should Tarragon adapt. Evidence tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. Nothing here was copied; ideas were adapted.

## PagerDuty (test incident and notification rules)
- Responders are told to review their own notification rules and to have a colleague (or themselves) trigger a test incident so the real contact methods fire. A "send test" step exists on integrations and tags the event as a test so it does not look like an outage [V, via third-party and GitLab support handbook; PagerDuty's own page was not retrieved, so [NV] for exact behaviour].
- Adopted: the test uses the real delivery path, is labelled as a test in its wording, and is resolved by the responder, not by the system. Not adopted: any free-text payload (our notice is a fixed template with no patient data, INV-07).
- Unsuitable for Nigeria as copied: PagerDuty's default test escalates to a phone call or SMS. Tarragon never uses SMS or voice for pages (INV-08); push, in-app and email only.

## Opsgenie (Atlassian)
- Atlassian community guidance: schedule a test P1 alert to land when a roster starts so the person coming on call gets a real notification and confirms their contact methods work; delete the test afterwards so reports stay clean [V].
- Adopted directly: the test is sent shortly before the roster starts (lead_minutes, PROPOSED 10), by the real route, once per person per shift. The test is kept as a record (we want latency history) but is excluded from the red-event page counts because it lives in `page_tests`, not `pages`.
- Product note: Opsgenie is being sunset by Atlassian (end of support April 2027) [V]; the pattern outlives the product.

## Squadcast
- A 2026 third-party review says test alerts for notification channels are limited; Squadcast's own support pages describe generating a test alert for alert-source integrations [V/NV conflict, unresolved]. Treated as: not a reliable reference for responder reachability testing. Nothing adopted.

## Shift handover practice (Atlassian-adjacent and general SRE guidance)
- Handover guides say to verify alerting before the outgoing person signs off (a test alert confirmed as received), to get an explicit acknowledgement from the incoming person, to keep a written record, and to keep the outgoing person reachable for a short time [V, third-party handbooks; no Atlassian primary source found, [NV]].
- Adopted: explicit acknowledgement by the incoming person is the gate; the record keeps channel, device and latency; the outgoing cover (the backup) is told when the primary has not confirmed.
- A 2026 study of incident response handover (arXiv 2601.07788) argues for streamlined, evolving handover procedures [P, preprint, not reviewed here beyond the abstract].
- Not adopted: a 30 minute overlap between shifts (Tarragon's rota has no overlap; the lead-time test achieves the same check without a meeting).

## Where the inspiration shows up
- Design: send before start, real route, explicit human acknowledgement, a grace window, and promotion of the backup (docs/design/build-shift-start-test.md sections 2 to 4).
- Code: `private.shift_start_sweep` (send/escalate), `private.shift_start_gap_kind` (not covered), `private.shift_start_promoted` and the `page_recipient` patch (backup first), `describeShiftTest` (instructions when a page never arrived).

## Unsafe or unsuitable
- A test that blocks the real red path. Mitigation: `page_recipient` only changes who is paged first when a confirmed backup exists; with nobody confirmed the old order stands.
- Tests at night that wake people for no reason. Mitigation: it is one test page per person per shift, at the shift start, never between shifts; the CMO can switch the guard off.
- Android battery management on Tecno and Infinix handsets silently drops background push. The test is the practical way to find this before a real page [NV, from the existing S19b checklist guidance].

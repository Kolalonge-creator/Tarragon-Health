# S11-S15 P3 research: reaching a patient with a red alert

Evidence tags: [V] vendor claim, [P] peer reviewed, [G] guideline or regulator, [NV] not verified. Read 2026-10-13. Nothing was copied; each item says what was adapted and where it shows up. No real handset was available, so every Nigerian handset claim is [V] or [NV].

## 1. Missed-dose escalation to a trusted person (Medisafe Medfriend)
- Alert goes to the trusted person only if the reminder is ignored: 30 minutes after the last reminder, fixed interval, the alert says a dose was missed and not which medicine, view-only access [V, Medisafe help centre].
- Adopted: a fixed, generic, content-free escalation after a quiet period, and "any action on the alert counts as acting" (opening, acknowledging or answering the guidance cancels the outreach). Where: `private.sweep_unconfirmed_red_alerts` and the cancel rules in the design note.
- Changed: our escalation target is the on-call clinician, not a friend. The interval is data (`notifications.rules` v4, 30 minutes, CMO answer Q11), not fixed.
- Unsuitable: a friend with an account needs a second app install; many of our patients are email or in-app only.

## 2. Acknowledgement and re-escalation ladders (PagerDuty, Opsgenie, Spok, TigerConnect, Vocera)
- PagerDuty: first target notified at once, a per-rule timeout, acknowledging stops escalation, resolving closes it, an acknowledged incident that re-triggers resumes the policy, empty rota slots are skipped [V]. Spok, TigerConnect and Vocera describe the same acknowledge-or-escalate model for clinical messaging [V, [NV] for exact timings].
- Adopted: only a human acknowledgement stops the ladder (Q13: a patient reply never stops paging), the patient reply is shown to the responder as information, and a deduplicated single open outreach task per red. Where: `record_red_care_response` never touches `pages`, `clinical_tasks` or the sweep; proof sabotage in `s13r4_red_outreach.sql`.
- Unsuitable: PagerDuty repeats to the last responder indefinitely; we keep S19's rule that leadership is alerted and an incident opens instead.

## 3. Critical alerts on iPhone (Apple Medical ID, Health, Life360 SOS)
- Apple has four interruption levels. `time-sensitive` needs only a capability. `critical` needs an entitlement Apple grants manually for health and safety uses, can take weeks, and the user must also allow it; until granted the system ignores the critical level [G for the levels, Apple docs; [V] forum reports for timing and rejections].
- Adopted: ship the code path switched off. Server adds `interruptionLevel: "critical"` only when the secret `IOS_CRITICAL_ALERTS_ENABLED=true`; the app config adds the entitlement only when `IOS_CRITICAL_ALERTS_ENTITLEMENT=1` at build time, so a build never breaks before approval. Until then reds go as `time-sensitive` (no approval needed). Where: `_shared/notifications/push-options.ts`, `apps/mobile/app.config.js`.
- Unsuitable: critical alerts bypass the mute switch; the wording stays generic so a loud alert in a public place still tells nobody anything (Q12).

## 4. Android delivery and channels (Android docs, Expo, dontkillmyapp)
- Expo: `priority: high` for immediate delivery on Android, `channelId` must already exist on the device or the notification is not shown, a very low `ttl` can stop doze delivery, "ok" ticket or receipt means accepted, not delivered, check receipts about 15 minutes later, receipts clear after 24 hours [V, Expo docs].
- dontkillmyapp (Tecno/Transsion): turn off power saving for the app, allow auto-start, lock the app in recents, switch off "screen off push block" and similar [V, community site]. No developer-side fix exists.
- Full-screen intents: from Android 14 Play removes the permission for apps that are not calling or alarm apps [G, Android docs/Play]. Decision: not used (the brief says so too).
- Adopted: an `urgent` Android channel (importance MAX, bypass nothing it should not, vibration) created before the first permission prompt, `priority: high`, `channelId`, a 24 hour `ttl` for reds. Where: `apps/mobile/src/lib/notification-channels.ts`, `push-options.ts`.
- Found a real gap: the app never created any channel, so Android 13+ may never show the permission prompt and remote pushes use Expo's default channel [V, Expo docs on channels].

## 5. Discreet notifications (NHS App, MyChart)
- Could not confirm [NV] what either shows on a lock screen. NHS guidance keeps personal data out of URLs and relies on login for content [G, NHS England messaging guidance].
- Adopted (our own rule INV-07 already stricter): fixed generic words on the lock screen, in email and in-app previews; the guidance appears only after opening. Q12 confirms reds keep this. Test: real clinical values go in, none come out (`red-path-notifications.test.ts`).

## 6. Documents by email (OQ-91)
- Both attachments list test names or plan items, and a forwarded or previewed mailbox can show them. Adopted option (b): the email carries only a signed link that opens a login-protected page. Link carries a random id and a signature, never a name or a test; it grants nothing without sign-in.

## 7. NDPA 2023 and GAID 2025 [NV, not legal advice]
- Notification content is personal data processing; data minimisation and security-by-design point the same way as INV-07. A new append-only response record (what the patient said about seeking care) is health data: stored in-database, no new processor, readable by the patient and the responding clinician only, covered by the DPIA channel entry requested in plan R4 (counsel to confirm).
- Open: whether email to a patient is "reasonably secure" for a red; the link-only email design reduces exposure.

## 8. Write-time vetting of free text (OQ-94)
- Adopted: the INV-07 term list runs when an admin saves a broadcast and when the LLM lifestyle message is produced; a hit refuses with the reason shown to the admin. Where: `packages/notifications` lint exposed through `apps/web/src/lib/notifications/write-time-lint.ts`.

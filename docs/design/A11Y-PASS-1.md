# Accessibility pass 1 (Vitals, Medications, Messages, Home)

Done in the iOS simulator and by reading the kit and screens. A real VoiceOver or TalkBack run on a phone is still to do (script below): the simulator cannot speak, so what was checked is the tree, labels, sizes and text scaling, not the voice.

## Found and fixed
- **Text could not grow past 150 percent.** The kit capped text at 1.5; the accessibility rule is 200 percent, and phones go higher. Cap is now 2.0 and a test fails if it goes below (sabotage checked).
- **At a very large text size (iOS AX2) the app chrome broke.** Tab labels read "Ho...", "Vita...", the TarragonHealth wordmark ran off the screen, the notification badge and the AR avatar were clipped. Tab labels, wordmark, badge and initials now scale less (1.2) because five tabs share one row; the full tab name is still spoken. The old shared text components (`ui/components.tsx`) now share the 2.0 cap, so older screens cannot blow out their layouts either.
- **Chips and the 7 / 30 day control were 40 points tall.** Now 44 (a test checks every kit control).
- **Medications:** at large sizes the Taken badge squeezed the drug name. The badge now sits under the name and time.
- **Messages:** the heading block took half the screen at large sizes. It now scrolls away with the conversation.

## Checked and fine
- Dose rows are checkboxes (role, checked state, label "drug at time", hint). The sync state, toasts and the progress line are announced (iOS announces explicitly because VoiceOver ignores live regions).
- Status never relies on colour alone: icon plus words on every badge.
- The trend chart is one image element with a text summary; the readings are in the list below it.
- Sheet and modals trap focus; the close button is always reachable.
- Headings are marked as headings in the four screens.

## Not fixed (Phase 2, when those screens move)
- Screens not yet on the kit use raw text and can still look rough at the largest sizes. They are capped at 2.0 only where they use the shared components.
- The three cards inside Home (How you're doing, Get started, Payment issue) are old components.
- Reduced motion is honoured by the kit; older screens do not animate much, but have not been checked.

## VoiceOver script for a real phone (about 10 minutes)
iPhone: Settings, Accessibility, Accessibility Shortcut, VoiceOver, then triple-click the side button to switch it on and off. Android: TalkBack the same way.
1. Swipe right through Home. Expect: greeting heading, the score card, the big blood pressure with its unit, "Next best step", then the buttons. Nothing should say "button" twice or read a bare icon name.
2. Meds: swipe to a dose. Expect "Amlodipine at 08:00, checkbox, not checked, double tap to mark as taken". Double tap; expect "Marked as taken".
3. Vitals: the chart should read as one summary sentence. Log a reading and listen to the error and the saved message.
4. Messages: each bubble reads as "sender, time, message". The send button says "Send message" and is dimmed when the box is empty.
5. Turn Settings, Display and Text Size, Larger Text on, drag to the largest, and look at all four tabs.
Write down anything that is read wrongly or in a confusing order, and send it to me.

# Dark mode (opt-in, shipped 2026-10-03)

Decision DG-2, answered by the founder 2026-10-03: **opt-in switch, Light by default**.

## What a patient sees
- Settings, Appearance: **Light** (default) or **Dark**. Nobody changes unless they choose Dark.
- Dark applies to Home, Vitals, Medications, Messages, the top bar, the tab bar, the acting-for banner, the profile and notification dropdowns, and the status bar.
- Everything else stays light on purpose, and Settings says so: the other ~65 screens, the menu drawer, the medicines cabinet sheet (drawn light via `ForceLight`), the emergency guidance, sign-in and app lock.

## How it works, and the rules that keep it safe
- The OS-level appearance stays **pinned to light** even in Dark. Only the in-app palette goes dark. That keeps every native default the old screens rely on (default text colour, switches, pickers) light, so an old screen can never show white text on a white card. Cost: native alerts and the share sheet stay light, and the OS dark setting cannot be read, so there is no "System" option.
- Kit inputs ask for a dark keyboard themselves (`keyboardAppearance`).
- Chrome that is not on the kit uses `useLegacyColors()` (`ui/design/legacy-bridge.ts`): the old colour names mapped to palette roles. Use it when moving a file; do not use it for a file whose children are legacy components.
- **Do not remap the legacy `colors` object or `ui/components.tsx` to dark.** Old screens mix them with their own inline colours; the result is dark text on dark cards. A screen goes dark only when the whole screen is moved onto the kit (Phase 2).
- Legacy screens must draw their own background. Three did not (exercise, timeline, video visit) and now do.
- Clinical status colours (the score dot and meter) keep their fixed colours in both schemes; the word beside them carries the meaning.

## Checked
Simulator, iOS: Light default, switch to Dark and back, Home (with the three cards), Vitals, Medications, the cabinet sheet, Settings, the profile dropdown, the tab bar and status bar. Contrast of both palettes is enforced by `tokens.test.ts`.

## Not checked
Android, Messages in Dark with the keyboard open, VoiceOver in Dark, large text in Dark, the menu drawer (light by design).

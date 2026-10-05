# Mobile design audit (2026-10-02)

Scope: the native patient app (`apps/mobile`, 72 screens, 5-tab bar plus drawer) against `docs/BRAND_GUIDE.md`, the founder's goal of a fully functioning, superior platform, and decision DF-1 (the minimum device is raised above a 2 GB Android phone; exact floor still to confirm, proposed 4 GB Android 10+ and iOS 16+). Web is covered by a short comparison only; a full web audit is a second pass.

Method and limits: code metrics over `src/screens`, `src/ui` and `App.tsx` (counts below are exact greps), contrast computed from the theme tokens, and the simulator screenshots of Home and Vitals taken on 2026-10-02. **Not done:** no screen-reader run, no device lab, no usability test, no review of every screen visually. Findings marked "measured" are counts; "judgement" are mine.

## What is already good
- A real token base (`ui/theme.ts`: brand, status, radius, spacing, a type scale) and 1,499 uses of `colors.*`. Brand colours and the separate clinical-status system follow the guide.
- A small shared kit (buttons, card, grouped list, callout, badge) and a consistent card pattern on Home and Vitals.
- Accessibility props are present (195 across 35 files), the emergency modal and sync banner use live regions, and 20 touch targets set a 44 point minimum.
- Safety surfaces (emergency guidance, urgent banners, offline notice) are distinct and use a reserved red.

## Findings

| # | Finding | Evidence | Impact |
|---|---|---|---|
| F1 | **No dark mode.** `userInterfaceStyle: light`, zero `useColorScheme` references. Web has 3,021 `dark:` classes in 329 files. | measured | High. Evening use, battery on OLED, and "feels modern". |
| F2 | **Typography is off-brand and unmanaged.** Guide says Sora (headlines) and Inter (UI); the app uses the system font (one file mentions a font family). 738 inline `fontSize` values with 22 distinct sizes; the `typeScale` is used 38 times. | measured | High. The app does not look like the brand or the web, and sizes drift. |
| F3 | **No motion and no tactile feedback.** No `Animated`, Reanimated, LayoutAnimation, gesture handler or haptics anywhere. Loading is a bare spinner in 52 files, no skeletons. | measured | High for "superior". Screens appear and change with no transition; saves and errors have no physical feedback. |
| F4 | **The core product has no trend visual.** Vitals shows a list of readings and a 7 day average. There is no chart library (no SVG, Skia or chart package); the only chart is a hand-built bar view in wellbeing. Guide section 9: each card shows status, trend and one next action. | measured | High. BP and glucose trends are the reason patients open the app. |
| F5 | **Accessibility gaps.** `colors.faint` (#A8A29E) is 2.4 to 2.5 to 1 on white and 2.1 to 1 on the grouped-row fill (AA needs 4.5 for text) and is used as text colour 34 times. Only 20 explicit 44 point targets. Accessibility props appear in 35 of 72 screens. Nothing was screen-reader tested. | measured and computed | High. WCAG AA fail on real text; the guide promises large targets and screen-reader support (D.2). |
| F6 | **Styling architecture does not scale.** 1,812 inline style objects, no `StyleSheet`; 92 hex literals outside the theme in 36 files (17 distinct); the guide says the app background is `#FAF7F2`, the theme has `#FAFAFA` and a separate `#F1ECE3` group fill. | measured | Medium. Every redesign touches hundreds of files; colours drift. |
| F7 | **Thin component kit.** 15 components. No shared text field (34 files use `TextInput`, six redefine `inputStyle`), no sheet or modal wrapper (18 files use `Modal`), no toast, empty state, skeleton, tabs, avatar or list item variants. | measured | Medium. Each screen rebuilds the same controls slightly differently. |
| F8 | **Iconography mismatch.** The app uses Ionicons (filled and outline mixed). The guide asks for one rounded 2 px single-colour set. | judgement | Medium. |
| F9 | **Copy and i18n rules not met.** `@tarragon/i18n` is used in 5 of 72 screens; the rest are hard-coded English. 30 user-visible strings contain an em dash (house rule: none). | measured | Medium. Blocks Pidgin and the copy rule. |
| F10 | **Information density.** 57 section screens behind five tabs and a drawer; the largest screens are 1,181 (care support), 1,146 (women's health), 998 (profile) and 840 lines (medicine cabinet). 50 screens use `ScrollView`, 4 use `FlatList`. Three files still reference a WebView screen. | measured and judgement | Medium. Hard to scan and to maintain; long lists are not virtualised. |
| F11 | **Platform behaviour issues seen in the simulator.** The Health permission sheet appeared at every launch (fixed in PR #858). The first-run flow stacks the notification prompt, the Health sheet, the dev menu intro and the fingerprint offer. | observed | Medium. First-run order needs designing. |

## What the raised floor unlocks
- Reanimated 3 and gesture handler: shared transitions, pull to refresh, swipe on a dose to take or skip, animated charts.
- Skia or SVG charting: BP and glucose trend with target bands, 7 and 30 day views, tap to inspect a reading.
- Haptics, blur and gradients used sparingly; Lottie for one or two reassurance moments (reading saved, all doses done).
- FlashList for timeline, messages and lab lists; expo-image for photos and avatars; a bigger on-device cache.
- Dark mode and dynamic type from day one of the new kit.
- Costs and risks: every new native module needs a new EAS build and a runtime version bump (currently `0.1.0-native3`); OTA cannot deliver them. Android `minSdkVersion` is 26 today and should follow the confirmed floor.

## Proposed plan
Phase 0, foundations (about one session): fonts (Sora, Inter), a single token file with light and dark themes, `StyleSheet`-based primitives (Text with the type scale, Field, Sheet, Toast, EmptyState, Skeleton, ListItem), an icon decision, lint rules for hex and raw `fontSize` outside the theme, contrast fixes (`faint` replaced for text). One native build.
Phase 1, flagship screens (two to three sessions): Home, Vitals (with the trend chart and swipeable readings), Medications (dose swipe, haptics), Messages. Each gets motion, skeletons, dark mode, i18n and an accessibility pass with a screen reader.
Phase 2, rollout (several sessions): the other 50 screens move onto the kit in groups, starting with the largest. Split the 1,000 line screens as they move.
Phase 3, web parity: Sora/Inter and tokens are already on web; align components, charts (recharts is present) and the Warm Ivory decision.

Acceptance for each phase: light and dark pass visual review; WCAG AA contrast on all text; every touch target 44 points or more; screen reader walkthrough of the flagship flows; no hard-coded strings in moved screens; Jest and CI green; device lab numbers recorded once the floor device exists.

## Decisions needed from the founder
1. Confirm the device floor (proposed 4 GB Android 10+, iOS 16+; sets `minSdkVersion` 29).
2. Dark mode in Phase 0 (recommended) or later.
3. Adopt Sora and Inter in the app as the guide says (recommended; bundles about 1 MB of fonts).
4. Icon set: keep Ionicons, or move to one rounded 2 px set as the guide says.
5. Charting stack: Skia (most capable, larger) or SVG (lighter, enough for trends).
6. Approve a new native build and runtime version bump for Phase 0.

## Reference platforms to study (behaviour only, nothing copied)
Oura and WHOOP for trend and score presentation; Apple Health for chart interaction; Strava for the activity-feed rhythm and upload states; MyTherapy for dose checking; Noom for tone (not its pressure copy); Headspace for motion restraint.

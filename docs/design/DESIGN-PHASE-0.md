# Design Phase 0: tokens, kit and foundations (2026-10-02)

Implements decisions DG-1 to DG-6 (`docs/DECISIONS.md`) from `docs/design/MOBILE-DESIGN-AUDIT.md`. **No screen was redesigned in this phase**: nothing a patient sees changes except text that was too faint to read. Screens move onto the kit in Phase 1 (Home, Vitals, Medications, Messages) and Phase 2 (the rest).

## What was built
- **Tokens** (`apps/mobile/src/ui/design/`): light and dark palettes by role (canvas, surface, text, textMuted, textSubtle, brand, brandText, warn, danger, emergency, scrim, focus), a 4 point spacing scale, radii, elevation (shadow in light, border in dark), a typography scale (Sora for headlines, Inter for the interface; hero, stat, headline, title, bodyLarge, body, bodyStrong, label, caption), motion tokens (durations, springs). Contrast is enforced by test: every text role is at least 4.5:1 on canvas, surface and the muted fill in both palettes.
- **Theme provider**: scheme from preference and system, reduced-motion flag, preference saved on the device. `DARK_MODE_ENABLED` is **false** (`design/config.ts`): the app forces the light scheme at OS level too, because the roughly 65 screens that have not moved still use the static light colours and would render half dark. Flipping it on is a one-line change after Phase 1.
- **Kit** (`apps/mobile/src/ui/kit/`): AppText, Button, Card, Field, ListItem, EmptyState, Skeleton, Sheet, Toast, Screen, PressableScale (spring press plus haptic), Icon (Lucide, one rounded 2 px set), haptics. Every control is at least 44 points, labelled for screen readers, and skips animation under reduced motion.
- **Fonts**: Sora and Inter bundled via `@expo-google-fonts` (SIL OFL). The splash waits for them but races a timeout and falls back to the system font, the same rule as the icon font, because this app's loading gate has hung before on native init.
- **Legacy contrast fix**: new `colors.subtle` (AA) replaces `colors.faint` in 34 text colours and 63 placeholders. `faint` stays for icons and dividers. A source-guard test fails if `faint` returns as text.
- **Lint ratchet**: raw hex or literal `fontSize` is an error inside the kit and design layer, a warning in screens (baseline 830, counted down as screens move).
- **Platform floor** (DG-1): Android `minSdkVersion` 29 (was 26), iOS deployment target 16.0 (was 15.1), including the committed iOS project files; `userInterfaceStyle` automatic (iOS `Info.plist` too).
- **Native packages added** (all Expo SDK 54 compatible): `react-native-reanimated` 4.1, `react-native-worklets`, `react-native-gesture-handler`, `react-native-svg`, `@shopify/react-native-skia`, `expo-haptics`, `expo-font`, `lucide-react-native` (ISC), `@expo-google-fonts/sora` and `inter`. Gesture handler is imported first in `index.js` and wraps the app root.
- **Runtime version** bumped `0.1.0-native3` to `0.1.0-native4`: every phone needs the one new build (DG-6) and OTA cannot reach old binaries.

## A build break the review found, and its fix
`react-native-worklets` (the Reanimated 4 Babel plugin) requires `@babel/types` and `@babel/traverse` from inside its own folder but declares neither, which only works under npm's flat layout. Under pnpm, Babel failed with "Cannot find module '@babel/types'" for any file it compiled fresh. Jest's transform cache hid it (most suites kept passing) while the same Babel config feeds Metro, so the real app bundle would have failed. Found when two suites failed to start after a new test file was added. Fixed at the source with a `packageExtensions` entry in `pnpm-workspace.yaml` (giving the plugin those two dependencies on the 7.x line). Verified with `jest --no-cache` (45 of 45 suites, 455 tests) and a real `expo export --platform ios` (the app bundles to 8.4 MB of Hermes bytecode). CI starts cold, so it catches a regression of this.

## Not done, on purpose
- **The native build was not started** (DG-6 says not without a further go-ahead). Until that build exists, this code cannot run on a phone: the simulator and any old dev build lack the new native modules. The Mobile OTA Publish workflow skips native-affecting pushes, so nothing reaches current phones.
- **Skia charts** are installed but unused; the BP and glucose trend chart is a Phase 1 deliverable.
- **No screen uses the kit yet**, so there is nothing to see until Phase 1.
- Not measured: the kit on a device, the real size of the six font files, contrast of the legacy hard-coded colours outside `subtle`.

## Consequences to carry out
- Run the build (iOS and Android) and a device lab on the 4 GB floor phone; record cold start, memory and install size (the 2 GB budget notes in `offline-budget.ts` are superseded by DG-1).
- `Podfile.lock` regenerates at build; review the diff then.
- Phase 1 enables dark mode for the flagship screens and flips `DARK_MODE_ENABLED`.

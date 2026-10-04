import { readFileSync } from "fs";
import { join } from "path";

/**
 * Screens that have been made scheme-aware by swapping to the legacy-kit primitives and
 * the useLegacyColors bridge (instead of rewriting on the full kit). Each must stay fully
 * switched: one stray import of the static light `colors` or of the light-only components
 * puts dark text on a dark card in Dark mode. Add a screen here when it moves.
 */
const FILES = [
  "screens/sections/profile-screen.tsx",
  "screens/sections/prevention-screen.tsx",
  "screens/sections/lab-orders-screen.tsx",
  "screens/sections/symptom-screen.tsx",
  "screens/sections/medicine-cabinet-screen.tsx",
  "screens/sections/actions-screen.tsx",
  "screens/sections/health-summary-screen.tsx",
  "screens/sections/timeline-screen.tsx",
  "screens/sections/receipts-screen.tsx",
  "screens/sections/notification-settings-screen.tsx",
  "screens/sections/health-passport-screen.tsx",
  "screens/sections/financial-profile-screen.tsx",
  "screens/sections/supporting-screen.tsx",
  "screens/sections/supporting-manage-screen.tsx",
  "screens/sections/technical-support-screen.tsx",
  "screens/sections/find-a-specialist-screen.tsx",
  "screens/sections/lifestyle-screen.tsx",
  "screens/sections/lifestyle-tracker-screen.tsx",
  "screens/sections/lifestyle-shared.tsx",
  "screens/sections/screening-days-screen.tsx",
  "screens/sections/family-screen.tsx",
  "screens/sections/learn-screen.tsx",
  "screens/sections/wellbeing-screen.tsx",
  "screens/sections/wellbeing-trend-chart.tsx",
  "screens/sections/cycle-screen.tsx",
  "screens/sections/weight-management-screen.tsx",
  "screens/sections/wellness-screen.tsx",
  "screens/sections/healthy-ageing-screen.tsx",
  "screens/sections/privacy-screen.tsx",
  "screens/sections/health-check-screen.tsx",
  "screens/sections/ai-coach-screen.tsx",
  "screens/sections/exercise-screen.tsx",
  "screens/sections/tracker-screens.tsx",
  "screens/sections/care-support-screen.tsx",
  "screens/sections/womens-health-screen.tsx",
  "screens/sections/sexual-health-screen.tsx",
  "screens/sections/sexual-health-testing-tab.tsx",
  "screens/sections/video-visit-screen.tsx",
  "screens/sections/video-visit-booking-section.tsx",
  "screens/sections/lab-order-test-checklist.tsx",
  "screens/sections/second-opinion-section.tsx",
  "screens/sections/senior-case-review-section.tsx",
  "screens/sections/verified-documents-section.tsx",
  "screens/sections/sponsor-sharing-control.tsx",
  "screens/sections/pharmacy-orders-section.tsx",
  "screens/sections/therapy-network-screen.tsx",
  "screens/sections/monitoring-cover-card.tsx",
  "screens/devices-screen.tsx",
  "screens/sync-screen.tsx",
  "screens/sections/emergency-card-screen.tsx",
  "screens/sections/settings-screen.tsx",
  "screens/sections/appearance-setting.tsx",
  "screens/apple-health-card.tsx",
  "screens/android-health-connect-card.tsx",
  "screens/health-connect-rationale-modal.tsx",
];

describe("scheme-aware legacy screens stay fully switched", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*"@\/ui\/theme"/);
    expect(source).not.toMatch(/from\s*"@\/ui\/components"/);
    expect(source).toMatch(/useLegacyColors/);
  });
});

/**
 * Two things the visual pass found in Dark: a field with no placeholder colour shows an
 * invisible placeholder, and the brand fill green used as TEXT is too dim on a dark card.
 */
describe("scheme-aware legacy screens keep text readable in Dark", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    for (const match of source.matchAll(/<TextInput\b[\s\S]*?(?=\/>|>\s*\n)/g)) {
      if (match[0].includes("keyboardAppearance")) expect(match[0]).toMatch(/placeholderTextColor/);
    }
    for (const line of source.split("\n")) {
      if (/backgroundColor|borderColor/.test(line)) continue;
      expect(line).not.toMatch(/\bcolor: [^,}]*colors\.brand\b(?!Pressed|Tint)/);
    }
  });
});

/**
 * Deliberately light in every scheme: the emergency guidance mirrors the web EmergencyAlert
 * and must look identical whatever the patient chose, and the sign-in screens come before a
 * preference exists. They must keep drawing themselves from the static light theme.
 */
const LIGHT_ON_PURPOSE = [
  "screens/emergency-guidance-modal.tsx",
  "screens/login-screen.tsx",
  "screens/signup-screen.tsx",
  "screens/forgot-password-screen.tsx",
];

describe("light-on-purpose screens stay light", () => {
  it.each(LIGHT_ON_PURPOSE)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(source).not.toMatch(/useLegacyColors|useTheme/);
    expect(source).not.toMatch(/from\s*"@\/ui\/legacy-kit"/);
  });
});

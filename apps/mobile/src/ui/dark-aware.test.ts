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
];

describe("scheme-aware legacy screens stay fully switched", () => {
  it.each(FILES)("%s", (file) => {
    const source = readFileSync(join(__dirname, "..", file), "utf8");
    expect(source).not.toMatch(/import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*"@\/ui\/theme"/);
    expect(source).not.toMatch(/from\s*"@\/ui\/components"/);
    expect(source).toMatch(/useLegacyColors/);
  });
});

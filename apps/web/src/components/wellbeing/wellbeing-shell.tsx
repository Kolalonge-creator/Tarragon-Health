import type { ReactNode } from "react";
import { t } from "@tarragon/i18n";
import { CrisisCard } from "@/components/mental-health/crisis-card";
import { SharedPhoneGate } from "@/components/mental-health/shared-phone-gate";

/**
 * Every wellbeing sub-screen (library, breathing, journal) renders inside this: the crisis card is always reachable and sits OUTSIDE the
 * shared-phone gate (help is never hidden), and the content sits inside the gate (S56). No analytics or ad SDK may be reachable from here.
 */
export function WellbeingShell({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-4">
      <details className="rounded-lg border border-red-200 dark:border-red-500/30 p-3">
        <summary className="cursor-pointer text-sm font-medium">{t("crisis.open_card")}</summary>
        <div className="mt-3">
          <CrisisCard />
        </div>
      </details>
      <SharedPhoneGate>{children}</SharedPhoneGate>
    </div>
  );
}

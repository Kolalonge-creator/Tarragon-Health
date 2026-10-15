import type { ReactNode } from "react";

/**
 * SEAM (S67 to S66). Every pregnancy screen (week by week, antenatal schedule, baby movement counter, contraction timer, birth plan)
 * is rendered inside this wrapper. S66 is building the reusable `PrivateSection` PIN lock in parallel; when it lands, replace the body
 * of this component with `<PrivateSection section="pregnancy">{children}</PrivateSection>` and nothing else changes.
 *
 * Until then it renders its children unchanged and locks nothing, so there is no PIN lock here by design. Two things stay OUTSIDE any
 * lock, by decision (docs/design/S66-S70-build-plan.md section 9): the danger-sign guide and the emergency cards, which must open
 * with no PIN and no signal (INV-06). Do not wrap `PregnancyDangerGuide` or the "contact your care team" / "go now" cards in the lock.
 */
export function PregnancyPrivateSection({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

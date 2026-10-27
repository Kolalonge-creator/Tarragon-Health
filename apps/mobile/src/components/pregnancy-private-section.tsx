import type { ReactNode } from "react";

/**
 * Marks the pregnancy tools (week by week, antenatal schedule, baby movement counter, contraction timer, birth plan) as private content.
 *
 * SEAM CLOSED (S67 follow-up, OQ-346). S66's `PrivateSection` PIN lock now wraps the whole Women's Health screen
 * (`screens/sections/womens-health-screen.tsx`), and `PregnancyTools` renders inside it, so these tools are already behind the lock. This
 * wrapper therefore does NOT add a second PIN prompt (two nested locks would ask twice for the same section); it stays as a pass-through
 * marker so a future standalone pregnancy screen has one obvious place to wrap with `<PrivateSection section="pregnancy">`.
 *
 * Two things stay OUTSIDE any lock, by decision (docs/design/S66-S70-build-plan.md section 9): the danger-sign guide and the emergency
 * cards, which must open with no PIN and no signal (INV-06). `PregnancyDangerGuideCard` is passed in the lock's `outside` slot. Do not
 * wrap it or the "contact your care team" / "go now" cards in the lock.
 */
export function PregnancyPrivateSection({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

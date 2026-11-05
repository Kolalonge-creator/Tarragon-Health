/**
 * Old marketing URL -> its new home (website upgrade, plan section 3.3).
 * next.config.ts serves each as a permanent redirect, so search engines move
 * the old page's standing to the new one. Every destination must be a live
 * marketing page; redirects.test.ts checks that.
 *
 * Phase 3 (2026-11-05): /hmo folds into Employers & Organisations (W-05).
 * The rest of the map (parentcare, annual-health-check, ...) lands in Phase 5.
 */
export const MARKETING_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [
  { source: "/hmo", destination: "/corporate#insurers" },
];

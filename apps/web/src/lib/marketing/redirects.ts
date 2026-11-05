/**
 * Old marketing URL -> its new home (website upgrade, plan section 3.3).
 * next.config.ts serves each as a permanent redirect, so search engines move
 * the old page's standing to the new one. Every destination must be a live
 * marketing page; redirects.test.ts checks that.
 *
 * Phase 3 (2026-11-05): /hmo folds into Employers & Organisations (W-05).
 * Phase 5 (2026-11-05): the seven retired pages (founder decision W-04),
 * each to the page that now covers it.
 */
export const MARKETING_REDIRECTS: ReadonlyArray<{ source: string; destination: string }> = [
  { source: "/hmo", destination: "/corporate#insurers" },
  { source: "/parentcare", destination: "/families" },
  { source: "/annual-health-check", destination: "/membership" },
  { source: "/advanced-diagnostics", destination: "/labs" },
  { source: "/who-its-for", destination: "/for-you" },
  { source: "/screening-journey", destination: "/how-it-works" },
  { source: "/health-education", destination: "/resources" },
  { source: "/care-coordination", destination: "/how-it-works" },
];

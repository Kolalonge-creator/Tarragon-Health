/**
 * Where the outcomes dashboard lives. The Chief Medical Officer's account role (`clinician`) can never open /admin, so the same page is
 * mounted under /clinician (the same arrangement as the symptom checker safety page).
 */
export const DASHBOARD_PATHS = { admin: "/admin/outcomes/engagement", cmo: "/clinician/engagement-outcomes" } as const;
export type DashboardViewer = keyof typeof DASHBOARD_PATHS;

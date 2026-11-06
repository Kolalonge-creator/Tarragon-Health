/**
 * "My health record" is the record's one door in the menu and the "My Health" phone tab (PD-01). The record pages that left the menu
 * (Health summary, every report and document) and the everyday record pages (readings, medicines, results) are one tap from it.
 * The passport, timeline and outside documents are already cards on the same page.
 */
export const MY_HEALTH_RELATED_LINKS = [
  { href: "/patient/health-summary", label: "Health summary" },
  { href: "/patient/health-records", label: "All reports and documents" },
  { href: "/patient/vitals", label: "Vitals & symptoms" },
  { href: "/patient/medications", label: "Medications" },
  { href: "/patient/labs", label: "Labs & results" },
  { href: "/patient/health-score", label: "Health by area" },
] as const;

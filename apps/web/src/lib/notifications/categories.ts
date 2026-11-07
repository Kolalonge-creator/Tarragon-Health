/**
 * P19: the filter groups on the patient notification centre. A notification is grouped by where it sends the reader (the href from
 * describe-in-app.ts, the one mapping every in-app template already has), with a few templates about money picked out by name. Grouping
 * by destination means a new template lands in the right group the day it gets its describe() case, and anything that fits nowhere
 * falls into "care", so nothing ever drops out of the list.
 */
export const NOTIFICATION_CATEGORIES = [
  { id: "care", label: "Care" },
  { id: "results", label: "Results" },
  { id: "medicines", label: "Medicines" },
  { id: "appointments", label: "Appointments" },
  { id: "payments", label: "Payments" },
  { id: "account", label: "Account" },
] as const;

export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]["id"];

const PAYMENT_TEMPLATE = /(payment|voucher|purchase|receipt|refund|price|invoice|membership|renewal|subscription)/;

const BY_PATH: { prefix: string; category: NotificationCategory }[] = [
  { prefix: "/patient/appointments", category: "appointments" },
  { prefix: "/patient/video-visit", category: "appointments" },
  { prefix: "/patient/consultation", category: "appointments" },
  { prefix: "/patient/calendar", category: "appointments" },
  { prefix: "/patient/testing-days", category: "appointments" },
  { prefix: "/patient/screening-days", category: "appointments" },
  { prefix: "/patient/directory/bookings", category: "appointments" },
  { prefix: "/patient/labs", category: "results" },
  { prefix: "/patient/biomarkers", category: "results" },
  { prefix: "/patient/medications", category: "medicines" },
  { prefix: "/patient/membership", category: "payments" },
  { prefix: "/patient/subscription", category: "payments" },
  { prefix: "/patient/finances", category: "payments" },
  { prefix: "/patient/settings", category: "account" },
  { prefix: "/patient/notification-settings", category: "account" },
  { prefix: "/patient/privacy", category: "account" },
  { prefix: "/patient/family", category: "account" },
  { prefix: "/patient/care-circle", category: "account" },
];

export function categoryFor(template: string | null, href: string): NotificationCategory {
  const path = href.split("#")[0].split("?")[0];
  for (const { prefix, category } of BY_PATH) {
    if (path === prefix || path.startsWith(`${prefix}/`)) return category;
  }
  if (template && PAYMENT_TEMPLATE.test(template)) return "payments";
  return "care";
}

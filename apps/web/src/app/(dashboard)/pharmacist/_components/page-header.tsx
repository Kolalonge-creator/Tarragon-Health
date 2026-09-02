"use client";

import { usePathname } from "next/navigation";

const SECTIONS: Record<string, { label: string; subtitle: string }> = {
  "/pharmacist": { label: "Overview", subtitle: "Today's dispensing snapshot" },
  "/pharmacist/orders": { label: "Orders", subtitle: "Orders routed to your pharmacy" },
  "/pharmacist/verify": {
    label: "Verify a prescription",
    subtitle: "Check authenticity, medication detail, and validity for any patient's prescription",
  },
  "/pharmacist/history": { label: "Dispensing history", subtitle: "Everything dispensed against orders" },
  "/pharmacist/profile": { label: "Pharmacy profile", subtitle: "Regions, contact & license details" },
};

/** Per-route title + subtitle, matching the "Tarragon Health Pharmacist
 * Portal" design's dynamic header (the mock's `{{ pageTitle }}` /
 * `{{ pageSubtitle }}`). Falls back to Overview's copy for any unmatched
 * path so a stale link never renders blank. */
export function PharmacistPageHeader() {
  const pathname = usePathname();
  const section = SECTIONS[pathname] ?? SECTIONS["/pharmacist"];

  return (
    <div>
      <h1 className="font-heading text-2xl font-semibold text-clinical-navy">{section.label}</h1>
      <p className="text-sm text-charcoal-ink/60">{section.subtitle}</p>
    </div>
  );
}

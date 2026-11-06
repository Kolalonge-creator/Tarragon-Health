import type { ReactNode } from "react";

import { ActingForBanner } from "@/app/(dashboard)/patient/acting-for-banner";
import { getActingFor } from "@/lib/acting/acting-for";

/**
 * Every /patient page, not only the section pages, says whose account is open
 * while someone is acting for another person. Before this layout the banner was
 * rendered only by `(sections)/layout.tsx`, so Messages, Appointments, Family
 * and the other top-level patient routes showed no sign that the record open
 * was somebody else's.
 */
export default async function PatientLayout({ children }: { children: ReactNode }) {
  const acting = await getActingFor();
  return (
    <>
      <ActingForBanner acting={acting} />
      {children}
    </>
  );
}

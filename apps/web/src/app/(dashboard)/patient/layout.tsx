import type { ReactNode } from "react";

import { ActingForBanner } from "@/app/(dashboard)/patient/acting-for-banner";
import { ActingForProvider } from "@/components/acting-for-context";
// The request-cached copy, shared with getPatientDashboardContext, so "whose account is this" is resolved once per request.
import { getActingFor } from "@/app/(dashboard)/patient/dashboard-context";

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
      {/* Lets the browser stop offering things that would act on the signed-in person's own record (uploads). */}
      <ActingForProvider value={acting ? { fullName: acting.fullName } : null}>{children}</ActingForProvider>
    </>
  );
}

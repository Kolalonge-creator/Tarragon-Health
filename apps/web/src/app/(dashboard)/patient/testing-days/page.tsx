import { testingDaysOffer, type TestingDaysOffer } from "@tarragon/shared";
import { parseCatalogue } from "@/lib/commerce/model";
import { panelIncluded, UPGRADE_CODE } from "@/lib/commerce/tiers";
import { FreeTestingDaysOffer } from "./free-offer";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { SEMANTIC_ICON } from "@/lib/icons";
import {
  myBookingListSchema,
  myPocResultsSchema,
  testingDayListSchema,
  type MyBooking,
  type MyPocResults,
  type TestingDay,
} from "@/lib/testing-days/model";
import { TestingDaysPanel } from "./testing-days-panel";
import { PocResultsList } from "./poc-results-list";

export const metadata = { title: "Testing days" };

/**
 * Members book a place at a testing day (annual check: blood test, urine test, ECG, the basics). Free accounts see what
 * Membership includes instead. Results appear here only after a doctor has released them (INV-03).
 */
export default async function TestingDaysPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  const supabase = await createClient();
  const { data: listRaw, error: listError } = await supabase.rpc("list_testing_days", {});
  const notMember = listError?.message === "membership_required";
  // A Free account is shown what Membership includes and costs, read from the shop's own catalogue. A failed read shows only the prompt.
  let offer: TestingDaysOffer = { options: [], showPanelTests: false };
  if (notMember) {
    const { data: catalogueRaw, error: catalogueError } = await supabase.rpc("catalogue");
    if (!catalogueError) offer = testingDaysOffer(parseCatalogue(catalogueRaw), panelIncluded, (code) => code === UPGRADE_CODE);
  }
  const days: TestingDay[] = listError ? [] : testingDayListSchema.catch([]).parse(listRaw ?? []);

  const { data: bookingsRaw } = await supabase.rpc("my_testing_bookings");
  const bookings: MyBooking[] = myBookingListSchema.catch([]).parse(bookingsRaw ?? []);
  const { data: pocRaw } = await supabase.rpc("my_poc_results");
  const poc: MyPocResults = myPocResultsSchema.catch({ results: [], ecgs: [] }).parse(pocRaw ?? { results: [], ecgs: [] });

  return (
    <div className="space-y-6">
      <PageHeader
        backTo={{ href: "/patient", label: "Dashboard" }}
        title="Testing days"
        icon={SEMANTIC_ICON.preventive}
        description="Your yearly health check happens at a testing day near you. Choose a day to reserve your place, and we will remind you."
      />
      {notMember ? (
        <FreeTestingDaysOffer offer={offer} />
      ) : (
        <TestingDaysPanel days={days} bookings={bookings} />
      )}
      <PocResultsList results={poc} />
    </div>
  );
}

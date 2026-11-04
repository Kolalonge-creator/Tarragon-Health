import { TestingDaysClosedNote } from "./closed-note";
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
 * Tarragon-run public testing days are closed to new bookings (T2-02, 2026-11-04). This page now only honours what already exists: a
 * place someone already holds (they can keep it, move it to another day already scheduled, or cancel it) and results a doctor has
 * released (INV-03). Nobody is offered a new booking here; the yearly tests are done at any laboratory the person chooses.
 */
export default async function TestingDaysPage({ searchParams }: { searchParams: Promise<{ state?: string; city?: string }> }) {
  const { state: stateParam, city: cityParam } = await searchParams;
  const place = { state: typeof stateParam === "string" ? stateParam.slice(0, 80) : "", city: typeof cityParam === "string" ? cityParam.slice(0, 80) : "" };
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  const supabase = await createClient();
  const { data: listRaw, error: listError } = await supabase.rpc("list_testing_days", {});
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
        description="Places you already hold at a Tarragon testing day, and the results from them."
      />
      <TestingDaysPanel days={days} bookings={bookings} place={place} />
      <TestingDaysClosedNote />
      <PocResultsList results={poc} />
    </div>
  );
}

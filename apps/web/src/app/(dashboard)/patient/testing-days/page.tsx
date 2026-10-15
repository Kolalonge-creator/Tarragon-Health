import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
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
        description="Your yearly health check happens at a testing day near you. Pick a day, hold your place, and we will remind you."
      />
      {notMember ? (
        <Card>
          <CardContent className="space-y-2 pt-6">
            <p className="text-sm text-charcoal-ink">Testing days are part of Membership.</p>
            <Link href="/patient/membership" className="text-sm font-medium text-brand-green underline">
              See what Membership includes
            </Link>
          </CardContent>
        </Card>
      ) : (
        <TestingDaysPanel days={days} bookings={bookings} />
      )}
      <PocResultsList results={poc} />
    </div>
  );
}

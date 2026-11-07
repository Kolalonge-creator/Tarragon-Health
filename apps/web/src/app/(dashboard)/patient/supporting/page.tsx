import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { getPatientDashboardContext } from "@/app/(dashboard)/patient/dashboard-context";
import { SupportingPeopleList } from "./supporting-people-list";
import { CareModeSwitch } from "@/components/care-circle/care-mode-switch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NudgesCard } from "@/components/care-circle/nudges-card";
import { CaregiverCallInvites } from "./caregiver-call-invites";
import { ShareOffers } from "./share-offers";
import { GiftsPaid } from "./gifts-paid";
import { ReservationsSent } from "./reservations-sent";
import { SponsorSharingControl } from "@/components/sponsor-care-report";
import { joinAsPatientToo } from "./actions";
import { RecoveryDutiesCard } from "@/components/account/recovery-duties-card";

/**
 * The sponsor's home screen.
 *
 * /patient/family answers "who is around my care": next of kin, children,
 * requests waiting on someone. This answers the opposite question, which had no
 * screen at all: whose care am I paying for, and did the money do anything?
 *
 * That question is not diaspora-specific, and this page is not gated to anyone
 * abroad. A daughter in Lagos funding her mother in Enugu lands here in exactly
 * the same place, in the same currency, as named checks you buy for them. It is simply
 * felt hardest at distance, because distance is what removes every other way of
 * checking.
 */
export default async function SupportingPage({
  searchParams,
}: {
  searchParams: Promise<{ join?: string }>;
}) {
  const { join } = await searchParams;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");
  const { uiLanguage } = await getPatientDashboardContext({ area: "supporter" });

  return (
    <div className="space-y-6">
      {/* Someone who is also a patient switches between their own health and the people they support here. A supporter-only account
          has nowhere else to go, so it gets neither the switch nor a back link that would only bounce it back to this page. */}
      {profile.receives_care !== false ? <CareModeSwitch active="supporting" locale={uiLanguage} /> : null}

      <PageHeader
        title="People who share their care with you"
        icon={NAV_ICON.healthyAgeing}
        description="Each person here chose to let you follow or help with their care, and keeps their own account. Open someone to see what they share."
      />

      {/* First, because Paystack returns the payer here: a paid reservation's claim link is the next thing they need (no SMS goes to the person). Renders nothing when there is none. */}
      <ReservationsSent />

      <RecoveryDutiesCard />

      <ShareOffers locale={uiLanguage} />
      <GiftsPaid locale={uiLanguage} />
      <CaregiverCallInvites locale={uiLanguage} />

      <NudgesCard locale={uiLanguage} />
      <SupportingPeopleList locale={uiLanguage} />

      {/* Paying is one thing a supporter can do, not what the page is about, so it sits below the people. */}
      <Card>
        <CardHeader>
          <CardTitle>Buy care for someone</CardTitle>
          <CardDescription>
            Pay for care for a relative or friend, even if they are not on Tarragon yet. They keep their own account and their own records.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild className="min-h-11">
            <Link href="/patient/supporting/new">Buy care for someone</Link>
          </Button>
        </CardContent>
      </Card>

      {/* The other half of the same relationship, on the same page on purpose.
          Someone who both supports a person and is supported BY one should be
          able to see and change what they share without hunting through
          settings. Renders nothing when nobody is paying for their care. */}
      {profile.organisation_id ? (
        <SponsorSharingControl organisationId={profile.organisation_id} />
      ) : null}

      {profile.receives_care === false ? (
        // A supporter account has no care of its own, deliberately: we never
        // asked them for a date of birth or a telehealth consent, because
        // neither was true of them. This is the door if that changes, and it
        // is an ADDITION — they keep supporting whoever they support.
        <form
          action={joinAsPatientToo}
          className="space-y-2 rounded-xl border border-brand-green/20 bg-brand-green/[0.04] dark:bg-brand-green/10 p-5"
        >
          <p className="font-heading text-base font-semibold text-charcoal-ink dark:text-night-ink">
            Want care here yourself as well?
          </p>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            You can join as a patient too (the app itself is free to join) and carry on
            supporting {profile.full_name ? "them" : "the people you support"} exactly as you do
            now.
          </p>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            It does mean answering the health questions we have not asked you: your date of birth,
            the care consents and a short intake. Those answers are what build your screening
            calendar and your risk scoring, so there is no useful shortcut past them.
          </p>
          {join === "failed" ? (
            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
              We could not switch your account just now. Nothing has changed. Please try again,
              and if it keeps happening, message us in the app.
            </p>
          ) : null}
          <button
            type="submit"
            className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white"
          >
            Join as a patient too
          </button>
        </form>
      ) : (
        <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
          Looking for who can follow <em>your</em> care, or the children whose records you keep?
          That is on{" "}
          <Link href="/patient/family" className="text-brand-green dark:text-brand-green-bright underline">
            your people
          </Link>
          .
        </p>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { NAV_ICON } from "@/lib/icons";
import { SupportedPeople } from "./supported-people";
import { joinAsPatientToo } from "./actions";

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
export default async function SupportingPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  if (profile.role !== "patient") redirect("/");

  return (
    <div className="space-y-6">
      <PageHeader
        title="People you support"
        icon={NAV_ICON.healthyAgeing}
        description="Money you put toward someone else's care, and what it actually paid for. Every person here keeps their own account and their own plan; you are funding their care, not holding it."
      />

      <SupportedPeople />

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
            You can join as a patient too, starting on the free plan if you like, and carry on
            supporting {profile.full_name ? "them" : "the people you support"} exactly as you do
            now.
          </p>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            It does mean answering the health questions we have not asked you: your date of birth,
            the care consents and a short intake. Those answers are what build your screening
            calendar and your risk scoring, so there is no useful shortcut past them.
          </p>
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

import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCurrentUser } from "@/lib/supabase/server";
import { SupportedPeople } from "./supported-people";
import { setUpMyOwnCare } from "./actions";

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

  const user = await getCurrentUser();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          People you support
        </h1>
        <p className="max-w-2xl text-charcoal-ink/60">
          Money you put toward someone else&apos;s care, and what it actually paid for. Every
          person here keeps their own account and their own plan; you are funding their care, not
          holding it.
        </p>
      </div>

      <SupportedPeople payerEmailKnown={Boolean(user?.email)} />

      {profile.account_purpose === "support" ? (
        // A supporter account has no care of its own, deliberately: we never
        // asked them for a date of birth or a telehealth consent, because
        // neither was true of them. This is the door if that ever changes,
        // rather than leaving them permanently unable to become a patient.
        <form action={setUpMyOwnCare}>
          <p className="text-sm text-charcoal-ink/60">
            This account is set up for supporting someone else, so we have not asked you anything
            about your own health. If you want care here too,{" "}
            <button type="submit" className="text-brand-green underline">
              set that up
            </button>{" "}
            — it takes a couple of minutes.
          </p>
        </form>
      ) : (
        <p className="text-sm text-charcoal-ink/60">
          Looking for who can follow <em>your</em> care, or the children whose records you keep?
          That is on{" "}
          <Link href="/patient/family" className="text-brand-green underline">
            your people
          </Link>
          .
        </p>
      )}
    </div>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { submitTest } from "@/lib/credentialing/applicant-actions";
import { getMyApplication, getOpenTest } from "@/lib/credentialing/queries";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";
import { CredentialingError } from "@/lib/credentialing/rpc";

export const metadata = { title: "Clinician test" };
export const dynamic = "force-dynamic";

/** Shows the scenarios of the open attempt. It only resumes an attempt that was started on the previous page; it never starts one. */
export default async function ClinicianTestPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  const sp = await searchParams;

  const app = await getMyApplication();
  if (!app || app.state !== "training" || !app.test.open_attempt_id) redirect("/account/clinician");

  let test: Awaited<ReturnType<typeof getOpenTest>> | null = null;
  let failure: string | null = null;
  try {
    test = await getOpenTest(app.id);
  } catch (e) {
    failure = e instanceof CredentialingError ? e.message : "We could not open the test. Please try again.";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Clinician test" description="Choose one answer for every scenario, then submit. You can take your time. Do not refresh until you have submitted." />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error) ?? failure ?? undefined} />
      {test ? (
        <form action={submitTest} className="space-y-4">
          <Hidden name="attemptId" value={test.attempt_id} />
          {test.cases.map((c, i) => (
            <Section key={c.id} title={`Scenario ${i + 1} of ${test.cases.length}`}>
              <p className="text-sm">{c.scenario}</p>
              <fieldset className="space-y-2">
                <legend className="sr-only">Your answer to scenario {i + 1}</legend>
                {c.options.map((o) => (
                  <label key={o.id} className="flex items-start gap-2 text-sm">
                    <input type="radio" name={`answer:${c.id}`} value={o.id} required className="mt-1" />
                    <span>{o.text}</span>
                  </label>
                ))}
              </fieldset>
            </Section>
          ))}
          <SubmitButton>Submit my answers</SubmitButton>
        </form>
      ) : (
        <Muted>
          <Link href="/account/clinician" className="text-brand-green underline">
            Back to your application
          </Link>
        </Muted>
      )}
    </div>
  );
}

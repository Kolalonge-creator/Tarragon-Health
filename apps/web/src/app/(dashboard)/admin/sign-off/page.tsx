import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { getCallerPermissions } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { LoadFailure } from "@/components/ui/load-failure";
import { Badge } from "@/components/ui/badge";
import { readPendingFrontDeskSignoff } from "@/lib/queries/pending-front-desk-signoff";
import {
  describeDelay,
  knowledgeFingerprint,
  pendingKnowledge,
  pendingSteps,
  previewStepText,
  stepFingerprint,
} from "@/lib/frontdesk/signoff-model";
import { ApproveAll, ApproveOne, EditKnowledge, EditStep } from "./sign-off-forms";

export const metadata = { title: "Admin sign-off" };

const PURPOSE_LABEL = { service_followup: "Account and enquiry follow-up", marketing: "Needs a separate marketing consent" } as const;

export default async function AdminSignOffPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/login");
  // Approving wording is the founder's call: admin only (the database enforces it too).
  const { isSuperAdmin } = await getCallerPermissions();
  if (!isSuperAdmin) redirect("/admin");

  const supabase = await createClient();
  const data = await readPendingFrontDeskSignoff(supabase);
  const waitingSteps = pendingSteps(data.steps);
  const waitingKnowledge = pendingKnowledge(data.knowledge);
  const approvedSteps = data.steps.filter((s) => s.status === "approved");

  const bySequence = new Map<string, typeof waitingSteps>();
  for (const s of waitingSteps) bySequence.set(s.sequenceKey, [...(bySequence.get(s.sequenceKey) ?? []), s]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Admin sign-off"
        description="Everything that needs an admin's approval before it goes live. Nothing here sends or is said until you approve the exact wording."
      />

      {data.failed && (
        <LoadFailure>
          Some of the front desk wording could not be loaded, so this list may be short. This is not an all-clear: reload to try again.
        </LoadFailure>
      )}

      <section aria-labelledby="fd-heading" className="space-y-4">
        <div>
          <h2 id="fd-heading" className="font-heading text-xl font-semibold">Front desk</h2>
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {waitingSteps.length + waitingKnowledge.length === 0
              ? "Nothing is waiting. Every email and every knowledge entry is approved."
              : `${waitingSteps.length} follow-up email${waitingSteps.length === 1 ? "" : "s"} and ${waitingKnowledge.length} knowledge entr${waitingKnowledge.length === 1 ? "y" : "ies"} waiting. Names show as Ada and links as the app address, as the person will see them.`}
          </p>
        </div>

        {waitingSteps.length + waitingKnowledge.length > 0 && (
          <ApproveAll
            steps={waitingSteps.map((s) => ({ id: s.id, fingerprint: stepFingerprint(s) }))}
            knowledge={waitingKnowledge.map((k) => ({ id: k.id, fingerprint: knowledgeFingerprint(k) }))}
          />
        )}

        {[...bySequence.entries()].map(([key, steps]) => (
          <div key={key} className="space-y-3">
            <h3 className="font-heading text-lg font-semibold">
              {steps[0]?.sequenceName}{" "}
              <span className="text-sm font-normal text-charcoal-ink/60 dark:text-night-ink/60">
                {steps[0] ? PURPOSE_LABEL[steps[0].sequencePurpose] : ""}
              </span>
            </h3>
            <ul className="space-y-3">
              {steps.map((s) => (
                <li key={s.id} className="space-y-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/20 dark:bg-night-card">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="grey">Email {s.position}</Badge>
                    <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Sent {describeDelay(s.delayMinutes)}</span>
                  </div>
                  <p className="text-sm font-semibold">Subject: {previewStepText(s.subject)}</p>
                  <pre className="whitespace-pre-wrap rounded-lg bg-charcoal-ink/5 p-3 font-sans text-sm leading-relaxed dark:bg-night-ink/10">
                    {previewStepText(s.bodyText)}
                  </pre>
                  <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">An unsubscribe link is added under every email automatically.</p>
                  <div className="flex flex-wrap items-start gap-4">
                    <ApproveOne kind="step" id={s.id} fingerprint={stepFingerprint(s)} label="Approve this email" />
                    <EditStep id={s.id} subject={s.subject} bodyText={s.bodyText} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}

        {waitingKnowledge.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-heading text-lg font-semibold">What the website assistant may say</h3>
            <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
              The assistant states only approved entries. Prices and dates in curly brackets are filled in from the live settings, never typed here.
            </p>
            <ul className="space-y-3">
              {waitingKnowledge.map((k) => (
                <li key={k.id} className="space-y-3 rounded-xl border border-charcoal-ink/15 bg-white p-4 dark:border-night-ink/20 dark:bg-night-card">
                  <div className="flex items-center gap-2">
                    <Badge variant="grey">{k.topic.replace(/_/g, " ")}</Badge>
                    <span className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">Version {k.version}</span>
                  </div>
                  <pre className="whitespace-pre-wrap rounded-lg bg-charcoal-ink/5 p-3 font-sans text-sm leading-relaxed dark:bg-night-ink/10">{k.content}</pre>
                  <div className="flex flex-wrap items-start gap-4">
                    <ApproveOne kind="knowledge" id={k.id} fingerprint={knowledgeFingerprint(k)} label="Approve this entry" />
                    <EditKnowledge topic={k.topic} content={k.content} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        {approvedSteps.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-deep-forest">{approvedSteps.length} email{approvedSteps.length === 1 ? "" : "s"} already approved</summary>
            <ul className="mt-2 list-disc pl-5">
              {approvedSteps.map((s) => (
                <li key={s.id}>{s.sequenceName}, email {s.position}: {s.subject}</li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}

import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { acknowledgePage, closePage } from "@/lib/paging/actions";
import { formatWaiting, pageHeadline } from "@/lib/paging/alarm";
import { getMyActivePages } from "@/lib/paging/queries";
import { formatLagos } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

const RETURN_TO = "/clinician/on-call";

/** The clinician's open red event pages. Acknowledging stops the escalation; closing needs a note and ends the chart access the page gave. */
export async function OnCallPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const pages = await getMyActivePages();
  // one card per event: the family of pages (primary, backup, escalation) is one case
  const roots = [...new Map(pages.map((p) => [p.root_id, p])).values()];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="On call"
        description="Priority cases that were sent to you. Acknowledge one as soon as you see it: that stops the escalation. The case shows no name or details here; the patient's chart opens only once you have acknowledged."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      {roots.length === 0 ? (
        <Section title="Nothing waiting">
          <Muted>No priority case is waiting for you. This page checks again every few seconds.</Muted>
        </Section>
      ) : (
        roots.map((p) => {
          const acknowledged = p.acknowledged_at !== null;
          return (
            <Section key={p.root_id} title={acknowledged ? "Acknowledged, not yet closed" : pageHeadline(p)} hint={`Sent ${formatLagos(p.sent_at)}. Waiting ${formatWaiting(p.seconds_waiting)}.`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={acknowledged ? "green" : "red"}>{acknowledged ? "Acknowledged" : "Needs you now"}</Badge>
                {p.escalation_level > 0 ? <Badge variant="amber">Escalated, level {p.escalation_level}</Badge> : null}
              </div>
              {!acknowledged ? (
                <form action={acknowledgePage}>
                  <Hidden name="returnTo" value={RETURN_TO} />
                  <Hidden name="pageId" value={p.page_id} />
                  <SubmitButton>Acknowledge now</SubmitButton>
                </form>
              ) : (
                <div className="space-y-3">
                  {p.patient_id ? (
                    <Link href={`/clinician/patients/${p.patient_id}`} className="text-sm font-medium text-brand-green underline">
                      Open the patient&apos;s chart (this is logged)
                    </Link>
                  ) : null}
                  <form action={closePage} className="flex flex-wrap items-end gap-2">
                    <Hidden name="returnTo" value={RETURN_TO} />
                    <Hidden name="pageId" value={p.page_id} />
                    <Field label="What was done (at least 10 characters)">
                      <input name="note" required minLength={10} maxLength={500} className={fieldClass} />
                    </Field>
                    <SubmitButton tone="outline">Close page</SubmitButton>
                  </form>
                </div>
              )}
            </Section>
          );
        })
      )}
    </div>
  );
}

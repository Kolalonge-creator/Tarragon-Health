import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { acknowledgePage, closePage, confirmReadiness } from "@/lib/paging/actions";
import { READINESS_ITEMS, type ReadinessKey } from "@/lib/paging/schemas";
import { formatWaiting, pageHeadline } from "@/lib/paging/alarm";
import { getMyActivePages, getMyReadiness } from "@/lib/paging/queries";
import { formatLagos } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

const RETURN_TO = "/clinician/on-call";

/** The clinician's open red event pages. Acknowledging stops the escalation; closing needs a note and ends the chart access the page gave. */
export async function OnCallPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [pages, readiness] = await Promise.all([getMyActivePages(), getMyReadiness()]);
  // one card per event: the family of pages (primary, backup, escalation) is one case
  const roots = [...new Map(pages.map((p) => [p.root_id, p])).values()];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="On call"
        description="Priority cases that were sent to you. Acknowledge one as soon as you see it: that stops the escalation. The case shows no name or details here; the patient's chart opens only once you have acknowledged."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <Section
        title="Make sure alerts reach you"
        hint="Phones often stop apps in the background to save battery, and power and data cuts are common. These steps are guidance from phone makers and have not been tested on every handset. Ticking them is your own statement: it is recorded, and you cannot be put on the on-call rota until you have done it."
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={readiness.confirmed_at ? "green" : "amber"}>{readiness.confirmed_at ? `Confirmed ${formatLagos(readiness.confirmed_at)}` : "Not confirmed yet"}</Badge>
        </div>
        <form action={confirmReadiness} className="space-y-2">
          <Hidden name="returnTo" value={RETURN_TO} />
          {(Object.keys(READINESS_ITEMS) as ReadinessKey[]).map((key) => (
            <label key={key} className="flex items-start gap-2 text-sm">
              <input type="checkbox" name="item" value={key} required defaultChecked={readiness.confirmed_at !== null} className="mt-1" />
              <span>{READINESS_ITEMS[key]}</span>
            </label>
          ))}
          <p className="text-xs text-muted-foreground">On Tecno and Infinix phones look for App Power Saving or Auto-start; on other phones, Battery optimisation. Every page is also sent by email.</p>
          <SubmitButton>{readiness.confirmed_at ? "Confirm again" : "I have done these"}</SubmitButton>
        </form>
      </Section>
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

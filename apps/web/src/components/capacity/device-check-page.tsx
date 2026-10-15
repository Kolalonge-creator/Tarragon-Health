import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { acknowledgeTestPage, sendTestPage } from "@/lib/paging/actions";
import { getMyReadiness } from "@/lib/paging/queries";
import { GAP_LABELS } from "@/lib/paging/schemas";
import { DEVICE_GUIDES, GENERAL_DEVICE_STEPS } from "@/lib/capacity/device-guides";
import { formatLagos } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";
import { TestPageReceipt } from "@/components/paging/test-page-receipt";
import { DeviceStatus } from "./device-status";

const RETURN_TO = "/clinician/device-check";

/**
 * Device check (S16-S20 W5.5): make this phone or browser reliable for urgent pages. Browser status, the steps for the four phone brands our
 * clinicians use most, and a one-tap test page. The test page uses the same route as a real page, so passing it means the route works.
 */
export async function DeviceCheckPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const readiness = await getMyReadiness();
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="Device check"
        description="Urgent pages reach you by notification, in the app and by email. Phones often stop apps in the background to save battery, so check your phone once, and again after an update."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />
      <Section title="This browser" hint="What this screen can see about itself. It cannot see your phone's battery manager, which is why the test page below is the real check.">
        <DeviceStatus />
      </Section>
      <Section title="Send yourself a test page" hint="It arrives like a real page: a notification, in the app and by email. Acknowledge it when it arrives.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={readiness.gaps.length === 0 ? "green" : "amber"}>{readiness.gaps.length === 0 ? "All set" : `${readiness.gaps.length} to do`}</Badge>
          {readiness.last_test_page_acknowledged_at ? <span className="text-muted-foreground">Last test page acknowledged {formatLagos(readiness.last_test_page_acknowledged_at)}</span> : <span className="text-muted-foreground">No test page acknowledged yet.</span>}
        </div>
        {readiness.gaps.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {readiness.gaps.map((g) => (
              <li key={g}>{GAP_LABELS[g]}</li>
            ))}
          </ul>
        ) : null}
        {readiness.pending_test_page_id ? (
          <form action={acknowledgeTestPage}>
            <TestPageReceipt testId={readiness.pending_test_page_id} />
            <Hidden name="returnTo" value={RETURN_TO} />
            <Hidden name="testId" value={readiness.pending_test_page_id} />
            <SubmitButton>Acknowledge the test page</SubmitButton>
          </form>
        ) : (
          <form action={sendTestPage}>
            <Hidden name="returnTo" value={RETURN_TO} />
            <SubmitButton>Send me a test page</SubmitButton>
          </form>
        )}
      </Section>
      {DEVICE_GUIDES.map((g) => (
        <Section key={g.brand} title={g.brand} hint={g.alsoSold}>
          <ol className="list-decimal space-y-1 pl-5 text-sm">
            {g.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Section>
      ))}
      <Section title="For every phone">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {GENERAL_DEVICE_STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
        <Muted>These steps are the ones phone makers publish. Menu names change between versions and they have not been tested on every handset, so trust the test page over this list.</Muted>
      </Section>
    </div>
  );
}

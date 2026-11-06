import { t, type MessageKey } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPatientDate } from "@/lib/format-date";
import { permissionKey } from "@/lib/care-circle/model";
import type { AuditedRead, CareCircleView, OnboardingView } from "@/lib/clinical/onboarding-and-circle-audited";

function Unavailable({ what, status }: { what: string; status: "denied" | "error" }) {
  return (
    <p className="text-sm text-amber-800">
      {status === "denied"
        ? `${what} is not available to you (you are not on this patient's care team).`
        : `${what} could not be loaded. Reload the page.`}{" "}
      Do not read this as none.
    </p>
  );
}

/** DW-07: what the patient told us at sign-up. Their own words, never a diagnosis; the card says so. */
export function OnboardingAnswersCard({ read }: { read: AuditedRead<OnboardingView> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>What the patient told us at sign-up</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {read.status !== "ok" ? (
          <Unavailable what="The sign-up answers" status={read.status} />
        ) : read.value.goals.length === 0 && read.value.conditions.length === 0 ? (
          <p className="text-charcoal-ink/70">The patient did not answer these questions at sign-up.</p>
        ) : (
          <>
            <p className="text-xs text-charcoal-ink/60">
              The patient&apos;s own answers{read.value.answeredAt ? `, given ${formatPatientDate(read.value.answeredAt)}` : ""}.
              Self-reported, not a diagnosis: confirm before relying on them.
            </p>
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="font-medium text-charcoal-ink">Wants help with</dt>
                <dd className="text-charcoal-ink/80">
                  {read.value.goals.length > 0 ? read.value.goals.map((g) => t(`onb.goal.${g}` as MessageKey)).join("; ") : "Not answered"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-charcoal-ink">Says they have</dt>
                <dd className="text-charcoal-ink/80">
                  {read.value.conditions.length > 0
                    ? read.value.conditions.map((c) => t(`onb.condition.${c}` as MessageKey)).join("; ")
                    : "Not answered"}
                </dd>
              </div>
            </dl>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** DW-08: who supports the patient and what each may see, plus any pause. Every read is logged. */
export function CareCircleCard({ read }: { read: AuditedRead<CareCircleView> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Care Circle</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {read.status !== "ok" ? (
          <Unavailable what="The Care Circle" status={read.status} />
        ) : (
          <>
            {read.value.pausedUntil && (
              <p className="font-medium text-amber-800">
                Sharing is paused by the patient until {formatPatientDate(read.value.pausedUntil)}. Supporters see nothing new until then.
              </p>
            )}
            {read.value.supporters.length === 0 ? (
              <p className="text-charcoal-ink/70">No active supporters. Nothing about this patient is shared with family.</p>
            ) : (
              <ul className="divide-y divide-charcoal-ink/10">
                {read.value.supporters.map((s, i) => (
                  <li key={`${s.name}-${i}`} className="py-2">
                    <p className="font-medium text-charcoal-ink">
                      {s.name} <span className="font-normal text-charcoal-ink/70">({s.relationship})</span>
                      {s.primaryContact && <span className="ml-2 text-xs text-charcoal-ink/60">Main contact</span>}
                    </p>
                    <p className="text-charcoal-ink/70">
                      May see: {s.permissions.length > 0 ? s.permissions.map((p) => t(permissionKey(p))).join("; ") : "nothing yet"}
                      {s.since ? ` · since ${formatPatientDate(s.since)}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-charcoal-ink/60">
              Only what the patient allows is shared. A note for the family still needs the patient&apos;s approval before anyone sees it.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

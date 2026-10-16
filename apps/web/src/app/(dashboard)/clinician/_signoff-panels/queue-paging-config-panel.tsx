import { signTaskLayerConfigAction, activatePagingDeliveryConfigAction } from "../clinical-signoff/queue-paging-config-actions";
import { describeActivationReason, type PagingActivationCheck, type PagingRulesView, type TaskLayerAsk, type TaskLayerRulesView } from "@/lib/queries/pending-queue-paging-config-signoff";

const btn = "rounded-lg bg-brand-green px-4 py-2 text-sm font-semibold text-white hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Sign the task layer configuration (OQ-451). Shown inline on the sign-off hub. Signing the version in force records your acceptance and
 * changes no behaviour; signing a newer draft makes it the version in force. Every number is read from the version being signed.
 */
export function TaskLayerConfigPanel({ ask, rules }: { ask: TaskLayerAsk; rules: TaskLayerRulesView | null }) {
  if (ask === null) return null;
  return (
    <form action={signTaskLayerConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={ask.version} />
      <h3 className="font-medium text-charcoal-ink">Task layer rules, version {ask.version}</h3>
      {rules ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>A task is offered to its lead for the shorter of the task type&apos;s window and {rules.windowCapPercent} percent of the task&apos;s own due time, then goes to the pool.</li>
          <li>
            An escalated task that is not a red event {rules.anyEligibleWhenEscalated ? "can be taken by any eligible clinician" : "stays with its lead"}. Red events keep the on-call rule.
          </li>
          <li>Escalation alerts for task classes 1 to {rules.immediateMaxClass} go out at once (in-app, push and email). Lower classes appear in the app and in a daily digest.</li>
          <li>A critical result is not closed without {rules.contactAttempts} dated contact attempts. A closing note can be up to {rules.noteMaxChars} characters.</li>
          <li>
            The watchdog raises an incident when a job has not run for: {rules.watchdogJobMinutes.map((j) => `${j.job} ${j.minutes} min`).join(", ")}; and when a task of a class waits longer than:{" "}
            {rules.warningMinutes.map((w) => `class ${w.taskClass} ${w.minutes} min`).join(", ")}.
          </li>
        </ul>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The numbers in this version could not be read, so they are not shown here. Do not sign until they can be.</p>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules} />
        <span>
          {ask.kind === "accept_in_force"
            ? `I have read this and I accept task layer configuration version ${ask.version}, which is already running. Signing records my acceptance and changes nothing else. If I want different numbers I will ask for a new version.`
            : `I have read this and I sign task layer configuration version ${ask.version} for use. It replaces the version in force, which stays on record. A signed version is never edited; a change is a new version.`}
        </span>
      </label>
      <button type="submit" className={btn} disabled={!rules}>
        {ask.kind === "accept_in_force" ? `Accept task layer configuration version ${ask.version}` : `Sign task layer configuration version ${ask.version}`}
      </button>
    </form>
  );
}

/**
 * Activate the paging delivery configuration (OQ-451, decision S16-S20-15). The database refuses until every on-call clinician has a working
 * push subscription, a verified email and a test page acknowledged in the window, and says who is still missing what. The list below is the
 * same check, read now. If the check cannot be read the button stays off.
 */
export function PagingDeliveryConfigPanel({
  version,
  rules,
  inForce,
  check,
}: {
  version: number | null;
  rules: PagingRulesView | null;
  inForce: PagingRulesView | null;
  check: PagingActivationCheck | null;
}) {
  if (version === null) return null;
  return (
    <form action={activatePagingDeliveryConfigAction} className="space-y-3">
      <input type="hidden" name="version" value={version} />
      <h3 className="font-medium text-charcoal-ink">Pager readiness gate, paging delivery configuration version {version}</h3>
      {rules ? (
        <ul className="list-disc space-y-1 pl-5 text-sm text-charcoal-ink/80">
          <li>
            {rules.objectiveReadinessRequired
              ? `A clinician can be put on the on-call rota only with a working push subscription, a verified email and a test page acknowledged in the last ${rules.readinessTestPageDays} days. Existing shifts are not cancelled and swaps are never blocked.`
              : "This version does not require the objective readiness checks."}
          </li>
          <li>
            Everything else is the same as the version in force: a page not seen on the phone within {rules.deliveredAckSeconds} seconds ({rules.deliveredAckSecondsUnconfirmed} for a route not confirmed) moves to the backup early; repeat events merge for {rules.mergeWindowMinutes} minutes; the engine counts as stopped after {rules.heartbeatStaleSeconds} seconds without a heartbeat.
            {inForce && inForce.objectiveReadinessRequired !== rules.objectiveReadinessRequired ? " The readiness requirement is the one change." : ""}
          </li>
        </ul>
      ) : (
        <p className="text-sm text-charcoal-ink/80">The numbers in this version could not be read, so they are not shown here. Do not activate until they can be.</p>
      )}
      {check === null ? (
        <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">
          The readiness checklist could not be read, so this cannot be activated now. Nothing is changed. Try again, and tell engineering if it keeps failing.
        </p>
      ) : check.ready ? (
        <p role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          Checklist met: all {check.on_call_count} on-call clinician{check.on_call_count === 1 ? " has" : "s have"} a working push subscription, a verified email and a test page acknowledged in the last {check.window_days} days.
        </p>
      ) : (
        <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Not ready to activate. Still missing:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {check.reasons.map((r, i) => (
              <li key={`${r.code}-${r.clinician_id ?? i}`}>{describeActivationReason(r)}</li>
            ))}
          </ul>
          <p className="mt-2">Each clinician sends themselves a test page from the On call screen and acknowledges it. Then reload this page.</p>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm text-charcoal-ink">
        <input type="checkbox" name="understood" className="mt-1" required disabled={!rules || !check?.ready} />
        <span>I have read this and I activate paging delivery configuration version {version}. It replaces the version in force, which stays on record. It can be reversed only by a later version.</span>
      </label>
      <button type="submit" className={btn} disabled={!rules || !check?.ready}>
        Activate paging delivery configuration version {version}
      </button>
    </form>
  );
}

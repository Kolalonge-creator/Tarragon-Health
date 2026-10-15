import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { decidePause, endIntakeOverride, endOpsMode, overrideRestRule, requestPause, setIntakeOverride, startOpsMode } from "@/lib/capacity/actions";
import { getCoverOverview, getIntakeOverview } from "@/lib/capacity/queries";
import { GATE_REASON_LABEL, type OpsModeRow } from "@/lib/capacity/schemas";
import { formatLagos } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

const STATE_LABEL: Record<OpsModeRow["state"], string> = {
  requested: "Waiting for the clinical lead",
  active: "On",
  lapsed: "Ended by itself",
  ended: "Ended",
  declined: "Declined",
};

/**
 * Capacity and cover (S16-S20 Stage 5). The clinical lead (Chief Medical Officer) can switch surge mode and a pause on, record an override
 * of the intake gate and a rest-rule override. An administrator sees the same facts and can only ASK for a pause. Every rule is checked
 * by the database; this page only shows the state and sends the forms.
 */
export async function CapacityPage({ basePath, isCmo, searchParams }: { basePath: "/clinician/capacity" | "/admin/capacity"; isCmo: boolean; searchParams: SearchParams }) {
  const sp = await searchParams;
  const [o, cover] = await Promise.all([getIntakeOverview(), getCoverOverview()]);
  const g = o.gate;
  const pending = o.modes.filter((m) => m.state === "requested");
  const active = o.modes.filter((m) => m.state === "active");

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader
        title="Capacity and cover"
        description="Whether new care packs can be sold, surge mode and pause, rest after busy nights, and cover offers. None of this ever stops an urgent page, emergency guidance, a patient who is already enrolled, or work a clinician has already taken."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />

      <Section
        title="New sales and enrolments"
        hint={o.enforced ? "The intake gate is on: new care pack sales stop by themselves when a limit below is crossed." : "The intake gate is NOT switched on yet. The limits below are shown so you can see what it would do. The clinical lead switches it on by signing capacity configuration version 2 in the sign-off hub, after the on-call cover guard has been switched on."}
      >
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={g.open ? "green" : "red"}>{g.open ? "Within limits" : "A limit is crossed"}</Badge>
          <Badge variant={o.enforced ? "green" : "grey"}>{o.enforced ? "Gate on" : "Gate off"}</Badge>
          <Badge variant={o.guard_on ? "green" : "grey"}>{o.guard_on ? "On-call cover guard on" : "On-call cover guard off"}</Badge>
          {o.surge_active ? <Badge variant="amber">Surge mode on</Badge> : null}
          {o.pause_active ? <Badge variant="red">Pause on</Badge> : null}
        </div>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>
            Places with lead clinicians: {g.lead_free} free of {g.lead_capacity} ({g.lead_in_use} in use). Sales stop below {g.min_lead_headroom} free.
            {g.reasons.includes("lead_headroom") ? " This limit is crossed." : ""}
          </li>
          <li>
            On-call rota for the next {g.rota_horizon_hours} hours: {g.rota_gap_hours === 0 ? "a primary and a backup every hour." : `${g.rota_gap_hours} hours without a primary and a working backup.`}
            {g.reasons.includes("rota_coverage") ? " This limit is crossed." : ""}
          </li>
          <li>
            Oldest waiting clinical work:{" "}
            {g.class_breaches.length === 0
              ? "within its limits."
              : g.class_breaches.map((b) => `class ${b.priority_class} waiting ${b.oldest_open_minutes} minutes (limit ${b.warn_after_minutes ?? "none"})`).join("; ") + "."}
          </li>
        </ul>
        {g.reasons.length > 0 ? <p className="text-sm text-red-700 dark:text-red-300">{g.reasons.map((r) => GATE_REASON_LABEL[r] ?? r).join(". ")}.</p> : null}
        {o.override ? (
          <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
            <p>
              Override in force until {formatLagos(o.override.expires_at)}: {o.override.reason}
            </p>
            {isCmo ? (
              <form action={endIntakeOverride}>
                <Hidden name="returnTo" value={basePath} />
                <Hidden name="id" value={o.override.id} />
                <SubmitButton tone="outline">End the override</SubmitButton>
              </form>
            ) : null}
          </div>
        ) : isCmo ? (
          <form action={setIntakeOverride} className="flex flex-wrap items-end gap-2">
            <Hidden name="returnTo" value={basePath} />
            <Field label={`Reason (at least ${o.limits.reason_min_chars} characters)`}>
              <input name="reason" required minLength={o.limits.reason_min_chars} maxLength={500} className={fieldClass} />
            </Field>
            <Field label={`Hours (up to ${o.limits.override_max_hours})`}>
              <input name="hours" type="number" min={1} max={o.limits.override_max_hours} defaultValue={4} required className={fieldClass} />
            </Field>
            <SubmitButton tone="outline">Override the limits</SubmitButton>
          </form>
        ) : null}
        <Muted>An override reopens sales when the limits above are crossed. It never reopens a pause or a surge. It ends by itself at the time you set.</Muted>
      </Section>

      <Section title="Surge mode and pause" hint="Both switch themselves off at the end time. Both are recorded with who, why and for how long.">
        {active.length === 0 ? <Muted>Neither is on.</Muted> : null}
        {active.map((m) => (
          <div key={m.id} className="space-y-2 rounded-md border border-charcoal-ink/15 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={m.mode === "pause" ? "red" : "amber"}>{m.mode === "pause" ? "Pause" : "Surge mode"}</Badge>
              <span>Until {m.expires_at ? formatLagos(m.expires_at) : "unknown"}</span>
            </div>
            <p>{m.reason}</p>
            {isCmo ? (
              <form action={endOpsMode} className="flex flex-wrap items-end gap-2">
                <Hidden name="returnTo" value={basePath} />
                <Hidden name="id" value={m.id} />
                <Field label="Note (optional)">
                  <input name="note" maxLength={300} className={fieldClass} />
                </Field>
                <SubmitButton tone="outline">Switch it off now</SubmitButton>
              </form>
            ) : null}
          </div>
        ))}
        {pending.map((m) => (
          <div key={m.id} className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-500/40 dark:bg-amber-500/10">
            <p>
              Pause requested {formatLagos(m.requested_at)}: {m.reason}
            </p>
            <p>It lapses on its own at {m.confirm_by ? formatLagos(m.confirm_by) : "the time set"} unless the clinical lead confirms.</p>
            {isCmo ? (
              <form action={decidePause} className="flex flex-wrap items-end gap-2">
                <Hidden name="returnTo" value={basePath} />
                <Hidden name="id" value={m.id} />
                <Field label={`Hours (up to ${o.limits.pause_max_hours})`}>
                  <input name="hours" type="number" min={1} max={o.limits.pause_max_hours} defaultValue={4} required className={fieldClass} />
                </Field>
                <button type="submit" name="decision" value="confirm" className="inline-flex h-9 items-center rounded-md bg-brand-green px-3 text-sm font-medium text-white">
                  Confirm the pause
                </button>
                <button type="submit" name="decision" value="decline" className="inline-flex h-9 items-center rounded-md border border-charcoal-ink/25 px-3 text-sm font-medium">
                  Decline
                </button>
              </form>
            ) : null}
          </div>
        ))}
        {isCmo ? (
          <form action={startOpsMode} className="flex flex-wrap items-end gap-2">
            <Hidden name="returnTo" value={basePath} />
            <Field label="Which">
              <select name="mode" className={fieldClass} defaultValue="surge">
                <option value="surge">Surge mode: pause new intake, widen routine work to any eligible clinician, longer routine times</option>
                <option value="pause">Pause: new sales, enrolments, bookings and routine offers wait</option>
              </select>
            </Field>
            <Field label={`Reason (at least ${o.limits.reason_min_chars} characters)`}>
              <input name="reason" required minLength={o.limits.reason_min_chars} maxLength={500} className={fieldClass} />
            </Field>
            <Field label={`Hours (surge up to ${o.limits.surge_max_hours}, pause up to ${o.limits.pause_max_hours})`}>
              <input name="hours" type="number" min={1} max={o.limits.pause_max_hours} defaultValue={4} required className={fieldClass} />
            </Field>
            <SubmitButton>Switch on</SubmitButton>
          </form>
        ) : (
          <form action={requestPause} className="flex flex-wrap items-end gap-2">
            <Hidden name="returnTo" value={basePath} />
            <Field label={`Why a pause is needed (at least ${o.limits.reason_min_chars} characters)`} hint={`You can only ask. The clinical lead has ${o.limits.pause_confirm_minutes / 60} hours to confirm; if they do not, the request lapses and nothing is paused.`}>
              <input name="reason" required minLength={o.limits.reason_min_chars} maxLength={500} className={fieldClass} />
            </Field>
            <SubmitButton tone="outline">Ask for a pause</SubmitButton>
          </form>
        )}
        <Muted>
          A pause stops new sales, new enrolments, bookings and the offering of routine tasks. Urgent pages, emergency guidance, the on-call rota and any task a clinician already holds are not touched.
        </Muted>
        {o.modes.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer font-medium">History</summary>
            <ul className="mt-2 space-y-1">
              {o.modes.map((m) => (
                <li key={m.id}>
                  {formatLagos(m.requested_at)} {m.mode === "pause" ? "Pause" : "Surge mode"}: {STATE_LABEL[m.state]}. {m.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Section>

      <Section
        title="Rest after busy nights"
        hint={`${cover.rest_enforced ? "On" : "Not switched on yet"}. After a shift with overnight pages nobody can be put on call or declare queue time inside ${cover.rest_hours} hours of rest. Only the clinical lead can override, with a written reason.`}
      >
        {cover.offers.length === 0 ? <Muted>No cover offers yet.</Muted> : null}
        <ul className="space-y-1 text-sm">
          {cover.offers.map((f) => (
            <li key={f.id}>
              {f.clinician ?? "A clinician"}: {f.overnight_pages} overnight pages, next shift {formatLagos(f.next_shift_starts_at)}.{" "}
              <Badge variant={f.state === "cover_requested" ? "red" : f.state === "fit_confirmed" ? "green" : "amber"}>
                {f.state === "offered" ? "Waiting for an answer" : f.state === "fit_confirmed" ? "Confirmed fit to work" : "Asked for cover"}
              </Badge>
            </li>
          ))}
        </ul>
        {cover.rest_overrides.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {cover.rest_overrides.map((r) => (
              <li key={r.id}>
                {r.clinician ?? "A clinician"}: {formatLagos(r.valid_from)} to {formatLagos(r.valid_to)}. {r.reason}
              </li>
            ))}
          </ul>
        ) : null}
        {isCmo ? (
          <form action={overrideRestRule} className="grid gap-2 sm:grid-cols-2">
            <Hidden name="returnTo" value={basePath} />
            <Field label="Clinician (profile id)">
              <input name="clinician" required pattern="[0-9a-fA-F-]{36}" className={fieldClass} />
            </Field>
            <Field label={`Reason (at least ${o.limits.reason_min_chars} characters)`}>
              <input name="reason" required minLength={o.limits.reason_min_chars} maxLength={500} className={fieldClass} />
            </Field>
            <Field label="Covers shifts starting from">
              <input name="from" type="datetime-local" required className={fieldClass} />
            </Field>
            <Field label="up to (at most 3 days)">
              <input name="to" type="datetime-local" required className={fieldClass} />
            </Field>
            <div className="sm:col-span-2">
              <SubmitButton tone="outline">Record a rest rule override</SubmitButton>
            </div>
          </form>
        ) : null}
      </Section>
    </div>
  );
}

import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { approveSwap, assignLead, cancelShift, changeLead, confirmHours, setShift } from "@/lib/rota/actions";
import { getLeadCapacity, getLeadOverview, getRotaOverview } from "@/lib/rota/queries";
import { GAP_LABEL } from "@/lib/rota/schemas";
import { defaultStartInput, formatLagos, formatLagosRange } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

/**
 * The reviewer's page, shared by the admin (/admin/rota) and the Chief Medical Officer (/clinician/team-rota). A CMO's
 * account role is always `clinician`, which cannot open /admin, so the same page is mounted under both. The route files
 * do the role gate; the database re-checks every read and write.
 */
export async function RotaBuilderPage({ returnTo, searchParams }: { returnTo: string; searchParams: SearchParams }) {
  const sp = await searchParams;
  const [overview, leads, capacity] = await Promise.all([getRotaOverview(), getLeadOverview(), getLeadCapacity()]);
  const start = defaultStartInput(new Date());
  const { status } = overview;

  return (
    <div className="space-y-5">
      <PageHeader title="Rota and lead clinicians" description="Who is on call, who is declared to work, and who leads each care pack patient. All times are Lagos time." />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />

      <Section title="On-call cover" hint={`The next ${status.horizon_days} days. Uncovered hours open an incident, so nothing is left to chance.`}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={status.covered_now ? "green" : "red"}>{status.covered_now ? "Covered now" : "Not covered now"}</Badge>
          <span>
            Primary: <strong>{status.current_primary ?? "nobody"}</strong>. Backup: <strong>{status.current_backup ?? "nobody"}</strong>.
          </span>
          {!status.enough_clinicians ? <Badge variant="amber">Fewer than two eligible on-call clinicians</Badge> : null}
        </div>
        {status.gaps.length > 0 ? (
          <ul className="mt-2 space-y-1 text-sm">
            {status.gaps.map((g, i) => (
              <li key={`${g.from}-${i}`} className="text-red-800 dark:text-red-200">
                {GAP_LABEL[g.kind] ?? g.kind}: {formatLagosRange(g.from, g.to)}
              </li>
            ))}
          </ul>
        ) : (
          <Muted>No gaps in the next {status.horizon_days} days.</Muted>
        )}
      </Section>

      <Section title="Set a shift" hint="Every shift needs a primary and a different backup. A contracted clinician needs confirmed on-call hours covering the shift. Rest and shift-count warnings can be overridden with a written reason.">
        <form action={setShift} className="grid gap-3 sm:grid-cols-2">
          <Hidden name="returnTo" value={returnTo} />
          <Field label="From">
            <input type="datetime-local" name="starts" required defaultValue={start} className={fieldClass} />
          </Field>
          <Field label="To">
            <input type="datetime-local" name="ends" required className={fieldClass} />
          </Field>
          <Field label="Primary">
            <select name="primary" required defaultValue="" className={fieldClass}>
              <option value="" disabled>
                Choose
              </option>
              {overview.clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "Clinician"} ({c.employment_type})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Backup">
            <select name="backup" required defaultValue="" className={fieldClass}>
              <option value="" disabled>
                Choose
              </option>
              {overview.clinicians.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "Clinician"} ({c.employment_type})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Override reason (only if a warning stops the save)">
            <input name="override" maxLength={300} className={fieldClass} />
          </Field>
          <div className="flex items-end">
            <SubmitButton>Save shift</SubmitButton>
          </div>
        </form>
      </Section>

      <Section title="Shifts">
        {overview.shifts.length === 0 ? (
          <Muted>No shifts in this period.</Muted>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {overview.shifts.map((s) => (
              <li key={s.id} className="space-y-2 py-2">
                <div>
                  {formatLagosRange(s.starts_at, s.ends_at)}: primary <strong>{s.primary_name ?? "unknown"}</strong>, backup{" "}
                  <strong>{s.backup_name ?? "none (needs one)"}</strong>
                </div>
                {s.warnings.length > 0 ? <div className="text-xs text-amber-800 dark:text-amber-200">Override: {s.warnings.join("; ")} ({s.override_reason})</div> : null}
                <form action={cancelShift} className="flex flex-wrap items-end gap-2">
                  <Hidden name="returnTo" value={returnTo} />
                  <Hidden name="rotaId" value={s.id} />
                  <Field label="Reason to cancel">
                    <input name="reason" required minLength={3} maxLength={200} className={fieldClass} />
                  </Field>
                  <SubmitButton tone="outline">Cancel shift</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {overview.pending_blocks.length > 0 ? (
        <Section title="On-call hours to confirm" hint="A contracted clinician can only be rostered inside confirmed on-call hours.">
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {overview.pending_blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {b.name ?? "Clinician"}: {formatLagosRange(b.starts_at, b.ends_at)}
                </span>
                <form action={confirmHours}>
                  <Hidden name="returnTo" value={returnTo} />
                  <Hidden name="blockId" value={b.id} />
                  <SubmitButton>Confirm</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {overview.swaps.length > 0 ? (
        <Section title="Cover requests" hint="Nothing changes until the colleague accepts and you approve.">
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {overview.swaps.map((s) => (
              <li key={s.id} className="space-y-2 py-2">
                <div>
                  {s.from_name ?? "A clinician"} asks {s.to_name ?? "a colleague"} to cover the {s.role} slot: {s.reason}{" "}
                  <Badge variant={s.state === "accepted" ? "green" : "grey"}>{s.state === "accepted" ? "Accepted" : "Waiting for an answer"}</Badge>
                </div>
                {s.state === "accepted" ? (
                  <form action={approveSwap} className="flex flex-wrap items-end gap-2">
                    <Hidden name="returnTo" value={returnTo} />
                    <Hidden name="swapId" value={s.id} />
                    <Field label="Override reason (only if a warning stops it)">
                      <input name="override" maxLength={300} className={fieldClass} />
                    </Field>
                    <SubmitButton>Approve</SubmitButton>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Lead clinicians" hint="Each care pack patient has one lead. A new lead is chosen by continuity, then language, then the fewest patients. Nobody is over their limit.">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge variant={capacity.accepting_new_patients ? "green" : "red"}>{capacity.accepting_new_patients ? "Room for new patients" : "No room for new patients"}</Badge>
          <span>
            {capacity.in_use} of {capacity.capacity} places in use, {capacity.free} free.
          </span>
        </div>
        {leads.leads.length === 0 ? (
          <Muted>No clinician has the lead clinician competency yet. Grant it under Clinician credentialing.</Muted>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-charcoal-ink/60">
                <th className="py-1 pr-2">Clinician</th>
                <th className="py-1 pr-2">Type</th>
                <th className="py-1">Patients</th>
              </tr>
            </thead>
            <tbody>
              {leads.leads.map((l) => (
                <tr key={l.clinician_id} className="border-t border-charcoal-ink/10">
                  <td className="py-1 pr-2">{l.name ?? "Clinician"}</td>
                  <td className="py-1 pr-2">{l.employment_type}</td>
                  <td className="py-1">
                    {l.active} of {l.cap}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Patients waiting for a lead" hint="These patients have no eligible lead yet. They are told their care team is being arranged, and an incident stays open.">
        {leads.unassigned.length === 0 ? (
          <Muted>Nobody is waiting.</Muted>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {leads.unassigned.map((u) => (
              <li key={u.patient_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  Patient {u.patient_id.slice(0, 8)} waiting since {formatLagos(u.since)}
                </span>
                <form action={assignLead}>
                  <Hidden name="returnTo" value={returnTo} />
                  <Hidden name="patientId" value={u.patient_id} />
                  <SubmitButton>Try to assign now</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Change a patient's lead" hint="For a request from the patient or the clinician, or to rebalance. The patient and the new lead are told. A reason is kept on record.">
        <form action={changeLead} className="grid gap-3 sm:grid-cols-2">
          <Hidden name="returnTo" value={returnTo} />
          <Field label="Patient reference">
            <input name="patientId" required pattern="[0-9a-fA-F-]{36}" className={fieldClass} />
          </Field>
          <Field label="Why">
            <select name="reason" className={fieldClass} defaultValue="patient_request">
              <option value="patient_request">The patient asked</option>
              <option value="clinician_request">The clinician asked</option>
              <option value="capacity_rebalance">Rebalancing the load</option>
              <option value="conflict">Conflict of interest</option>
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Note (at least 10 characters)">
              <input name="note" required minLength={10} maxLength={300} className={fieldClass} />
            </Field>
          </div>
          <div>
            <SubmitButton tone="outline">Change lead</SubmitButton>
          </div>
        </form>
        {leads.conflicts_open > 0 ? <Muted>{leads.conflicts_open} conflict(s) of interest are on record or waiting for review.</Muted> : null}
      </Section>
    </div>
  );
}

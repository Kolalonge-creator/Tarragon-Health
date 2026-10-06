import { PageHeader } from "@/components/ui/page-header";
import { Field, fieldClass, Flash, Hidden, Muted, Section, SubmitButton } from "@/components/credentialing/shared";
import { cancelHours, cancelSwap, declareHours, requestSwap, respondSwap } from "@/lib/rota/actions";
import { getColleagues, getMyBlocks, getMyLeadSummary, getMyRota, getMySwaps } from "@/lib/rota/queries";
import { BLOCK_KIND_LABEL } from "@/lib/rota/schemas";
import { defaultStartInput, formatLagosRange } from "@/lib/rota/time";
import { firstParam, type SearchParams } from "@/lib/credentialing/params";

const RETURN_TO = "/clinician/rota";

/** A working clinician's own page: hours they declare, the on-call rota, cover requests, their lead list. */
export async function ClinicianRotaPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const [blocks, rota, swaps, colleagues, lead] = await Promise.all([getMyBlocks(), getMyRota(), getMySwaps(), getColleagues(), getMyLeadSummary()]);
  const start = defaultStartInput(new Date());
  const incoming = swaps.filter((s) => s.direction === "incoming");
  const outgoing = swaps.filter((s) => s.direction === "outgoing");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title="My hours and the rota"
        description="Tell us when you will work. A contracted clinician is offered work only inside the hours declared here, in Lagos time."
      />
      <Flash ok={firstParam(sp.ok)} error={firstParam(sp.error)} />

      {lead.lead_capable ? (
        <Section title="Your lead list" hint="Patients for whom you are the lead clinician.">
          <p className="text-sm">
            {lead.lead_patients} of {lead.cap} patients.
          </p>
        </Section>
      ) : null}

      <Section title="Declare hours" hint="At least two hours. On-call hours are checked by a reviewer before they count for the rota.">
        <form action={declareHours} className="flex flex-wrap items-end gap-3">
          <Hidden name="returnTo" value={RETURN_TO} />
          <Field label="Kind">
            <select name="kind" className={fieldClass} defaultValue="queue">
              <option value="queue">Working the queue</option>
              <option value="on_call">On call</option>
              <option value="bookable_consultations">Bookable consultations</option>
            </select>
          </Field>
          <Field label="From">
            <input type="datetime-local" name="starts" required defaultValue={start} className={fieldClass} />
          </Field>
          <Field label="To">
            <input type="datetime-local" name="ends" required className={fieldClass} />
          </Field>
          <SubmitButton>Declare</SubmitButton>
        </form>
      </Section>

      <Section title="Your declared hours">
        {blocks.length === 0 ? (
          <Muted>No upcoming hours declared.</Muted>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {blocks.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <strong>{BLOCK_KIND_LABEL[b.kind] ?? b.kind}</strong> {formatLagosRange(b.starts_at, b.ends_at)}{" "}
                  <span className="text-charcoal-ink/60">({b.state === "declared" && b.kind === "on_call" ? "waiting for approval" : b.state})</span>
                </span>
                <form action={cancelHours}>
                  <Hidden name="returnTo" value={RETURN_TO} />
                  <Hidden name="blockId" value={b.id} />
                  <SubmitButton tone="outline">Cancel</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="On-call rota" hint="Two people on every shift: the primary, then the backup. If you cannot cover a shift, ask a colleague.">
        {rota.length === 0 ? (
          <Muted>No shifts on the rota yet.</Muted>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {rota.map((r) => (
              <li key={r.id} className="space-y-2 py-2">
                <div>
                  {formatLagosRange(r.starts_at, r.ends_at)}: primary <strong>{r.primary_name ?? "unknown"}</strong>, backup <strong>{r.backup_name ?? "none yet"}</strong>
                  {r.my_role ? <span className="ml-2 rounded bg-brand-green/10 px-2 py-0.5 text-xs text-brand-green">You are {r.my_role}</span> : null}
                </div>
                {r.my_role ? (
                  <details>
                    <summary className="cursor-pointer text-xs font-medium">Ask a colleague to cover</summary>
                    <form action={requestSwap} className="mt-2 flex flex-wrap items-end gap-2">
                      <Hidden name="returnTo" value={RETURN_TO} />
                      <Hidden name="rotaId" value={r.id} />
                      <Hidden name="role" value={r.my_role} />
                      <Field label="Colleague">
                        <select name="to" required className={fieldClass} defaultValue="">
                          <option value="" disabled>
                            Choose
                          </option>
                          {colleagues.map((c) => (
                            <option key={c.clinician_id} value={c.clinician_id}>
                              {c.name ?? "Colleague"}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Why">
                        <input name="reason" required minLength={3} maxLength={200} className={fieldClass} />
                      </Field>
                      <SubmitButton tone="outline">Send request</SubmitButton>
                    </form>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {incoming.length + outgoing.length > 0 ? (
        <Section title="Cover requests">
          <ul className="divide-y divide-charcoal-ink/10 text-sm">
            {incoming.map((s) => (
              <li key={s.id} className="space-y-2 py-2">
                <div>
                  {s.from_name ?? "A colleague"} asks you to cover the {s.role} slot, {formatLagosRange(s.starts_at, s.ends_at)}: {s.reason}
                </div>
                {s.state === "requested" ? (
                  <div className="flex gap-2">
                    {(["accept", "decline"] as const).map((answer) => (
                      <form key={answer} action={respondSwap}>
                        <Hidden name="returnTo" value={RETURN_TO} />
                        <Hidden name="swapId" value={s.id} />
                        <Hidden name="answer" value={answer} />
                        <SubmitButton tone={answer === "accept" ? "default" : "outline"}>{answer === "accept" ? "Accept" : "Decline"}</SubmitButton>
                      </form>
                    ))}
                  </div>
                ) : (
                  <Muted>You accepted. Waiting for a reviewer to approve it.</Muted>
                )}
              </li>
            ))}
            {outgoing.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  You asked {s.to_name ?? "a colleague"} to cover {formatLagosRange(s.starts_at, s.ends_at)} ({s.state === "accepted" ? "accepted, waiting for a reviewer" : "waiting for an answer"}). Until it is approved the shift is still yours.
                </span>
                <form action={cancelSwap}>
                  <Hidden name="returnTo" value={RETURN_TO} />
                  <Hidden name="swapId" value={s.id} />
                  <SubmitButton tone="outline">Withdraw</SubmitButton>
                </form>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

    </div>
  );
}

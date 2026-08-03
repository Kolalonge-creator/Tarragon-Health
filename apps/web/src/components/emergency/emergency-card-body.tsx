import { BLOOD_PROVENANCE, GENOTYPE_NOTE, type EmergencyClinicalFacts } from "@/lib/emergency/card";

/**
 * The visual rendering shared by BOTH emergency-card surfaces:
 *   - the authenticated print page (`/patient/emergency-card/print`), which
 *     is the DEFAULT a patient is pointed at, and
 *   - the anon live-link page (`/emergency/[token]`), which is now an
 *     explicit opt-in on top.
 *
 * Extracted so the two can never visually diverge — a stranger reading either
 * one sees the identical layout, and a change to how a severe allergy or an
 * unconfirmed blood group is presented only ever needs to be made once.
 *
 * `qrSlot` and `footer` are the only things that differ between the two
 * surfaces (a plain-text QR + "printed on" footer for the offline card; a
 * "scan to open" implicit context + issued/expires/view-log footer for the
 * live one) — everything else is identical.
 */
export function EmergencyCardBody({
  facts,
  headerLabel,
  headerSubline,
  qrSlot,
  footer,
}: {
  facts: EmergencyClinicalFacts;
  /** e.g. "Emergency health card" (both surfaces use the same label today). */
  headerLabel: string;
  /** e.g. "Printed 3 August 2026" or "Issued 3 Aug 2026 · Valid until 3 Aug 2027". */
  headerSubline: string;
  /** The print page's plain-text QR; the live page passes nothing. */
  qrSlot?: React.ReactNode;
  footer: React.ReactNode;
}) {
  const severeAllergies = facts.allergies.filter((a) => a.severity === "severe");
  const genotypeNote = facts.blood?.genotype ? GENOTYPE_NOTE[facts.blood.genotype] : undefined;
  const provenance = facts.blood?.provenance ? BLOOD_PROVENANCE[facts.blood.provenance] : undefined;

  return (
    <main className="mx-auto max-w-2xl p-4 print:max-w-none print:p-0">
      <header className="rounded-t-lg bg-deep-forest p-4 text-white print:rounded-none">
        <p className="text-xs uppercase tracking-widest opacity-80">{headerLabel}</p>
        <h1 className="mt-1 text-2xl font-semibold">{facts.full_name ?? "Name not recorded"}</h1>
        <p className="mt-1 text-sm opacity-90">
          {formatDob(facts.date_of_birth)}
          {facts.sex ? ` · ${facts.sex}` : ""}
          {facts.patient_number ? ` · ${facts.patient_number}` : ""}
        </p>
        <p className="mt-1 text-xs opacity-75">{headerSubline}</p>
      </header>

      {/* Blood facts first. In Nigeria genotype is often the single most
          decision-changing line on this card — and how much to lean on it
          depends entirely on where it came from, so provenance is shown as
          prominently as the value itself. */}
      <section
        className={`border-x border-charcoal-ink/15 p-4 ${
          provenance?.tone === "unconfirmed" ? "bg-amber-50" : "bg-emerald-50"
        }`}
      >
        <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">Blood</h2>
        {facts.blood && (facts.blood.blood_group || facts.blood.genotype) ? (
          <>
            <p className="mt-1 text-xl font-semibold text-charcoal-ink">
              {facts.blood.blood_group ?? "Group not recorded"}
              {facts.blood.genotype ? ` · Genotype ${facts.blood.genotype}` : ""}
            </p>
            {genotypeNote ? <p className="text-sm font-medium text-charcoal-ink/80">{genotypeNote}</p> : null}
            {facts.blood.note ? <p className="text-sm text-charcoal-ink/70">{facts.blood.note}</p> : null}
            {provenance ? (
              <p
                className={`mt-2 text-sm font-medium ${
                  provenance.tone === "unconfirmed" ? "text-amber-900" : "text-emerald-900"
                }`}
              >
                {provenance.label}
              </p>
            ) : null}
            {provenance ? <p className="text-xs text-charcoal-ink/65">{provenance.detail}</p> : null}
            <p className="mt-1 text-xs text-charcoal-ink/55">Always confirm by testing before transfusing.</p>
          </>
        ) : (
          <p className="mt-1 text-sm text-charcoal-ink/70">Not recorded.</p>
        )}
      </section>

      <Section title="Allergies" tone={severeAllergies.length > 0 ? "danger" : "normal"}>
        {facts.allergies.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">
            None recorded. That is not the same as none — ask if you can.
          </p>
        ) : (
          <ul className="space-y-1">
            {facts.allergies.map((a) => (
              <li key={a.allergen} className="text-sm text-charcoal-ink">
                <span className="font-medium">{a.allergen}</span>
                {a.severity ? <span className="text-charcoal-ink/70"> · {a.severity}</span> : null}
                {a.reaction ? <span className="text-charcoal-ink/70"> · {a.reaction}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Current medicines">
        {facts.medications.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        ) : (
          <ul className="space-y-1">
            {facts.medications.map((m) => (
              <li key={m.drug_name} className="text-sm text-charcoal-ink">
                <span className="font-medium">{m.drug_name}</span>
                {m.dose ? <span className="text-charcoal-ink/70"> · {m.dose}</span> : null}
                {m.frequency ? <span className="text-charcoal-ink/70"> · {m.frequency}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Ongoing conditions">
        {facts.conditions.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        ) : (
          <p className="text-sm text-charcoal-ink">
            {facts.conditions.map((c) => c.replace(/_/g, " ")).join(" · ")}
          </p>
        )}
      </Section>

      <Section title="Emergency contact">
        {facts.emergency_contact?.name ? (
          <p className="text-sm text-charcoal-ink">
            <span className="font-medium">{facts.emergency_contact.name}</span>
            {facts.emergency_contact.relationship ? ` (${facts.emergency_contact.relationship})` : ""}
            {facts.emergency_contact.phone ? (
              <>
                {" · "}
                <a href={`tel:${facts.emergency_contact.phone}`} className="font-medium text-brand-green underline">
                  {facts.emergency_contact.phone}
                </a>
              </>
            ) : null}
          </p>
        ) : (
          <p className="text-sm text-charcoal-ink/70">None recorded.</p>
        )}
      </Section>

      {qrSlot ? (
        <section className="border-x border-t border-charcoal-ink/15 bg-white p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">
            Scan for a machine-readable copy
          </h2>
          <div className="mt-2">{qrSlot}</div>
        </section>
      ) : null}

      <footer className="rounded-b-lg border-x border-b border-charcoal-ink/15 bg-charcoal-ink/[0.03] p-4 text-xs text-charcoal-ink/60 print:rounded-none">
        {footer}
      </footer>
    </main>
  );
}

function formatDob(dob: string | null): string {
  if (!dob) return "Not recorded";
  const date = new Date(dob);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  const age = Math.floor((Date.now() - date.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return `${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} (age ${age})`;
}

function Section({
  title,
  children,
  tone = "normal",
}: {
  title: string;
  children: React.ReactNode;
  tone?: "normal" | "danger";
}) {
  return (
    <section className={`border-x border-t border-charcoal-ink/15 p-4 ${tone === "danger" ? "bg-red-50" : "bg-white"}`}>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/60">{title}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

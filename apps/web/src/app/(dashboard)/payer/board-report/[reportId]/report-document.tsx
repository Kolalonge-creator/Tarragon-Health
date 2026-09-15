import {
  DOMAIN_LABEL,
  STATUS_LABEL,
  formatDateTime,
  formatHashForPrint,
  formatNaira,
  formatPeriod,
  type BoardMeasure,
  type BoardReportRow,
} from "@/lib/payer/board-report";

/**
 * The document. Everything rendered below comes from the frozen snapshot; this
 * component computes nothing.
 *
 * Two rules it holds that a normal dashboard does not:
 *
 *   1. A withheld measure renders as a withheld measure — the reason, in place
 *      of the number. It never falls back to a dash, a zero, or an empty cell,
 *      all of which a reader would fill in with an assumption.
 *   2. Attribution is null-gated (CLAUDE.md / CLINICAL_TRUST_MODEL_SPEC §2).
 *      An unattested report says, in its own attestation block, that nobody has
 *      signed it. It does not quietly omit the section and read as finished.
 */
export function ReportDocument({ report, verifyUrl }: { report: BoardReportRow; verifyUrl: string }) {
  const s = report.snapshot;
  const isDraft = report.status === "draft";
  const outcomes = s.measures.filter((m) => m.domain === "clinical_outcome");
  const others = s.measures.filter((m) => m.domain !== "clinical_outcome");
  const reportableCount = s.measures.filter((m) => m.reportable).length;

  return (
    <article className="relative mx-auto max-w-4xl bg-white px-6 py-8 text-charcoal-ink print:max-w-none print:px-0 print:py-0">
      {/* A draft that leaves this screen must carry the fact on its face. */}
      {isDraft && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center overflow-hidden"
        >
          <span className="-rotate-[30deg] select-none text-[7rem] font-bold tracking-widest text-red-600/10 print:text-red-600/20">
            DRAFT
          </span>
        </div>
      )}

      <header className="border-b-2 border-deep-forest pb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-heading text-lg font-semibold text-deep-forest">TarragonHealth</p>
            <h1 className="mt-1 font-heading text-2xl font-semibold">Outcomes report</h1>
            <p className="mt-1 text-base">{s.report.insurer_name}</p>
            <p className="text-sm text-charcoal-ink/70">
              Reporting period: {formatPeriod(s.report.period_start, s.report.period_end)}
            </p>
          </div>
          <dl className="text-right text-sm">
            <dt className="text-charcoal-ink/60">Report number</dt>
            <dd className="font-mono font-semibold">{s.report.number}</dd>
            <dt className="mt-2 text-charcoal-ink/60">Status</dt>
            <dd className="font-semibold">{STATUS_LABEL[report.status]}</dd>
            <dt className="mt-2 text-charcoal-ink/60">Generated</dt>
            <dd>{formatDateTime(s.report.generated_at)}</dd>
          </dl>
        </div>
      </header>

      {report.status === "withdrawn" && (
        <Callout tone="red" title="This report has been withdrawn">
          {report.withdrawal_reason}
        </Callout>
      )}
      {report.status === "superseded" && (
        <Callout tone="grey" title="A later report covers this same period">
          This copy is genuine, but it is no longer the current statement of this period.
        </Callout>
      )}
      {isDraft && (
        <Callout tone="amber" title="Draft — not yet attested">
          The figures below are final and cannot change, but no Tarragon signatory has yet attested
          to them. This report should not be presented to a board until it has been attested.
        </Callout>
      )}

      {/* ---------------------------------------------------------------- */}
      <Section n={1} title="Who this report covers">
        <p className="text-sm text-charcoal-ink/75">{s.cohort.definition}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Covered at any point" value={s.cohort.covered_any_time} />
          <Figure label="Covered throughout" value={s.cohort.continuously_covered} emphasis />
          <Figure label="Joined during period" value={s.cohort.joined_during_period} />
          <Figure label="Left during period" value={s.cohort.left_during_period} />
        </div>
        <p className="mt-4 text-sm text-charcoal-ink/70">
          Clinical and care-process measures below are calculated on the {s.cohort.continuously_covered}{" "}
          {s.cohort.continuously_covered === 1 ? "member" : "members"} covered for the whole period.
          No figure is published where fewer than {s.cohort.suppression_floor} members had the data a
          measure needs.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        n={2}
        title="Clinical outcomes"
        subtitle={`${reportableCount} of ${s.measures.length} measures across this report have enough data to publish.`}
      >
        {outcomes.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No clinical outcome measure is in force.</p>
        ) : (
          <div className="space-y-4">
            {outcomes.map((m) => (
              <MeasureBlock key={m.code} measure={m} />
            ))}
          </div>
        )}
      </Section>

      <Section n={3} title="Care process and service">
        <div className="space-y-4">
          {others.map((m) => (
            <MeasureBlock key={m.code} measure={m} />
          ))}
        </div>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={4} title="Claims reconciliation">
        {!s.financial.reportable ? (
          <Withheld reason={s.financial.not_reportable_reason} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Figure label="Claims submitted" value={s.financial.claims_submitted} />
              <Figure label="Paid" value={s.financial.claims_paid} />
              <Figure label="Denied" value={s.financial.claims_denied} />
              <Figure label="Still open" value={s.financial.claims_open} />
            </div>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Figure label="Total billed" text={formatNaira(s.financial.billed_kobo)} />
              <Figure label="Covered by insurer" text={formatNaira(s.financial.insurer_covered_kobo)} />
              <Figure label="Member co-payment" text={formatNaira(s.financial.member_copay_kobo)} />
            </div>
          </>
        )}
        <p className="mt-4 text-sm text-charcoal-ink/70">
          These are claims actually transacted in the period. No saving, avoided admission or return
          on investment is projected from them anywhere in this report.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={5} title="What this report does not show">
        <ul className="space-y-2 text-sm text-charcoal-ink/80">
          {s.limitations.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span aria-hidden className="text-charcoal-ink/40">
                —
              </span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={6} title="How these figures were produced">
        <dl className="space-y-2 text-sm">
          <Row label="Computed at">
            {formatDateTime(s.lineage.computed_at)} ({s.lineage.timezone})
          </Row>
          <Row label="Calculation engine version">{s.lineage.engine_version}</Row>
          <Row label="Measure definitions in force on">
            {s.lineage.measure_definitions_in_force_on}
          </Row>
          <Row label="Prepared by">{s.report.generated_by_name ?? "Not recorded"}</Row>
          <Row label="Source records">{s.lineage.source_tables.join(", ")}</Row>
        </dl>
        <p className="mt-3 text-sm text-charcoal-ink/70">{s.lineage.note}</p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section n={7} title="Attestation">
        {report.attested_at ? (
          <div className="rounded-lg border border-deep-forest/30 bg-soft-sage/40 p-4">
            <p className="text-sm italic">&ldquo;{report.attestation_statement}&rdquo;</p>
            <p className="mt-3 text-sm font-semibold">{report.attester_role_title}</p>
            <p className="text-sm text-charcoal-ink/70">
              TarragonHealth · attested {formatDateTime(report.attested_at)}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Not attested.</p>
            <p className="mt-1 text-sm text-amber-900/80">
              No TarragonHealth signatory has yet attested to these figures. Until one has, this
              document is a draft and should not be presented as a final statement of the period.
            </p>
          </div>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <footer className="mt-8 border-t border-charcoal-ink/20 pt-4 text-sm">
        <p className="font-semibold">Verifying this document</p>
        <p className="mt-1 text-charcoal-ink/75">
          Anyone holding this report can confirm it is genuine, and check whether it is still
          current, at <span className="font-medium">{verifyUrl}</span> — no account needed. They will
          need both the report number and the verification code below. No figure from this report is
          disclosed by that check.
        </p>
        <dl className="mt-3 space-y-1">
          <Row label="Report number">
            <span className="font-mono">{s.report.number}</span>
          </Row>
          <Row label="Verification code">
            <span className="break-all font-mono text-xs">
              {formatHashForPrint(report.content_hash)}
            </span>
          </Row>
        </dl>
        <p className="mt-3 text-xs text-charcoal-ink/60">
          The verification code is a SHA-256 fingerprint of the figures in this document. Changing a
          single character of any number above would produce a different code, and this document
          would no longer verify.
        </p>
      </footer>
    </article>
  );
}

/* -------------------------------------------------------------------------- */

function MeasureBlock({ measure: m }: { measure: BoardMeasure }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-charcoal-ink/15 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-base font-semibold">{m.title}</h3>
          <p className="text-xs uppercase tracking-wide text-charcoal-ink/50">
            {DOMAIN_LABEL[m.domain]} · definition v{m.spec_version}
          </p>
        </div>
        {m.reportable && m.rate_pct !== null ? (
          <div className="text-right">
            <p className="font-heading text-3xl font-semibold text-deep-forest">{m.rate_pct}%</p>
            <p className="text-xs text-charcoal-ink/60">
              {m.numerator} of {m.measurable} measured
            </p>
          </div>
        ) : null}
      </div>

      {!m.reportable ? (
        <div className="mt-3">
          <Withheld reason={m.not_reportable_reason ?? "Withheld."} />
        </div>
      ) : (
        <>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Figure label="Eligible" value={m.denominator} small />
            <Figure label="Had the data" value={m.measurable} small />
            <Figure label="Met the measure" value={m.numerator} small />
            <Figure
              label="Not measurable"
              value={m.unmeasurable}
              small
              tone={m.unmeasurable && m.unmeasurable > 0 ? "amber" : undefined}
            />
          </dl>
          {m.data_completeness_pct !== null && (
            <p className="mt-3 text-sm text-charcoal-ink/75">
              <span className="font-medium">Data completeness: {m.data_completeness_pct}%</span> —
              the rate above is calculated on the {m.measurable} of {m.denominator} eligible members
              who had the necessary data.
              {m.unmeasurable && m.unmeasurable > 0 && m.unmeasurable_reason
                ? ` The other ${m.unmeasurable} are excluded from the rate, not counted as failures. ${m.unmeasurable_reason}`
                : ""}
            </p>
          )}
        </>
      )}

      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-charcoal-ink/70 print:hidden">
          How this measure is defined
        </summary>
        <dl className="mt-2 space-y-2 border-l-2 border-charcoal-ink/15 pl-3 print:border-0 print:pl-0">
          <Row label="Why it matters">{m.definitions.rationale}</Row>
          <Row label="Counted as met">{m.definitions.numerator}</Row>
          <Row label="Measured against">{m.definitions.denominator}</Row>
          <Row label="Excluded">{m.definitions.exclusions}</Row>
          <Row label="What it cannot tell you">{m.definitions.limitations}</Row>
        </dl>
      </details>
    </div>
  );
}

function Withheld({ reason }: { reason: string }) {
  return (
    <p className="rounded border border-charcoal-ink/20 bg-warm-ivory px-3 py-2 text-sm text-charcoal-ink/80">
      <span className="font-semibold">Not reported.</span> {reason}
    </p>
  );
}

function Figure({
  label,
  value,
  text,
  emphasis,
  small,
  tone,
}: {
  label: string;
  value?: number | null;
  text?: string;
  emphasis?: boolean;
  small?: boolean;
  tone?: "amber";
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-charcoal-ink/55">{label}</dt>
      <dd
        className={[
          "font-heading font-semibold",
          small ? "text-lg" : "text-2xl",
          emphasis ? "text-deep-forest" : "",
          tone === "amber" ? "text-amber-700" : "",
        ].join(" ")}
      >
        {text ?? (value === null || value === undefined ? "—" : value.toLocaleString("en-GB"))}
      </dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="sm:flex sm:gap-3">
      <dt className="shrink-0 text-charcoal-ink/60 sm:w-56">{label}</dt>
      <dd className="text-charcoal-ink/90">{children}</dd>
    </div>
  );
}

function Section({
  n,
  title,
  subtitle,
  children,
}: {
  n: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 break-inside-avoid">
      <h2 className="font-heading text-lg font-semibold text-deep-forest">
        {n}. {title}
      </h2>
      {subtitle && <p className="mt-0.5 text-sm text-charcoal-ink/60">{subtitle}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Callout({
  tone,
  title,
  children,
}: {
  tone: "red" | "amber" | "grey";
  title: string;
  children: React.ReactNode;
}) {
  const tones = {
    red: "border-red-300 bg-red-50 text-red-900",
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    grey: "border-slate-300 bg-slate-50 text-slate-800",
  } as const;
  return (
    <div className={`mt-4 rounded-lg border p-4 ${tones[tone]}`}>
      <p className="text-sm font-semibold">{title}</p>
      <p className="mt-1 text-sm">{children}</p>
    </div>
  );
}

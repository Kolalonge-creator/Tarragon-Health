import type { ConditionProtocol } from "@/lib/queries/chronic-programmes";

/**
 * Renders a WHO-based condition protocol's five domains — prevention,
 * monitoring, investigations, escalation (red flags), and follow-up. Shared by
 * the admin conditions console and clinician reference surfaces.
 *
 * The protocol columns are jsonb (Json type), so every field is coerced through
 * the small guards below rather than trusted to a shape. This is *reference*
 * content: it is never rendered as "reviewed by Dr X" — the signed protocol
 * version (protocol_versions) is the attributable governance record, this is the
 * human-readable clinical guidance behind it.
 */

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function Domain({ label, items }: { label: string; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">{label}</p>
      <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal-ink/80">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export function ConditionProtocolView({ protocol }: { protocol: ConditionProtocol }) {
  const monitoring = asRecord(protocol.monitoring);
  const investigations = asRecord(protocol.investigations);
  const escalation = asRecord(protocol.escalation);

  const monitoringTargets = asStringList(monitoring.targets);
  const monitoringCadence = asString(monitoring.cadence);
  const baseline = asStringList(investigations.baseline);
  const ongoing = asStringList(investigations.ongoing);
  const redFlags = asStringList(escalation.red_flags);
  const sla = asString(escalation.sla);

  return (
    <div className="space-y-4">
      <p className="text-sm text-charcoal-ink/80">{protocol.summary}</p>

      <Domain label="Prevention" items={asStringList(protocol.prevention)} />

      {(monitoringTargets.length > 0 || monitoringCadence) && (
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-deep-forest">
            Monitoring
          </p>
          {monitoringTargets.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal-ink/80">
              {monitoringTargets.map((t, i) => (
                <li key={i}>{t}</li>
              ))}
            </ul>
          )}
          {monitoringCadence && (
            <p className="pl-5 text-sm text-charcoal-ink/70">
              <span className="font-medium">Cadence:</span> {monitoringCadence}
            </p>
          )}
        </div>
      )}

      <Domain label="Investigations — baseline" items={baseline} />
      <Domain label="Investigations — ongoing" items={ongoing} />

      {(redFlags.length > 0 || sla) && (
        <div className="space-y-1 rounded-md border border-red-200 bg-red-50/60 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
            Escalation — red flags
          </p>
          {redFlags.length > 0 && (
            <ul className="list-disc space-y-0.5 pl-5 text-sm text-charcoal-ink/80">
              {redFlags.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          {sla && <p className="pl-5 text-sm font-medium text-red-700">{sla}</p>}
        </div>
      )}

      <Domain label="Follow-up" items={asStringList(protocol.follow_up)} />

      <p className="text-xs text-charcoal-ink/50">
        Source: {protocol.source}
        {protocol.source_reference ? ` — ${protocol.source_reference}` : ""}. Reference guidance,
        pending Clinical Director sign-off before activation.
      </p>
    </div>
  );
}

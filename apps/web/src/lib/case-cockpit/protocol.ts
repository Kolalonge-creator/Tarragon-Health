import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@tarragon/shared";

type CarePlanCondition = Database["public"]["Enums"]["care_plan_condition"];

/**
 * Resolving the SIGNED protocol behind a case.
 *
 * Two different things are called "the protocol" in this codebase and
 * conflating them would be a real governance failure, so this module keeps
 * them apart explicitly:
 *
 *   * condition_protocols -- WHO-derived REFERENCE content (targets, red
 *     flags, follow-up cadence). Educational. Nobody signed it. Its own
 *     migration says in capitals that it must not be rendered to a patient as
 *     "your doctor's protocol".
 *
 *   * protocol_versions -- the auditable ledger of what a named Clinical
 *     Director actually SIGNED, immutable, one row per version.
 *
 * A case-review action may only claim protocol backing when a protocol_versions
 * row exists for that condition's slug. Where one does not, this module returns
 * the reference content with `signedVersion: null` and every downstream surface
 * is required to say so plainly rather than imply a sign-off that never
 * happened. That is the same null-gating rule CLAUDE.md applies to
 * "Reviewed by Dr X": the absence of a record must read as absence, never as
 * a silent default.
 *
 * The link between the two is `protocol_versions.protocol_id ==
 * condition_protocols.protocol_slug`. That is not a new convention invented
 * here -- it is exactly the join the activation trigger in
 * 20260716223231_chronic_condition_programmes.sql already enforces.
 */

export interface ProtocolMonitoring {
  targets: string[];
  vitals: string[];
  cadence: string | null;
}

export interface ProtocolEscalation {
  redFlags: string[];
  sla: string | null;
}

export interface ResolvedProtocol {
  condition: CarePlanCondition;
  protocolSlug: string;
  summary: string;
  source: string;
  monitoring: ProtocolMonitoring;
  escalation: ProtocolEscalation;
  investigations: { baseline: string[]; ongoing: string[] };
  followUp: string[];
  /**
   * The signed version, or null when this condition's protocol has never been
   * signed in this organisation. NEVER default this -- a null here means the
   * UI says "no signed protocol for this condition yet", and any action
   * proposed against it carries no protocol_version_id.
   */
  signedVersion: {
    id: string;
    versionNumber: number;
    title: string;
    approvedAt: string;
  } | null;
}

/**
 * jsonb columns arrive as `Json`, which is structurally `unknown`-ish. These
 * readers are deliberately total: seeded reference content is well-formed
 * today, but a malformed row must degrade to an empty section rather than
 * throw inside a clinician's page load. Same best-effort discipline as
 * buildCaseSnapshot.
 */
function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toResolved(
  row: Tables<"condition_protocols">,
  signed: ResolvedProtocol["signedVersion"]
): ResolvedProtocol {
  const monitoring = readObject(row.monitoring);
  const escalation = readObject(row.escalation);
  const investigations = readObject(row.investigations);

  return {
    condition: row.condition,
    protocolSlug: row.protocol_slug,
    summary: row.summary,
    source: row.source,
    monitoring: {
      targets: readStringArray(monitoring.targets),
      vitals: readStringArray(monitoring.vitals),
      cadence: readString(monitoring.cadence),
    },
    escalation: {
      redFlags: readStringArray(escalation.red_flags),
      sla: readString(escalation.sla),
    },
    investigations: {
      baseline: readStringArray(investigations.baseline),
      ongoing: readStringArray(investigations.ongoing),
    },
    followUp: readStringArray(row.follow_up),
    signedVersion: signed,
  };
}

/**
 * The protocols relevant to one case: one per active care-plan condition the
 * patient holds, each carrying its signed version if there is one.
 *
 * Best-effort and never throws -- a case with no resolvable protocol still
 * gets a brief and the condition-agnostic actions. Returns [] rather than
 * null so callers do not have to distinguish "failed" from "none", which they
 * would treat identically anyway.
 */
export async function resolveProtocolsForPatient(
  supabase: SupabaseClient<Database>,
  patientId: string,
  organisationId: string
): Promise<ResolvedProtocol[]> {
  try {
    const { data: carePlans } = await supabase
      .from("care_plans")
      .select("condition")
      .eq("patient_id", patientId)
      .eq("status", "active");

    const conditions = Array.from(new Set((carePlans ?? []).map((plan) => plan.condition)));
    if (conditions.length === 0) return [];

    const { data: protocols } = await supabase
      .from("condition_protocols")
      .select("*")
      .in("condition", conditions);

    if (!protocols || protocols.length === 0) return [];

    // Every signed version for these slugs, newest first. Fetched in one
    // round trip and reduced in memory rather than one query per condition --
    // the cockpit's whole value is that it loads fast enough to be the first
    // thing a doctor opens.
    const { data: signedVersions } = await supabase
      .from("protocol_versions")
      .select("id, protocol_id, version_number, title, approved_at")
      .eq("organisation_id", organisationId)
      .in(
        "protocol_id",
        protocols.map((protocol) => protocol.protocol_slug)
      )
      .order("version_number", { ascending: false });

    const latestBySlug = new Map<string, NonNullable<ResolvedProtocol["signedVersion"]>>();
    for (const version of signedVersions ?? []) {
      // Ordered version_number DESC, so the first sighting of a slug is its
      // current version. Later (older) rows are history and skipped.
      if (!latestBySlug.has(version.protocol_id)) {
        latestBySlug.set(version.protocol_id, {
          id: version.id,
          versionNumber: version.version_number,
          title: version.title,
          approvedAt: version.approved_at,
        });
      }
    }

    return protocols.map((protocol) =>
      toResolved(protocol, latestBySlug.get(protocol.protocol_slug) ?? null)
    );
  } catch (error) {
    console.error("case-cockpit: protocol resolution failed, continuing without it", error);
    return [];
  }
}

/**
 * The protocol a case should be worked against when the patient holds several.
 * Prefers a signed protocol over an unsigned one -- a doctor confirming an
 * action should be working from something a Clinical Director put their name
 * to wherever that exists at all. Ties break on condition name so the choice
 * is stable across reloads rather than dependent on row order.
 */
export function primaryProtocol(protocols: ResolvedProtocol[]): ResolvedProtocol | null {
  if (protocols.length === 0) return null;
  const signed = protocols.filter((protocol) => protocol.signedVersion !== null);
  const pool = signed.length > 0 ? signed : protocols;
  return pool.slice().sort((a, b) => a.condition.localeCompare(b.condition))[0];
}

/**
 * Compact, deterministic rendering of the signed protocol for the LLM prompt.
 * Only ever called for a protocol WITH a signed version: grounding a drafted
 * note in unsigned reference content would produce prose that reads as
 * protocol-backed when it is not.
 */
export function formatProtocolForPrompt(protocol: ResolvedProtocol): string {
  const lines: string[] = [
    `Signed protocol: ${protocol.signedVersion?.title ?? protocol.protocolSlug} (version ${
      protocol.signedVersion?.versionNumber ?? "unsigned"
    }), covering ${protocol.condition}.`,
  ];

  if (protocol.monitoring.targets.length > 0) {
    lines.push(`Protocol targets: ${protocol.monitoring.targets.join("; ")}`);
  }
  if (protocol.monitoring.cadence) {
    lines.push(`Protocol review cadence: ${protocol.monitoring.cadence}`);
  }
  if (protocol.escalation.redFlags.length > 0) {
    lines.push(`Protocol red flags: ${protocol.escalation.redFlags.join("; ")}`);
  }
  if (protocol.investigations.ongoing.length > 0) {
    lines.push(`Protocol ongoing investigations: ${protocol.investigations.ongoing.join("; ")}`);
  }

  return lines.join("\n");
}

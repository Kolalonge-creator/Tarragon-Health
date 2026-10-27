import { createClient } from "@/lib/supabase/server";
import {
  diffProtocols,
  parseTriageProtocolConfig,
  runRegression,
  type ChangedProbe,
  type PathwayDiff,
  type TriageProtocolConfig,
} from "@tarragon/symptom-triage-engine";

type Row = { version: number; is_active: boolean; approved_at: string | null; config: unknown };

const stateOf = (r: Row): string => (r.is_active && r.approved_at ? "live and signed" : r.approved_at ? "signed, not live" : "draft, unsigned");

function parseVersion(v: string | undefined): number | null {
  if (!v || !/^[0-9]{1,6}$/.test(v)) return null;
  return Number(v);
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <p className="font-medium text-charcoal-ink">{title}</p>
      <ul className="list-disc pl-5 text-charcoal-ink/80">{items.map((i) => <li key={i}>{i}</li>)}</ul>
    </div>
  );
}

function PathwayBlock({ d }: { d: PathwayDiff }) {
  return (
    <section className="space-y-2 rounded-lg border border-charcoal-ink/10 bg-white p-3 text-sm">
      <h3 className="font-medium text-charcoal-ink">{d.label} ({d.key})</h3>
      <List title="Red flags added" items={d.redFlagsAdded} />
      <List title="Red flags removed" items={d.redFlagsRemoved} />
      <List title="Red flags changed" items={d.redFlagsChanged.map((c) => `${c.key}: ${c.what}`)} />
      <List title="Questions and outcomes added" items={d.nodesAdded} />
      <List title="Questions and outcomes removed" items={d.nodesRemoved} />
      <List title="Questions and outcomes changed" items={d.nodesChanged.map((c) => `${c.key}: ${c.what}`)} />
      <List title="Other" items={d.otherChanges} />
    </section>
  );
}

function ProbeRow({ c }: { c: ChangedProbe }) {
  return (
    <li className={`rounded-lg border p-2 text-sm ${c.loosened ? "border-red-300 bg-red-50" : "border-charcoal-ink/10 bg-white"}`}>
      <p className="font-medium text-charcoal-ink">{c.probe.pathway}: {c.probe.label}{c.loosened ? " (LESS urgent than before)" : ""}</p>
      <p className="text-charcoal-ink/80">Before: {c.before.category}{c.before.firedRedFlags.length ? ` (${c.before.firedRedFlags.join(", ")})` : ""}. After: {c.after.category}{c.after.firedRedFlags.length ? ` (${c.after.firedRedFlags.join(", ")})` : ""}.</p>
    </li>
  );
}

/**
 * S80d (25.2): compare two stored triage protocol versions. Read only: it never signs, activates or edits a version. The regression run replays
 * the same deterministic cases against both and lists every case whose answer changed; a result that became LESS urgent is shown first.
 */
export async function ProtocolCompare({ basePath, from, to }: { basePath: string; from?: string; to?: string }) {
  const supabase = await createClient();
  const { data, error } = await supabase.from("triage_protocols").select("version, is_active, approved_at, config").order("version", { ascending: false });
  if (error || !data) {
    return <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">The versions could not be loaded. This is not an empty list: try again.</p>;
  }
  const rows = data as unknown as Row[];
  const fromV = parseVersion(from);
  const toV = parseVersion(to);
  const rowOf = (v: number | null): Row | undefined => (v === null ? undefined : rows.find((r) => r.version === v));
  const a = rowOf(fromV);
  const b = rowOf(toV);
  let body: React.ReactNode = <p className="text-sm text-charcoal-ink/70">Choose two versions to compare.</p>;

  if (fromV !== null && toV !== null) {
    const ca = a ? parseTriageProtocolConfig(a.config) : null;
    const cb = b ? parseTriageProtocolConfig(b.config) : null;
    if (!a || !b || !ca || !cb) {
      body = <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">One of those versions does not exist or could not be read, so nothing was compared.</p>;
    } else {
      const fa: TriageProtocolConfig = { ...ca, version: a.version };
      const fb: TriageProtocolConfig = { ...cb, version: b.version };
      const diff = diffProtocols(fa, fb);
      const reg = runRegression(fa, fb);
      body = (
        <div className="space-y-5">
          <p className="text-sm text-charcoal-ink/80">Version {a.version} ({stateOf(a)}) compared with version {b.version} ({stateOf(b)}). Nothing here changes either version.</p>
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">Regression run</h2>
            <p className="text-sm text-charcoal-ink/80">{reg.probesRun} deterministic cases replayed against both versions. {reg.changed.length} gave a different answer, {reg.loosened.length} became less urgent.{reg.truncated ? " Some very long question paths were cut off at the safe limit." : ""}</p>
            {reg.bundledFloorDrift.length > 0 && (
              <p role="alert" className="rounded-lg border border-red-300 bg-red-50 p-2 text-sm text-red-900">
                The red flags in version {b.version} no longer match the floor bundled on the phone for: {reg.bundledFloorDrift.join(", ")}. The phone and the signed protocol must be updated together.
              </p>
            )}
            {reg.notReplayed.length > 0 && <p className="text-sm text-charcoal-ink/80">Not replayed (in only one version): {reg.notReplayed.join(", ")}.</p>}
            {reg.changed.length === 0 ? (
              <p className="text-sm text-emerald-800">No replayed case gave a different answer.</p>
            ) : (
              <ul className="space-y-2">
                {[...reg.loosened, ...reg.changed.filter((c) => !c.loosened)].map((c) => <ProbeRow key={c.probe.id} c={c} />)}
              </ul>
            )}
          </section>
          <section className="space-y-2">
            <h2 className="font-heading text-lg font-semibold text-charcoal-ink">What changed</h2>
            {diff.identical ? <p className="text-sm text-charcoal-ink/80">The two versions are identical in every pathway.</p> : null}
            <List title="Pathways added" items={diff.pathwaysAdded} />
            <List title="Pathways removed" items={diff.pathwaysRemoved} />
            {diff.pathways.map((d) => <PathwayBlock key={d.key} d={d} />)}
          </section>
        </div>
      );
    }
  }

  const select = "mt-1 rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm text-charcoal-ink";
  return (
    <div className="space-y-5">
      <form method="get" action={basePath} className="flex flex-wrap items-end gap-3">
        <label className="text-xs text-charcoal-ink">
          From (older)
          <select name="from" defaultValue={from ?? ""} className={`${select} block`}>
            <option value="">Choose</option>
            {rows.map((r) => <option key={r.version} value={r.version}>Version {r.version}, {stateOf(r)}</option>)}
          </select>
        </label>
        <label className="text-xs text-charcoal-ink">
          To (newer)
          <select name="to" defaultValue={to ?? ""} className={`${select} block`}>
            <option value="">Choose</option>
            {rows.map((r) => <option key={r.version} value={r.version}>Version {r.version}, {stateOf(r)}</option>)}
          </select>
        </label>
        <button type="submit" className="rounded-lg bg-brand-green px-3 py-2 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-green">Compare</button>
      </form>
      {body}
    </div>
  );
}

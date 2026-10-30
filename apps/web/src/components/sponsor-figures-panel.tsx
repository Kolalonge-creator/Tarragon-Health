import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { describeMonth, type StaffMonth } from "@/lib/sponsors/staff-figures";
import { loadSponsorFigures } from "@tarragon/staff-core/sponsors/load-figures";
import { describeMethods, loadMethodsDisclosure, type MethodsLoad } from "@tarragon/staff-core/sponsors/methods-disclosure";

function Month({ m }: { m: StaffMonth }) {
  const d = describeMonth(m);
  return (
    <section aria-label={d.title} className="space-y-1 rounded border p-3">
      <h3 className="font-medium">{d.title}</h3>
      {d.heldBack ? <p>{d.heldBack}</p> : <ul className="space-y-1 text-sm">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    </section>
  );
}

/** Methods and funding (GAP-71). Nothing at all while the database has it switched off; a failed read is said, never hidden. */
function Methods({ load }: { load: MethodsLoad }) {
  if (load.state === "off") return null;
  if (load.state === "unavailable") return <p role="alert">The methods and funding notice could not be read. Please refresh.</p>;
  const d = describeMethods(load.methods);
  return (
    <section aria-label={d.title} className="space-y-1 rounded border p-3">
      <h3 className="font-medium">{d.title}</h3>
      <ul className="space-y-1 text-sm">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </section>
  );
}

/**
 * A sponsor's own staff see their programmes and the frozen monthly group figures (S38f). Aggregate only: no member, no list, no name, and a
 * group too small to show is withheld. The figure for a month is written once, so there is nothing to refresh. Each view is audited.
 */
export async function SponsorFiguresPanel({ basePath }: { basePath: string }) {
  const supabase = await createClient();
  const loaded = await loadSponsorFigures((fn, args) => (args ? supabase.rpc(fn, args) : supabase.rpc(fn)));
  if (!loaded.ok) return <p role="alert">Your programmes could not be read. Please refresh, or ask Tarragon to check that your login is set up for a programme.</p>;
  if (loaded.programmes.length === 0) return <p>When Tarragon sets up a programme for {loaded.sponsor}, it will appear here with its sign-up code.</p>;
  const methods = await Promise.all(loaded.programmes.map(({ programme: p }) => loadMethodsDisclosure((fn, args) => supabase.rpc(fn, args), p.id)));
  return (
    <div className="space-y-6">
      <p className="text-sm">Figures about the members who agreed to share, as a group. No one is named or listed. A group smaller than the minimum is not shown, and neither is anything that would reveal it. A figure is written once a month, a few days after the month ends.</p>
      {loaded.programmes.map(({ programme: p, months }, i) => (
        <Card key={p.id}>
          <CardHeader><CardTitle>{p.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{p.status === "active" ? `Open until ${p.valid_to}.` : "Closed."}{p.code ? ` Sign-up code: ${p.code}` : ""}</p>
            {months === null ? <p role="alert">The figures could not be read. Please refresh.</p>
              : months.length === 0 ? <p>No figures yet. The first appears a few days after the month ends.</p>
              : months.map((m) => <Month key={m.period} m={m} />)}
            <Methods load={methods[i] ?? { state: "unavailable" }} />
            {months && months.length > 0 ? (
              <form method="post" action={`${basePath}/${p.id}/export`}>
                <button type="submit" className="min-h-11 rounded border px-4">Download as a file</button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

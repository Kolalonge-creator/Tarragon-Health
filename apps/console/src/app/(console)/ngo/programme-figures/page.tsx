import { getCurrentProfile } from "@tarragon/auth/current-profile";
import { createClient } from "@tarragon/auth/supabase/server";
import { loadSponsorFigures } from "@tarragon/staff-core/sponsors/load-figures";
import { describeMonth, type StaffMonth } from "@tarragon/staff-core/sponsors/staff-figures";
import { Card, CardContent, CardHeader, CardTitle } from "@tarragon/ui/components/card";

export const metadata = { title: "Programme figures" };
export const dynamic = "force-dynamic";

function Month({ m }: { m: StaffMonth }) {
  const d = describeMonth(m);
  return (
    <section aria-label={d.title} className="space-y-1 rounded border p-3">
      <h3 className="font-medium">{d.title}</h3>
      {d.heldBack ? <p>{d.heldBack}</p> : <ul className="space-y-1 text-sm">{d.lines.map((l) => <li key={l}>{l}</li>)}</ul>}
    </section>
  );
}

/**
 * The programmes Tarragon runs for this partner and their frozen monthly group figures (S38f). Aggregate only: no member, no list, no name,
 * and a group too small to show is withheld. The figure for a month is written once, so there is nothing to refresh. Each view is audited.
 * The same figures a partner reads in the phone app.
 */
export default async function ProgrammeFiguresPage() {
  // The figures belong to partner staff. A super admin manages programmes (and reads their figures) under Admin, Sponsors.
  if ((await getCurrentProfile())?.role === "admin") return <p>This page is for partner staff. As a super admin, open Sponsors in the admin area to see programme figures.</p>;
  const supabase = await createClient();
  const loaded = await loadSponsorFigures((fn, args) => (args ? supabase.rpc(fn, args) : supabase.rpc(fn)));
  if (!loaded.ok) return <p role="alert">Your programmes could not be read. Please refresh, or ask Tarragon to check that your login is set up for a programme.</p>;
  if (loaded.programmes.length === 0) return <p>When Tarragon sets up a programme for {loaded.sponsor}, it will appear here with its sign-up code.</p>;
  return (
    <div className="space-y-6">
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-charcoal-ink">Programme figures</h1>
      <p className="text-sm">Figures about the members who agreed to share, as a group. No one is named or listed. A group smaller than the minimum is not shown, and neither is anything that would reveal it. A figure is written once a month, a few days after the month ends.</p>
      {loaded.programmes.map(({ programme: p, months }) => (
        <Card key={p.id}>
          <CardHeader><CardTitle>{p.name}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm">{p.status === "active" ? `Open until ${p.valid_to}.` : "Closed."}{p.code ? ` Sign-up code: ${p.code}` : ""}</p>
            {months === null ? <p role="alert">The figures could not be read. Please refresh.</p>
              : months.length === 0 ? <p>No figures yet. The first appears a few days after the month ends.</p>
              : months.map((m) => <Month key={m.period} m={m} />)}
            {months && months.length > 0 ? (
              <form method="post" action={`/ngo/programme-figures/${p.id}/export`}>
                <button type="submit" className="min-h-11 rounded border px-4">Download as a file</button>
              </form>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

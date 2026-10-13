import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { parseCohortList } from "@/lib/sponsors/report";
import { lagosToday } from "@/lib/format-date";
import { closeCohortAction, createCohortAction } from "./actions";

export const metadata = { title: "Sponsors" };
export const dynamic = "force-dynamic";

const NOTES: Record<string, string> = {
  created: "The programme code was made. Share it with the sponsor to hand to their members.",
  closed: "The programme was closed. Members who joined stay in it; nobody new can join.",
  invalid: "Not saved. Check the name, the dates and the number of places.",
  refused: "Not saved. Only an admin can do this, and the sponsor must be an insurer, employer or NGO.",
};

/**
 * Programme codes for sponsors (S38e, Module 22.6). A sponsor hands the code to the people it covers. Joining shares nothing: group figures
 * reach a sponsor report only for members who also agreed to share. The report for each programme is aggregate only.
 */
export default async function SponsorsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const sp = await searchParams;
  const note = typeof sp.m === "string" ? NOTES[sp.m] : undefined;
  const supabase = await createClient();
  const [{ data: orgs }, { data: cohortsData, error }] = await Promise.all([
    supabase.from("organisations").select("id, name, type").in("type", ["hmo", "corporate", "ngo"]).order("name"),
    supabase.rpc("admin_list_sponsor_cohorts"),
  ]);
  const cohorts = error ? null : parseCohortList(cohortsData);
  const today = lagosToday();

  return (
    <div className="space-y-6">
      <PageHeader title="Sponsors" backTo={{ href: "/admin", label: "Admin" }}
        description="Programme codes for insurers, employers and NGOs. A member who enters a code joins the programme; their results count in the sponsor's group figures only if they also agree to share. Figures are aggregate and small groups are withheld." />
      {note ? <p role="status">{note}</p> : null}
      <Card>
        <CardHeader><CardTitle>New programme code</CardTitle></CardHeader>
        <CardContent>
          {(orgs ?? []).length === 0 ? (
            <p>There is no insurer, employer or NGO organisation yet. Add the sponsor as an organisation first.</p>
          ) : (
            <form action={createCohortAction} className="grid gap-3 sm:max-w-md">
              <label className="space-y-1"><span className="block text-sm">Sponsor</span>
                <select name="sponsor" required className="min-h-11 w-full rounded border px-2">
                  {(orgs ?? []).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select></label>
              <label className="space-y-1"><span className="block text-sm">Programme name (members see it)</span>
                <input name="name" required minLength={3} maxLength={80} className="min-h-11 w-full rounded border px-2" /></label>
              <label className="space-y-1"><span className="block text-sm">Open from</span>
                <input type="date" name="validFrom" required defaultValue={today} className="min-h-11 rounded border px-2" /></label>
              <label className="space-y-1"><span className="block text-sm">Open until</span>
                <input type="date" name="validTo" required className="min-h-11 rounded border px-2" /></label>
              <label className="space-y-1"><span className="block text-sm">Places</span>
                <input type="number" name="maxUses" required min={1} max={100000} defaultValue={100} className="min-h-11 w-32 rounded border px-2" /></label>
              <button type="submit" className="min-h-11 rounded border px-4">Make code</button>
            </form>
          )}
        </CardContent>
      </Card>
      {cohorts === null ? (
        <p role="alert">The list could not be read. Please refresh.</p>
      ) : cohorts.length === 0 ? (
        <p>No programme codes yet.</p>
      ) : (
        <ul className="space-y-3">
          {cohorts.map((c) => (
            <li key={c.id} className="space-y-2 rounded border p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span className="font-mono text-lg tracking-widest">{c.code}</span>
              </div>
              <p className="text-sm">{c.sponsor}. Open {c.valid_from} to {c.valid_to}. {c.uses} of {c.max_uses} places used. {c.status === "closed" ? "Closed." : "Open."}</p>
              <div className="flex flex-wrap gap-3">
                <Link href={`/admin/sponsors/${c.id}`} className="min-h-11 rounded border px-4 py-2">Group figures</Link>
                {c.status === "active" ? (
                  <form action={closeCohortAction}>
                    <input type="hidden" name="cohortId" value={c.id} />
                    <button type="submit" className="min-h-11 rounded border px-4">Close to new members</button>
                  </form>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

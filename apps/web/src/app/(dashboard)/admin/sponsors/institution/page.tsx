import { z } from "zod";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/current-profile";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { callInstitution, notice } from "@/lib/institution/call";
import { nairaFromKobo } from "@/lib/institution/files";
import { linkStatementAction, reviewConfigAction } from "./actions";

export const metadata = { title: "Institution console" };
export const dynamic = "force-dynamic";

const worklist = z.object({
  requests: z.array(z.object({ id: z.string(), sponsor: z.string(), version: z.number(), pathways: z.array(z.string()), item_codes: z.array(z.string()), campaigns: z.number(), rewards_budget_kobo: z.number(), note: z.string().nullable() })),
  statements: z.array(
    z.object({
      id: z.string(),
      sponsor: z.string(),
      period: z.string(),
      total_kobo: z.number(),
      invoice_id: z.string().nullable(),
      invoices: z.array(z.object({ id: z.string(), period_start: z.string(), period_end: z.string(), amount_kobo: z.number(), status: z.string() })),
    }),
  ),
});
const overlap = z.object({
  employer_codes: z.number(),
  programme_codes: z.number(),
  collisions: z.array(z.object({ code: z.string(), employer_org: z.string(), sponsor_org: z.string() })),
  organisations_with_both: z.array(z.object({ organisation_id: z.string(), name: z.string(), live_programme_codes: z.number() })),
});

/** The Tarragon side of the Institution console (S79): review configuration requests, link usage statements to invoices, see code overlap. Admin only. */
export default async function InstitutionConsoleAdminPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") redirect("/admin");
  const m = (await searchParams).m;
  const [list, ov] = await Promise.all([
    callInstitution("admin_institution_console", {}, (d) => { const r = worklist.safeParse(d); return r.success ? r.data : null; }),
    callInstitution("admin_enrolment_code_overlap", {}, (d) => { const r = overlap.safeParse(d); return r.success ? r.data : null; }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader title="Institution console" backTo={{ href: "/admin/sponsors", label: "Sponsors" }} />
      {m && <p role="status" className="text-sm">{m === "reviewed" ? "Saved." : m === "linked" ? "Linked." : "That could not be saved."}</p>}
      {list.state !== "ok" ? <p role="status">{notice(list.state)}</p> : (
        <>
          <Card>
            <CardHeader><CardTitle>Configuration requests waiting</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {list.data.requests.length === 0 && <p>None waiting.</p>}
              {list.data.requests.map((r) => (
                <form key={r.id} action={reviewConfigAction} className="space-y-2 rounded border p-3">
                  <input type="hidden" name="id" value={r.id} />
                  <p><strong>{r.sponsor}</strong> version {r.version}: pathways {r.pathways.join(", ") || "none"}; services {r.item_codes.join(", ") || "none"}; {r.campaigns} campaigns; rewards request {nairaFromKobo(r.rewards_budget_kobo)} (a number only, no balance is held).</p>
                  {r.note && <p>Note: {r.note}</p>}
                  <input name="note" placeholder="Reason (needed to reject)" className="min-h-11 w-full rounded border px-3" />
                  <button name="decision" value="approve" className="min-h-11 rounded border px-4">Approve</button>{" "}
                  <button name="decision" value="reject" className="min-h-11 rounded border px-4">Reject</button>
                </form>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Usage statements and invoices</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              {list.data.statements.length === 0 && <p>No statements yet.</p>}
              {list.data.statements.map((s) => (
                <div key={s.id} className="rounded border p-3">
                  <p>{s.sponsor}, {s.period.slice(0, 7)}: {nairaFromKobo(s.total_kobo)} {s.invoice_id ? "(linked to an invoice)" : "(not linked)"}</p>
                  {!s.invoice_id && s.invoices.length > 0 && (
                    <form action={linkStatementAction} className="mt-2 flex gap-2">
                      <input type="hidden" name="statement" value={s.id} />
                      <select name="invoice" className="min-h-11 rounded border px-2">
                        {s.invoices.map((i) => <option key={i.id} value={i.id}>{i.period_start} to {i.period_end}, {nairaFromKobo(i.amount_kobo)}, {i.status}</option>)}
                      </select>
                      <button type="submit" className="min-h-11 rounded border px-4">Link</button>
                    </form>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
      <Card>
        <CardHeader><CardTitle>Sign-up code overlap (read only)</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {ov.state !== "ok" ? <p>{notice(ov.state)}</p> : (
            <>
              <p>{ov.data.employer_codes} employer codes and {ov.data.programme_codes} open programme codes. The two tables are separate; one entry checks both.</p>
              <p>{ov.data.collisions.length === 0 ? "No code exists in both tables." : `${ov.data.collisions.length} code(s) exist in both tables: ${ov.data.collisions.map((c) => c.code).join(", ")}. Rotate one.`}</p>
              {ov.data.organisations_with_both.map((o) => <p key={o.organisation_id}>{o.name} runs an employer code and {o.live_programme_codes} open programme code(s).</p>)}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

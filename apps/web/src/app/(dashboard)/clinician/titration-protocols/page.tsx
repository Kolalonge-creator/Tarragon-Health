import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentClinicalStaff } from "@/lib/auth/current-profile";
import { canAssignCases } from "@/lib/clinical/doctor-tier";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/page-header";
import { approverLabel, canOfferApprove, protocolRowSchema, statusLabel, summariseDefinition } from "@/lib/protocols/titration-review";
import { ApproveForm } from "./approve-form";
import { ProtocolEditor } from "./protocol-editor";

export const metadata = { title: "Titration protocols" };
export const dynamic = "force-dynamic";

type Result = PromiseLike<{ data: unknown; error: { message: string } | null }>;
type Reader = {
  from(table: string): {
    select(columns: string): {
      order(column: string, o: { ascending: boolean }): Result;
      in(column: string, values: string[]): Result;
    };
  };
};

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-800",
  retired: "bg-slate-100 text-slate-700",
};

export default async function TitrationProtocolsPage({ searchParams }: { searchParams: Promise<{ done?: string; error?: string }> }) {
  const staff = await getCurrentClinicalStaff();
  if (!canAssignCases(staff)) redirect("/clinician");
  const sp = await searchParams;
  const supabase = (await createClient()) as unknown as Reader;

  const res = await supabase.from("protocols").select("id, code, version, status, approved_by, approved_at, note, definition").order("created_at", { ascending: false });
  const parsed = res.error ? null : z.array(protocolRowSchema).safeParse(res.data);
  const rows = parsed?.success ? parsed.data : null;

  const approverIds = rows ? [...new Set(rows.map((r) => r.approved_by).filter((v): v is string => v !== null))] : [];
  const names = new Map<string, string>();
  if (approverIds.length > 0) {
    const staffRes = await supabase.from("clinical_staff").select("profile_id, full_name").in("profile_id", approverIds);
    const staffRows = staffRes.error ? null : z.array(z.object({ profile_id: z.string(), full_name: z.string().nullable() })).safeParse(staffRes.data);
    if (staffRows?.success) for (const s of staffRows.data) if (s.full_name) names.set(s.profile_id, s.full_name);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Titration protocols"
        description="The step tables the dose suggestion tool reads. A step table is only used for real patients after you approve it. You write it, you check it, you approve it. Nothing here is filled in for you."
      />
      {sp.done && <p role="status" className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">{sp.done}</p>}
      {sp.error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-900">{sp.error}</p>}

      <section aria-labelledby="write-h" className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
        <h2 id="write-h" className="font-heading text-base font-semibold text-charcoal-ink">Write or paste a step table</h2>
        <ProtocolEditor />
      </section>

      <section aria-labelledby="list-h" className="space-y-3">
        <h2 id="list-h" className="font-heading text-base font-semibold text-charcoal-ink">All versions</h2>
        {rows === null ? (
          <p role="alert" className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">The protocols could not be loaded just now. Nothing has been changed. Try again in a moment.</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-charcoal-ink/70">No step table has been saved yet.</p>
        ) : (
          rows.map((r) => {
            const summary = summariseDefinition(r.definition);
            const approver = approverLabel(r.status, r.approved_by, r.approved_by ? names.get(r.approved_by) : null);
            return (
              <article key={r.id} className="space-y-2 rounded-xl border border-charcoal-ink/10 bg-white p-4 shadow-sm dark:border-night-ink/15 dark:bg-night-card">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-heading text-base font-semibold text-charcoal-ink"><span className="font-mono text-sm">{r.code}</span> version {r.version}</h3>
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_STYLE[r.status] ?? ""}`}>{statusLabel(r.status)}</span>
                </div>
                {approver && <p className="text-xs text-charcoal-ink/60">Approved by {approver}{r.approved_at ? ` on ${new Date(r.approved_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}` : ""}.</p>}
                {r.note && <p className="text-sm text-charcoal-ink/70">{r.note}</p>}
                {r.status === "draft" && (
                  <>
                    {summary === null ? (
                      <p className="text-sm text-charcoal-ink/70">This definition could not be read in the expected format. Do not approve what you cannot read.</p>
                    ) : (
                      <div className="space-y-2 text-sm">
                        <h4 className="font-medium text-charcoal-ink">Settings</h4>
                        <dl className="grid gap-1">
                          {summary.params.map((f) => (
                            <div key={f.name} className="flex flex-wrap gap-x-2"><dt className="text-charcoal-ink/60">{f.name}:</dt><dd className="text-charcoal-ink">{f.value}</dd></div>
                          ))}
                        </dl>
                        <h4 className="font-medium text-charcoal-ink">Steps</h4>
                        <ol className="grid gap-2">
                          {summary.steps.map((s, i) => (
                            <li key={i} className="rounded-lg border border-charcoal-ink/10 p-3">
                              <p className="font-medium text-charcoal-ink">{s.heading}</p>
                              <dl className="mt-1 grid gap-0.5">
                                {s.fields.map((f) => (
                                  <div key={f.name} className="flex flex-wrap gap-x-2"><dt className="text-charcoal-ink/60">{f.name}:</dt><dd className="text-charcoal-ink">{f.value}</dd></div>
                                ))}
                              </dl>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                    {canOfferApprove(r.status) && summary !== null && <ApproveForm id={r.id} version={r.version} />}
                  </>
                )}
              </article>
            );
          })
        )}
      </section>
    </div>
  );
}

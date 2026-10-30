import { z } from "zod";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { callInstitution, notice } from "@/lib/institution/call";
import { BatchSteps, StageForm } from "./upload-forms";

export const metadata = { title: "Upload an eligibility list" };
export const dynamic = "force-dynamic";

const preview = z.object({
  batch: z.object({ id: z.string(), mode: z.string(), status: z.string(), row_count: z.number(), staged_by_you: z.boolean() }),
  summary: z.object({ insert: z.number(), update: z.number(), end: z.number(), no_change: z.number(), errors: z.number(), end_share_pct: z.number() }),
  rows: z.array(z.object({ row: z.number(), kind: z.string(), status: z.string(), action: z.string(), error: z.string().nullable(), note: z.string().nullable(), contact: z.string().nullable() })),
});
const ACTION_WORDS: Record<string, string> = { insert: "will be added", update: "will be updated", end: "will stop being covered", none: "no change" };

/** Staged eligibility upload (24.1): check, preview, fix, approve, then apply. People who leave stop being covered; their own accounts and records are untouched. */
export default async function UploadPage({ searchParams }: { searchParams: Promise<{ batch?: string }> }) {
  const batch = (await searchParams).batch;
  if (!batch || !/^[0-9a-f-]{36}$/i.test(batch)) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Upload your eligibility list</CardTitle>
          <CardDescription>Add people, remove people, or send the full list. We check it and show you the plan before anything changes.</CardDescription>
        </CardHeader>
        <CardContent>
          <StageForm />
        </CardContent>
      </Card>
    );
  }
  const res = await callInstitution("employer_roster_upload_preview", { p_batch: batch }, (d) => {
    const r = preview.safeParse(d);
    return r.success ? r.data : null;
  });
  if (res.state !== "ok") return <p role="status">{notice(res.state)}</p>;
  const { summary: s, rows, batch: b } = res.data;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>
            {b.mode === "add" ? "Add or update" : b.mode === "remove" ? "Remove" : "Full list"}: {b.row_count} rows ({b.status})
          </CardTitle>
          <CardDescription>
            {s.insert} to add, {s.update} to update, {s.end} to stop being covered ({s.end_share_pct}% of your list), {s.no_change} unchanged, {s.errors} with problems.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {s.errors > 0 && (
            <p className="text-sm">
              Some rows have problems.{" "}
              <Link className="underline" href={`/dashboard/corporate/eligibility/upload/${batch}/report`}>Download the row-by-row error report</Link>, fix the file and upload again.
              {b.mode !== "add" && " A file that removes people can only be applied when every row is correct."}
            </p>
          )}
          {s.end > 0 && <p className="text-sm">People who stop being covered keep their own Tarragon account and everything in their own record. Only your sponsorship ends.</p>}
          <BatchSteps batch={batch} status={b.status} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>What will happen, row by row</CardTitle>
          <CardDescription>Phone numbers and emails are partly hidden. Problems come first.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li key={`${r.kind}-${r.row}`}>
                {r.kind === "absent" ? "Not in file" : `Row ${r.row}`} {r.contact}: {r.status === "error" ? <span className="text-red-600">{r.error}</span> : `${ACTION_WORDS[r.action] ?? r.action}${r.note ? ` (${r.note})` : ""}`}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

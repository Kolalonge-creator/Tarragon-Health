"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { importBrandMapAction, reviewBrandMapAction, saveBrandMapAction, type BrandMapActionState } from "./actions";

export type BrandMapRow = {
  id: string;
  brand_name: string;
  ingredients: string[];
  source_citation: string;
  created_by: string | null;
  reviewer_name: string | null;
  reviewed_at: string | null;
  is_active: boolean;
};

function Result({ state }: { state: BrandMapActionState }) {
  if (!state) return null;
  return state.error ? <p role="alert" className="text-sm text-red-600">{state.error}</p> : <p role="status" className="text-sm text-brand-green">{state.success}</p>;
}

function AddOne() {
  const [state, action, pending] = useActionState<BrandMapActionState, FormData>(saveBrandMapAction, undefined);
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Add one brand</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="brand_name">Brand name</Label>
            <Input id="brand_name" name="brand_name" required maxLength={80} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ingredients">Active ingredients (separate with a semicolon)</Label>
            <Input id="ingredients" name="ingredients" required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="source_citation">Public source (must include an https link, for example the NAFDAC Greenbook entry)</Label>
            <Input id="source_citation" name="source_citation" required maxLength={400} />
          </div>
          <Button type="submit" size="sm" disabled={pending}>{pending ? "Saving…" : "Save as a draft"}</Button>
          <Result state={state} />
        </form>
      </CardContent>
    </Card>
  );
}

function ImportCsv() {
  const [state, action, pending] = useActionState<BrandMapActionState, FormData>(importBrandMapAction, undefined);
  const [text, setText] = useState("");
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">Import a CSV</CardTitle></CardHeader>
      <CardContent>
        <form action={action} className="space-y-3">
          <p className="text-sm text-charcoal-ink/70">
            First line: <code>brand_name,ingredients,source_citation</code>. Separate ingredients with a semicolon. Every row needs a source with an https link.
            If any line has a problem nothing is imported, so you can fix the file and try again.
          </p>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose a CSV file"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setText(await file.text());
            }}
          />
          <textarea
            name="csv"
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={6}
            aria-label="CSV text"
            className="w-full rounded-md border border-mist-grey/60 p-2 font-mono text-xs"
          />
          <Button type="submit" size="sm" disabled={pending || text.trim().length === 0}>{pending ? "Importing…" : "Import as drafts"}</Button>
          <Result state={state} />
        </form>
      </CardContent>
    </Card>
  );
}

function ReviewButtons({ row }: { row: BrandMapRow }) {
  const [state, action, pending] = useActionState<BrandMapActionState, FormData>(
    async (_prev, formData) => reviewBrandMapAction(row.id, formData.get("approve") === "yes"),
    undefined,
  );
  return (
    <form action={action} className="mt-2 flex flex-wrap items-center gap-2">
      {!row.is_active ? (
        <Button type="submit" name="approve" value="yes" size="sm" disabled={pending}>Approve as reviewer</Button>
      ) : (
        <Button type="submit" name="approve" value="no" size="sm" variant="outline" disabled={pending}>Withdraw</Button>
      )}
      <Result state={state} />
    </form>
  );
}

export function BrandMapManager({ rows, canReview, viewerId }: { rows: BrandMapRow[]; canReview: boolean; viewerId: string }) {
  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/70">
        A brand name is used in search and the same-ingredient warning only after a clinician who did not enter it approves it. A row with no source
        or no named reviewer is never used. Editing a row sends it back to review. The list starts empty; this build added none.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <AddOne />
        <ImportCsv />
      </div>
      <div className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-charcoal-ink">All rows ({rows.length})</h2>
        {rows.length === 0 ? <p className="text-sm text-charcoal-ink/70">No rows yet.</p> : null}
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="rounded-md border border-charcoal-ink/15 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{row.brand_name}</span>
                <span>{row.ingredients.join(" and ")}</span>
                {row.is_active ? <Badge variant="green">In use</Badge> : <Badge variant="amber">Waiting for review</Badge>}
              </div>
              <p className="mt-1 break-all text-xs text-charcoal-ink/60">{row.source_citation}</p>
              {row.is_active && row.reviewer_name ? (
                <p className="text-xs text-charcoal-ink/60">Reviewed by {row.reviewer_name}{row.reviewed_at ? ` on ${new Date(row.reviewed_at).toLocaleDateString("en-GB")}` : ""}</p>
              ) : null}
              {canReview && row.created_by !== viewerId ? <ReviewButtons row={row} /> : null}
              {canReview && row.created_by === viewerId && !row.is_active ? (
                <p className="mt-1 text-xs text-charcoal-ink/60">You entered this row, so another clinician must review it.</p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import {
  useHealthEducationAliases,
  useSaveHealthEducationAlias,
  useSetAliasReviewState,
  type HealthEducationAlias,
} from "@/lib/queries/learning-centre";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const STATE_BADGE: Record<string, { label: string; variant: "grey" | "green" | "amber" }> = {
  draft: { label: "Draft, not used by search", variant: "amber" },
  clinician_reviewed: { label: "Reviewed, used by search", variant: "green" },
  retired: { label: "Retired", variant: "grey" },
};

function AliasRow({ alias, canReview }: { alias: HealthEducationAlias; canReview: boolean }) {
  const setState = useSetAliasReviewState();
  const save = useSaveHealthEducationAlias();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(alias.alias);
  const [expands, setExpands] = useState(alias.expands_to);
  const badge = STATE_BADGE[alias.review_state] ?? STATE_BADGE.draft!;
  const err = (setState.error ?? save.error) as Error | null;

  return (
    <li className="space-y-2 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm">
          <span className="font-medium text-charcoal-ink">&quot;{alias.alias}&quot;</span>
          <span className="text-charcoal-ink/60"> also searches for </span>
          <span className="font-medium text-charcoal-ink">{alias.expands_to}</span>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={badge.variant}>{badge.label}</Badge>
          {canReview && alias.review_state !== "clinician_reviewed" && (
            <Button size="sm" disabled={setState.isPending} onClick={() => setState.mutate({ id: alias.id, state: "clinician_reviewed" })}>
              Mark reviewed
            </Button>
          )}
          {alias.review_state !== "retired" && (
            <Button size="sm" variant="ghost" disabled={setState.isPending} onClick={() => setState.mutate({ id: alias.id, state: "retired" })}>
              Retire
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
            {editing ? "Close" : "Edit"}
          </Button>
        </div>
      </div>
      {editing && (
        <form
          className="grid grid-cols-1 gap-2 rounded-md bg-charcoal-ink/5 p-3 sm:grid-cols-2"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate({ id: alias.id, alias: text, expandsTo: expands }, { onSuccess: () => setEditing(false) });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor={`a-${alias.id}`}>Everyday word or phrase</Label>
            <Input id={`a-${alias.id}`} value={text} onChange={(e) => setText(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor={`e-${alias.id}`}>Also search for</Label>
            <Input id={`e-${alias.id}`} value={expands} onChange={(e) => setExpands(e.target.value)} required />
          </div>
          <p className="text-xs text-charcoal-ink/60 sm:col-span-2">Editing a reviewed term sends it back to draft until the CMO reviews it again.</p>
          <Button type="submit" size="sm" disabled={save.isPending}>
            Save
          </Button>
        </form>
      )}
      {err && <p className="text-xs text-red-600">{err.message}</p>}
    </li>
  );
}

/**
 * The everyday-terms list behind library search (S55, 9.3). An admin or the CMO can add and edit; only the Chief Medical
 * Officer can mark a term reviewed, and search ignores a term until then. No model is involved.
 */
export function AliasManager({ canReview }: { canReview: boolean }) {
  const { data, isLoading, isError } = useHealthEducationAliases();
  const save = useSaveHealthEducationAlias();
  const [alias, setAlias] = useState("");
  const [expands, setExpands] = useState("");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Learning search terms</CardTitle>
        <CardDescription>
          Everyday words people type (BP, sugar, high blood) and the plain terms they should also find. Only reviewed terms are used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            save.mutate({ alias, expandsTo: expands }, { onSuccess: () => { setAlias(""); setExpands(""); } });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="new-alias">Everyday word or phrase</Label>
            <Input id="new-alias" value={alias} onChange={(e) => setAlias(e.target.value)} required />
          </div>
          <div className="space-y-1">
            <Label htmlFor="new-expands">Also search for</Label>
            <Input id="new-expands" value={expands} onChange={(e) => setExpands(e.target.value)} required />
          </div>
          <Button type="submit" size="sm" className="self-end" disabled={save.isPending}>
            Add as draft
          </Button>
        </form>
        {save.isError && <p className="text-xs text-red-600">{(save.error as Error).message}</p>}
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load the search terms.</p>}
        {data && (
          <ul className="divide-y divide-charcoal-ink/10">
            {data.map((a) => (
              <AliasRow key={a.id} alias={a} canReview={canReview} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

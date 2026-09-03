"use client";

import { useActionState, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { editContentBlockAction, signContentBlockAction, type ContentActionState } from "./actions";

export type ContentBlockRow = {
  id: string;
  key: string;
  title: string;
  body_md: string;
  condition: string | null;
  module: string | null;
  reading_level: string | null;
  clinician_reviewed: boolean;
  reviewed_at: string | null;
};

function humanize(value: string): string {
  return value
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function SignButton({ blockId }: { blockId: string }) {
  const [state, action, pending] = useActionState<ContentActionState, FormData>(
    () => signContentBlockAction(blockId),
    undefined
  );
  return (
    <form action={action} className="space-y-1">
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Signing…" : "Sign & approve"}
      </Button>
      {state?.error && <p className="text-xs text-red-600">{state.error}</p>}
      {state?.success && <p className="text-xs text-brand-green">Approved.</p>}
    </form>
  );
}

function ContentBlockCard({ block }: { block: ContentBlockRow }) {
  const [open, setOpen] = useState(false);
  const [editState, editAction, editPending] = useActionState<ContentActionState, FormData>(
    editContentBlockAction,
    undefined
  );

  return (
    <Card>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setOpen((v) => !v)}
      >
        <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {block.title}
          {block.clinician_reviewed ? (
            <Badge variant="green">Approved</Badge>
          ) : (
            <Badge variant="grey">Draft</Badge>
          )}
          {block.reading_level && <Badge variant="blue">{block.reading_level}</Badge>}
        </CardTitle>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          {block.clinician_reviewed && (
            <p className="text-xs text-charcoal-ink/50">
              Approved{block.reviewed_at ? ` on ${new Date(block.reviewed_at).toLocaleDateString("en-GB")}` : ""}
              . Editing below will revert this to draft and it will need re-approval.
            </p>
          )}
          <form action={editAction} className="space-y-2">
            <input type="hidden" name="blockId" value={block.id} />
            <div className="space-y-1">
              <Label htmlFor={`title_${block.id}`} className="text-xs">
                Title
              </Label>
              <Input id={`title_${block.id}`} name="title" defaultValue={block.title} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={`body_${block.id}`} className="text-xs">
                Body
              </Label>
              <Textarea id={`body_${block.id}`} name="bodyMd" defaultValue={block.body_md} rows={4} />
            </div>
            <Button type="submit" size="sm" variant="outline" disabled={editPending}>
              {editPending ? "Saving…" : "Save changes"}
            </Button>
            {editState?.error && <p className="text-xs text-red-600">{editState.error}</p>}
            {editState?.success && <p className="text-xs text-brand-green">Saved.</p>}
          </form>
          {!block.clinician_reviewed && <SignButton blockId={block.id} />}
        </CardContent>
      )}
    </Card>
  );
}

export function ContentLibraryManager({ blocks }: { blocks: ContentBlockRow[] }) {
  if (blocks.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">No content blocks found.</p>;
  }

  const groups = new Map<string, ContentBlockRow[]>();
  for (const block of blocks) {
    const key = block.condition ? humanize(block.condition) : block.module ? humanize(block.module) : "General";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(block);
  }

  const reviewedCount = blocks.filter((b) => b.clinician_reviewed).length;

  return (
    <div className="space-y-6">
      <p className="text-sm text-charcoal-ink/70">
        {reviewedCount} of {blocks.length} approved.
      </p>
      {[...groups.entries()].map(([groupLabel, groupBlocks]) => (
        <div key={groupLabel} className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-charcoal-ink/50">
            {groupLabel} ({groupBlocks.length})
          </h2>
          <div className="space-y-2">
            {groupBlocks.map((block) => (
              <ContentBlockCard key={block.id} block={block} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

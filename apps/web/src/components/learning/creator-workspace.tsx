"use client";

import { useState, type FormEvent } from "react";
import {
  useApplyAsCreator,
  useMyCreator,
  useCreatorMyContent,
  useCreatorSubmitContent,
  type CreatorSubmission,
} from "@/lib/queries/learning-centre";
import { HEALTH_EDUCATION_CATEGORIES } from "@/lib/queries/health-education";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  clinical_review: "In clinical review",
  approved: "Approved, waiting to publish",
  published: "Live for Members",
  review_due: "Live, review due",
  updated: "Updated, needs re-review",
};

function emptySubmission(): CreatorSubmission {
  return {
    code: "cr_",
    title: "",
    summary: "",
    body: "",
    category: "getting_started",
    contentType: "article",
    estimatedMinutes: 4,
    sourceReference: "",
    nextAction: "",
    nextStepKind: "booking",
    nextStepTargetCode: null,
  };
}

function SubmitForm() {
  const submit = useCreatorSubmitContent();
  const [form, setForm] = useState<CreatorSubmission>(emptySubmission());
  const set = <K extends keyof CreatorSubmission>(k: K, v: CreatorSubmission[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <form
      className="space-y-3"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        submit.mutate(form, { onSuccess: () => setForm(emptySubmission()) });
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="cr-code">Code (cr_ then letters, digits, underscores)</Label>
          <Input id="cr-code" className="font-mono text-xs" value={form.code} onChange={(e) => set("code", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cr-title">Title</Label>
          <Input id="cr-title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cr-category">Category</Label>
          <Select id="cr-category" value={form.category} onChange={(e) => set("category", e.target.value as CreatorSubmission["category"])}>
            {HEALTH_EDUCATION_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="cr-minutes">Minutes to read (1 to 60)</Label>
          <Input id="cr-minutes" type="number" min={1} max={60} value={form.estimatedMinutes} onChange={(e) => set("estimatedMinutes", Number(e.target.value))} required />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cr-sources">Sources (one per line)</Label>
          <Textarea id="cr-sources" rows={2} value={form.sourceReference} onChange={(e) => set("sourceReference", e.target.value)} required />
        </div>
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="cr-next">What can the reader do next?</Label>
          <Input id="cr-next" value={form.nextAction} maxLength={400} onChange={(e) => set("nextAction", e.target.value)} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="cr-kind">Next step goes to</Label>
          <Select id="cr-kind" value={form.nextStepKind} onChange={(e) => set("nextStepKind", e.target.value as CreatorSubmission["nextStepKind"])}>
            <option value="care_plan_goal">A care plan goal</option>
            <option value="booking">A booking</option>
            <option value="lesson">Another lesson</option>
          </Select>
        </div>
        {form.nextStepKind === "lesson" && (
          <div className="space-y-1">
            <Label htmlFor="cr-target">Code of that lesson</Label>
            <Input id="cr-target" className="font-mono text-xs" value={form.nextStepTargetCode ?? ""} onChange={(e) => set("nextStepTargetCode", e.target.value || null)} required />
          </div>
        )}
      </div>
      <div className="space-y-1">
        <Label htmlFor="cr-summary">Summary</Label>
        <Input id="cr-summary" value={form.summary} onChange={(e) => set("summary", e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="cr-body">Body</Label>
        <Textarea id="cr-body" rows={8} value={form.body} onChange={(e) => set("body", e.target.value)} required />
      </div>
      <Button type="submit" size="sm" disabled={submit.isPending}>
        {submit.isPending ? "Sending…" : "Send for clinical review"}
      </Button>
      {submit.isSuccess && <p className="text-xs text-brand-green">Sent. A reviewer will check it before anyone sees it.</p>}
      {submit.isError && <p className="text-xs text-red-600">{(submit.error as Error).message}</p>}
    </form>
  );
}

/** A verified clinician's own creator area (S55, 9.7): apply, then submit pieces into the existing clinical review. */
export function CreatorWorkspace({ staffId }: { staffId: string }) {
  const { data: me = null } = useMyCreator(staffId);
  const apply = useApplyAsCreator();
  const { data: content } = useCreatorMyContent();
  const [bio, setBio] = useState("");

  return (
    <div className="space-y-6">
      {!me && (
        <Card>
          <CardHeader>
            <CardTitle>Write for the Learning Centre</CardTitle>
            <CardDescription>
              Verified clinicians can write short series for Members. Every piece is reviewed by another clinician before it is
              published, and your name appears as the author. There is no payment attached.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="cr-bio">A line about your practice (shown on your pieces)</Label>
              <Input id="cr-bio" value={bio} maxLength={600} onChange={(e) => setBio(e.target.value)} />
            </div>
            <Button size="sm" disabled={apply.isPending} onClick={() => apply.mutate(bio)}>
              Apply
            </Button>
            {apply.isError && <p className="text-xs text-red-600">{(apply.error as Error).message}</p>}
          </CardContent>
        </Card>
      )}
      {me && me.status === "pending" && (
        <Card>
          <CardContent className="py-4 text-sm">Your application is waiting for approval.</CardContent>
        </Card>
      )}
      {me && me.status === "suspended" && (
        <Card>
          <CardContent className="py-4 text-sm">Your creator access is paused. Contact the clinical team.</CardContent>
        </Card>
      )}
      {me && me.status === "approved" && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>New piece</CardTitle>
              <CardDescription>It goes straight into clinical review. Nothing reaches patients until a different verified clinician has reviewed it.</CardDescription>
            </CardHeader>
            <CardContent>
              <SubmitForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Your pieces</CardTitle>
            </CardHeader>
            <CardContent>
              {content && content.length === 0 && <p className="text-sm text-charcoal-ink/60">Nothing sent yet.</p>}
              <ul className="divide-y divide-charcoal-ink/10">
                {(content ?? []).map((c) => (
                  <li key={c.content_id} className="flex items-center justify-between gap-3 py-2">
                    <span className="text-sm">{c.title}</span>
                    <Badge variant="grey">{STATUS_LABEL[c.content_status] ?? c.content_status}</Badge>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

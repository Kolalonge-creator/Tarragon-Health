"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { IDENTITY_CHECKS, RECOVERY_METHODS } from "./schemas";
import {
  approveRecovery,
  confirmSimSwapReview,
  executeRecovery,
  rejectRecovery,
  requestRecovery,
  searchRecoverySubjects,
} from "./actions";

export type RecoveryRow = {
  id: string;
  createdAt: string;
  state: string;
  method: string;
  simSwapRisk: boolean;
  simSwapReviewed: boolean;
  requestedBy: string;
  expiresAt: string;
  reason: string;
  checksDone: string[];
  subjectName: string;
  phoneHint: string;
  emailHint: string | null;
  outcome: string | null;
};

type Subject = { id: string; fullName: string; patientNumber: string | null; phoneMasked: string };

const METHOD_LABEL: Record<(typeof RECOVERY_METHODS)[number], string> = {
  email_link_to_verified_email: "Email a recovery link to the address on file",
  new_phone_reverification: "Set a new phone number (the owner must verify it with a code)",
};

export function RecoveryConsole({ rows, currentUserId }: { rows: RecoveryRow[]; currentUserId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searchReason, setSearchReason] = useState("");
  const [results, setResults] = useState<Subject[]>([]);
  const [subject, setSubject] = useState<Subject | null>(null);
  const [reason, setReason] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [method, setMethod] = useState<(typeof RECOVERY_METHODS)[number]>("email_link_to_verified_email");

  function run(fn: () => Promise<{ ok: boolean; error?: string; next?: string }>, after?: () => void) {
    setMessage(null);
    start(async () => {
      const res = await fn();
      setMessage(res.ok ? (res.next ?? "Done.") : (res.error ?? "Something went wrong."));
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {message && <p role="status" className="rounded-md bg-charcoal-ink/[0.04] p-3 text-sm">{message}</p>}

      <Card>
        <CardHeader><CardTitle>1. Find the person</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor="rq">Name, phone or patient number</Label>
              <Input id="rq" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="rr">Why you are searching (logged)</Label>
              <Input id="rr" value={searchReason} onChange={(e) => setSearchReason(e.target.value)} />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            disabled={pending || query.trim().length < 2 || searchReason.trim().length < 10}
            onClick={() =>
              run(async () => {
                const res = await searchRecoverySubjects({ query, reason: searchReason });
                if (res.ok) setResults(res.results);
                return res.ok ? { ok: true, next: `${res.results.length} found.` } : res;
              })
            }
          >
            Search
          </Button>
          <ul className="divide-y">
            {results.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span>{r.fullName} <span className="text-charcoal-ink/50">{r.patientNumber ?? ""} {r.phoneMasked}</span></span>
                <Button type="button" size="sm" variant="outline" onClick={() => setSubject(r)}>Start recovery</Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {subject && (
        <Card>
          <CardHeader><CardTitle>2. Record the checks for {subject.fullName}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-xs text-charcoal-ink/60">Tick only checks you actually completed, at least two. Do not type or upload ID details anywhere; only which checks you did is kept.</p>
            {IDENTITY_CHECKS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={!!checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                {c.label}
              </label>
            ))}
            <div>
              <Label htmlFor="rm">Method</Label>
              <select id="rm" className="mt-1 w-full rounded-md border p-2 text-sm" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
                {RECOVERY_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </div>
            <div>
              <Label htmlFor="rw">Reason (at least 20 characters, no health details)</Label>
              <Textarea id="rw" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
            </div>
            <Button
              type="button"
              size="sm"
              disabled={pending || reason.trim().length < 20 || Object.values(checks).filter(Boolean).length < 2}
              onClick={() =>
                run(
                  async () => {
                    const res = await requestRecovery({ subjectId: subject.id, reason, identityChecks: checks, method });
                    return res.ok
                      ? { ok: true, next: res.simSwapRisk ? "Request sent. Their phone was changed in the last 72 hours, so a different admin must complete an extra review before approving." : "Request sent. A different admin must approve it." }
                      : res;
                  },
                  () => { setSubject(null); setReason(""); setChecks({}); },
                )
              }
            >
              Send for approval
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Requests</CardTitle></CardHeader>
        <CardContent>
          {rows.length === 0 && <p className="text-sm text-charcoal-ink/60">No requests yet.</p>}
          <ul className="divide-y">
            {rows.map((r) => (
              <RequestRow key={r.id} r={r} mine={r.requestedBy === currentUserId} pending={pending} run={run} />
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function RequestRow({ r, mine, pending, run }: {
  r: RecoveryRow; mine: boolean; pending: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string; next?: string }>) => void;
}) {
  const [note, setNote] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const open = r.state === "requested" || r.state === "approved";
  return (
    <li className="space-y-2 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{r.subjectName}</span>
        <span className="text-charcoal-ink/50">{r.phoneHint}{r.emailHint ? ` · ${r.emailHint}` : ""}</span>
        <Badge>{r.state}</Badge>
        {r.simSwapRisk && <Badge>Phone changed recently</Badge>}
        {mine && <span className="text-xs text-charcoal-ink/50">You asked for this</span>}
      </div>
      <p className="text-xs text-charcoal-ink/60">{r.reason} (checks: {r.checksDone.join(", ")}; expires {new Date(r.expiresAt).toLocaleString()})</p>
      {open && !mine && (
        <div className="space-y-2">
          {r.state === "requested" && r.simSwapRisk && !r.simSwapReviewed && (
            <div className="space-y-1">
              <Label htmlFor={`n-${r.id}`} className="text-xs">Extra review: what did you check to confirm the phone change was the owner&apos;s?</Label>
              <Textarea id={`n-${r.id}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
              <Button type="button" size="sm" disabled={pending || note.trim().length < 20} onClick={() => run(() => confirmSimSwapReview({ requestId: r.id, note }))}>Record extra review</Button>
            </div>
          )}
          {r.state === "requested" && (
            <Button type="button" size="sm" disabled={pending || (r.simSwapRisk && !r.simSwapReviewed)} onClick={() => run(() => approveRecovery({ requestId: r.id }))}>Approve</Button>
          )}{" "}
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => rejectRecovery({ requestId: r.id, reason: note.trim().length >= 10 ? note : "Identity checks not sufficient" }))}>Reject</Button>
        </div>
      )}
      {r.state === "approved" && (
        <div className="space-y-2">
          {r.method === "new_phone_reverification" && (
            <div>
              <Label htmlFor={`p-${r.id}`} className="text-xs">New phone number (international format)</Label>
              <Input id={`p-${r.id}`} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="+2348012345678" />
            </div>
          )}
          <Button type="button" size="sm" disabled={pending} onClick={() => run(() => executeRecovery({ requestId: r.id, newPhone: newPhone || undefined }))}>Run recovery step</Button>
        </div>
      )}
      {r.state === "executed" && <p className="text-xs">Outcome: {r.outcome ?? "not recorded"}</p>}
    </li>
  );
}

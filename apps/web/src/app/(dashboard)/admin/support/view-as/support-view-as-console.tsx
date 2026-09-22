"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useSupportViewAsSubjectSearch,
  useStartSupportViewSession,
  useEndSupportViewSession,
  useMySupportViewSessions,
  type SupportViewSubject,
} from "@/lib/queries/support-view-as";

const REASON_MIN_LENGTH = 3;

function isSessionActive(session: { ended_at: string | null; expires_at: string }): boolean {
  return !session.ended_at && new Date(session.expires_at).getTime() > Date.now();
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short" });
}

function SubjectRow({ subject }: { subject: SupportViewSubject }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [reason, setReason] = useState("");
  const startSession = useStartSupportViewSession();

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-charcoal-ink">{subject.full_name ?? "Unnamed"}</p>
          <p className="text-xs text-charcoal-ink/50">
            {subject.role === "patient" ? "Patient" : "Clinician"}
            {subject.phone ? ` · ${subject.phone}` : ""}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Cancel" : "View as this person"}
        </Button>
      </div>
      {expanded && (
        <div className="mt-3 space-y-2 rounded-md bg-charcoal-ink/[0.03] p-3">
          <Label htmlFor={`reason-${subject.id}`} className="text-xs">
            Reason (required — never write clinical detail or PHI here; this text is readable by any
            org-staff account via the audit log, and is shown to {subject.full_name ?? "the subject"} themselves)
          </Label>
          <Textarea
            id={`reason-${subject.id}`}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. patient reports their dashboard shows no vitals after syncing a wearable"
            className="text-sm"
            rows={2}
          />
          <Button
            type="button"
            size="sm"
            disabled={startSession.isPending || reason.trim().length < REASON_MIN_LENGTH}
            onClick={() => {
              startSession.mutate(
                { subjectId: subject.id, subjectRole: subject.role, reason: reason.trim() },
                { onSuccess: (session) => router.push(`/admin/support/view-as/${session.id}`) }
              );
            }}
          >
            {startSession.isPending ? "Starting…" : "Start 30-minute session"}
          </Button>
          {startSession.isError && (
            <p className="text-xs text-red-600">{(startSession.error as Error).message}</p>
          )}
        </div>
      )}
    </li>
  );
}

function SessionsList() {
  const router = useRouter();
  const { data: sessions, isLoading } = useMySupportViewSessions();
  const endSession = useEndSupportViewSession();

  if (isLoading) return <p className="text-sm text-charcoal-ink/60">Loading…</p>;
  if (!sessions || sessions.length === 0) {
    return <p className="text-sm text-charcoal-ink/60">You haven&apos;t started a view-as session yet.</p>;
  }

  return (
    <ul className="divide-y divide-charcoal-ink/10">
      {sessions.map((s) => {
        const active = isSessionActive(s);
        return (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div>
              <p className="text-sm text-charcoal-ink">
                {s.subject_full_name ?? "Unnamed subject"}
                <span className="ml-2">
                  <Badge variant={active ? "green" : "grey"}>{active ? "Active" : "Ended"}</Badge>
                </span>
              </p>
              <p className="text-xs text-charcoal-ink/50">
                Started {timeAgo(s.started_at)}
                {s.reason ? ` · "${s.reason}"` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/admin/support/view-as/${s.id}`)}>
                {active ? "Resume" : "Session details"}
              </Button>
              {active && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={endSession.isPending}
                  onClick={() => endSession.mutate(s.id)}
                >
                  End now
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function SupportViewAsConsole() {
  const [query, setQuery] = useState("");
  const { data: results, isLoading, isError } = useSupportViewAsSubjectSearch(query);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Find a patient or clinician</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, phone, or patient number…"
            className="max-w-md"
          />
          {query.trim().length > 0 && query.trim().length < 2 && (
            <p className="text-xs text-charcoal-ink/50">Keep typing — at least 2 characters.</p>
          )}
          {isLoading && <p className="text-sm text-charcoal-ink/60">Searching…</p>}
          {isError && <p className="text-sm text-red-600">Search failed. Try again.</p>}
          {results && results.length === 0 && query.trim().length >= 2 && (
            <p className="text-sm text-charcoal-ink/60">No match for &ldquo;{query}&rdquo;.</p>
          )}
          {results && results.length > 0 && (
            <ul className="divide-y divide-charcoal-ink/10">
              {results.map((r) => (
                <SubjectRow key={r.id} subject={r} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionsList />
        </CardContent>
      </Card>
    </div>
  );
}

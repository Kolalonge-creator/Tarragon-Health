"use client";

import Link from "next/link";
import { useSupportThreads } from "@/lib/queries/support-messages";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

function formatDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export default function SupportInboxPage() {
  const { data: threads, isLoading, isError } = useSupportThreads();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">
          Support inbox
        </h1>
        <p className="text-charcoal-ink/60">
          Inbound WhatsApp messages, human-routed — no bot, no automation. Read like a helpdesk
          ticket and reply from here.
        </p>
      </div>

      {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
      {isError && <p className="text-sm text-red-600">Could not load the support inbox.</p>}

      {threads && threads.length === 0 && (
        <p className="text-sm text-charcoal-ink/60">No support messages yet.</p>
      )}

      {threads && threads.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Conversations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-charcoal-ink/10">
              {threads.map((thread) => (
                <li key={thread.patient_id}>
                  <Link
                    href={`/clinician/support-inbox/${thread.patient_id}`}
                    className="flex items-center justify-between gap-4 py-3 hover:bg-charcoal-ink/[0.02]"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-charcoal-ink">
                        {thread.patient?.full_name ?? "Unknown patient"}
                      </p>
                      <p className="truncate text-xs text-charcoal-ink/60">{thread.body}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {thread.status === "unread" && <Badge variant="amber">Unread</Badge>}
                      <span className="text-xs text-charcoal-ink/50">
                        {formatDate(thread.created_at)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

"use client";

import { useCommunicationHistory, type CommunicationHistoryRow } from "@/lib/queries/notifications";
import { describe as describeNotification } from "@/components/shell/notification-bell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { NAV_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

import { formatPatientDateTime } from "@/lib/format-date";
const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  push: "App notification",
  in_app: "In app",
  voice: "Phone call",
};

function deliveryStatus(row: CommunicationHistoryRow): { label: string; tone: "muted" | "ok" | "warn" } {
  if (row.responded_at) return { label: "You responded", tone: "ok" };
  if (row.opened_at) return { label: "Opened", tone: "ok" };
  if (row.delivered_at) return { label: "Delivered", tone: "ok" };
  if (row.status === "failed") return { label: "Not delivered", tone: "warn" };
  if (row.sent_at) return { label: "Sent", tone: "muted" };
  return { label: "Pending", tone: "muted" };
}

function formatDate(iso: string): string {
  return formatPatientDateTime(iso, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Health Communication Engine — communication history (17.8): "Patient and
 * authorised clinicians should see relevant communication history." This is
 * the patient's own view — every notification ever sent to them, across
 * every channel, with sender/purpose/channel/timestamp/delivery status
 * always visible (17.16's acceptance criteria) and response where one was
 * captured. Reuses notification-bell.tsx's describe() for the same purpose
 * copy the bell already shows, rather than a second, drifting mapping.
 */
export function CommunicationHistoryCard() {
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useCommunicationHistory();
  const rows: CommunicationHistoryRow[] = data?.pages.flatMap((p) => p.rows) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.bell className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Communication history
        </CardTitle>
        <CardDescription>
          Every reminder, confirmation, and alert we&apos;ve sent you, and whether it reached you.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 && !isLoading ? (
          <p className="py-6 text-center text-sm text-charcoal-ink/50">Nothing sent yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {rows.map((row) => {
              const { text } = describeNotification(row);
              const status = deliveryStatus(row);
              return (
                <li key={row.id} className="flex flex-col gap-1 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-charcoal-ink">{text}</p>
                    <p className="mt-0.5 text-xs text-charcoal-ink/50">
                      {formatDate(row.created_at)} · {CHANNEL_LABEL[row.channel] ?? row.channel.replace(/_/g, " ")}
                      {row.priority === "critical" ? " · Critical" : ""}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-medium",
                      status.tone === "ok" && "bg-brand-green/10 text-brand-green",
                      status.tone === "warn" && "bg-red-50 text-red-600",
                      status.tone === "muted" && "bg-charcoal-ink/5 text-charcoal-ink/60",
                    )}
                  >
                    {status.label}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {hasNextPage && (
          <div className="mt-3 flex justify-center">
            <Button type="button" variant="outline" size="sm" disabled={isFetchingNextPage} onClick={() => fetchNextPage()}>
              {isFetchingNextPage ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

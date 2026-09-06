"use client";

import { useState } from "react";
import { useDeviceDiagnosis } from "@/lib/queries/device-diagnosis";
import { useStartThread } from "@/lib/queries/care-messages";
import {
  formatConnectionDiagnosis,
  formatDeviceDiagnosis,
  buildDiagnosisMessage,
} from "@/lib/device-diagnosis-format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NAV_ICON } from "@/lib/icons";

/**
 * Spec 55.12 — patient tech-support auto-diagnosis. "My device isn't
 * syncing" runs a read-only check across every wearable connection and
 * paired Bluetooth device (device-diagnosis.ts), shows each one's status,
 * last successful transmission and error code in plain language, and lets
 * the patient send that summary straight to the care team instead of typing
 * it out themselves — the whole point being to reduce unnecessary support
 * back-and-forth.
 */
export function DeviceSyncSupportCard({ patientId }: { patientId: string }) {
  const [checked, setChecked] = useState(false);
  const [composing, setComposing] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sent, setSent] = useState(false);

  const diagnosis = useDeviceDiagnosis(patientId, checked);
  const startThread = useStartThread();

  const result = diagnosis.data;
  const hasAnyDevice = !!result && (result.connections.length > 0 || result.devices.length > 0);

  const openComposer = () => {
    if (!result) return;
    const draft = buildDiagnosisMessage(result);
    setSubject(draft.subject);
    setBody(draft.body);
    setComposing(true);
    setSent(false);
  };

  const send = () => {
    startThread.mutate(
      { subject, body },
      {
        onSuccess: () => {
          setComposing(false);
          setSent(true);
        },
      }
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <NAV_ICON.warning className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} aria-hidden />
          My device isn&apos;t syncing
        </CardTitle>
        <CardDescription>
          Check every device and wearable connected to your account: status, last successful
          sync, and any error, all in one place.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!checked && <Button onClick={() => setChecked(true)}>Check my devices</Button>}

        {checked && diagnosis.isLoading && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Checking…</p>
        )}
        {checked && diagnosis.isError && (
          <p className="text-sm text-red-600 dark:text-red-300">
            Couldn&apos;t run the check just now. Try again in a moment.
          </p>
        )}

        {checked && result && !hasAnyDevice && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            You don&apos;t have any wearables or Bluetooth devices connected to your account yet.
            That&apos;s likely why nothing is syncing. Connect a wearable above, or pair a device
            from the Tarragon mobile app.
          </p>
        )}

        {checked && result && hasAnyDevice && (
          <ul className="space-y-2">
            {result.connections.map((c) => {
              const item = formatConnectionDiagnosis(c);
              return (
                <li key={item.id} className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{item.name}</span>
                    <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{item.summary}</p>
                </li>
              );
            })}
            {result.devices.map((d) => {
              const item = formatDeviceDiagnosis(d);
              return (
                <li key={item.id} className="rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-charcoal-ink dark:text-night-ink">{item.name}</span>
                    <Badge variant={item.badgeVariant}>{item.badgeLabel}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{item.summary}</p>
                </li>
              );
            })}
          </ul>
        )}

        {checked && result && !composing && (
          <Button variant="outline" onClick={openComposer}>
            Message the care team about this
          </Button>
        )}

        {sent && (
          <p className="text-sm text-brand-green dark:text-brand-green-bright">
            Sent. This summary is now in your Messages, ready for your care team to see.
          </p>
        )}

        {composing && (
          <div className="space-y-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-4">
            <div className="grid gap-2">
              <Label htmlFor="sync-support-subject">Subject</Label>
              <Input
                id="sync-support-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={150}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sync-support-body">Message</Label>
              <Textarea
                id="sync-support-body"
                rows={7}
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={4000}
              />
            </div>
            <div className="flex items-center gap-3">
              <Button
                disabled={
                  startThread.isPending || subject.trim().length < 3 || body.trim().length === 0
                }
                onClick={send}
              >
                {startThread.isPending ? "Sending…" : "Send to care team"}
              </Button>
              <Button variant="ghost" onClick={() => setComposing(false)}>
                Cancel
              </Button>
              {startThread.isError && (
                <span className="text-sm text-red-600 dark:text-red-300">
                  {startThread.error instanceof Error ? startThread.error.message : "Couldn't send"}
                </span>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

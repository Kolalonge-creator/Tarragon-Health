"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog, ConfirmDialogFacts } from "@/components/ui/confirm-dialog";
import type { PlatformModuleRow } from "@/lib/platform-modules";
import { setPlatformModuleAction } from "./actions";

export function PlatformModulesManager({ modules }: { modules: PlatformModuleRow[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<{ module: PlatformModuleRow; enabled: boolean } | null>(
    null
  );
  const router = useRouter();

  function toggle(key: string, enabled: boolean) {
    const formData = new FormData();
    formData.set("key", key);
    formData.set("enabled", String(enabled));
    // The note now travels in both directions. set_platform_module only
    // *requires* one to switch a module on (deactivating in a hurry must
    // never be blocked by paperwork), but it stores whatever it is given, so
    // "why was the live payer platform switched off" stops being unanswerable.
    formData.set("note", notes[key] ?? "");
    startTransition(async () => {
      const result = await setPlatformModuleAction(undefined, formData);
      setFeedback(result ?? null);
      if (!result?.error) setNotes((prev) => ({ ...prev, [key]: "" }));
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {feedback?.error && (
        <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>
      )}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}
      {modules.map((m) => (
        <Card key={m.key}>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {m.label}
                  <Badge variant={m.is_enabled ? "green" : "grey"}>
                    {m.is_enabled ? "Active" : "Dormant"}
                  </Badge>
                </CardTitle>
                <CardDescription>{m.description}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {m.is_enabled ? (
              <>
                {m.activation_note && (
                  <p className="text-sm text-charcoal-ink/70">
                    Activated {m.enabled_at ? new Date(m.enabled_at).toLocaleString() : ""}:{" "}
                    {m.activation_note}
                  </p>
                )}
                {/* Switching a live module off is as consequential as switching
                    it on: every counterparty using it loses access at once.
                    Asking why, and confirming, matches the activation side. */}
                <Textarea
                  aria-label={`Why ${m.label} is being deactivated`}
                  placeholder="Why now (e.g. contract ended with Reliance HMO, or a live incident)"
                  value={notes[m.key] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [m.key]: e.target.value }))}
                  rows={2}
                />
                <Button
                  variant="outline"
                  disabled={pending || !(notes[m.key] ?? "").trim()}
                  onClick={() => setConfirming({ module: m, enabled: false })}
                >
                  Deactivate
                </Button>
              </>
            ) : (
              <>
                <Textarea
                  aria-label={`Why ${m.label} is being activated`}
                  placeholder="Why now (e.g. signed contract with Reliance HMO, go-live 2026-09-01)"
                  value={notes[m.key] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [m.key]: e.target.value }))}
                  rows={2}
                />
                <Button
                  disabled={pending || !(notes[m.key] ?? "").trim()}
                  onClick={() => setConfirming({ module: m, enabled: true })}
                >
                  Activate
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ))}

      <ConfirmDialog
        open={confirming !== null}
        title={
          confirming?.enabled
            ? "Activate this platform module?"
            : "Deactivate this live platform module?"
        }
        description={
          confirming?.enabled
            ? "Its tables start returning rows and its write RPCs start accepting writes for every counterparty on it. Confirm a signed counterparty actually exists first."
            : "Everyone using it loses access the moment this lands: its tables return zero rows under RLS and its write RPCs refuse. Work in progress on it stops."
        }
        confirmLabel={confirming?.enabled ? "Activate module" : "Deactivate module"}
        cancelLabel="Cancel"
        destructive={!confirming?.enabled}
        onConfirm={() => {
          const target = confirming;
          setConfirming(null);
          if (target) toggle(target.module.key, target.enabled);
        }}
        onCancel={() => setConfirming(null)}
      >
        <ConfirmDialogFacts
          rows={[
            { label: "Module", value: confirming?.module.label ?? "" },
            {
              label: "Going from",
              value: confirming?.enabled ? "Dormant to Active" : "Active to Dormant",
            },
            { label: "Reason recorded", value: confirming ? (notes[confirming.module.key] ?? "") : "" },
          ]}
        />
      </ConfirmDialog>
    </div>
  );
}

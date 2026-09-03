"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { PlatformModuleRow } from "@/lib/platform-modules";
import { setPlatformModuleAction } from "./actions";

export function PlatformModulesManager({ modules }: { modules: PlatformModuleRow[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function toggle(key: string, enabled: boolean) {
    const formData = new FormData();
    formData.set("key", key);
    formData.set("enabled", String(enabled));
    if (enabled) formData.set("note", notes[key] ?? "");
    startTransition(async () => {
      const result = await setPlatformModuleAction(undefined, formData);
      setFeedback(result ?? null);
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
                <Button
                  variant="outline"
                  disabled={pending}
                  onClick={() => toggle(m.key, false)}
                >
                  Deactivate
                </Button>
              </>
            ) : (
              <>
                <Textarea
                  placeholder="Why now (e.g. signed contract with Reliance HMO, go-live 2026-09-01)"
                  value={notes[m.key] ?? ""}
                  onChange={(e) => setNotes((prev) => ({ ...prev, [m.key]: e.target.value }))}
                  rows={2}
                />
                <Button
                  disabled={pending || !(notes[m.key] ?? "").trim()}
                  onClick={() => toggle(m.key, true)}
                >
                  Activate
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

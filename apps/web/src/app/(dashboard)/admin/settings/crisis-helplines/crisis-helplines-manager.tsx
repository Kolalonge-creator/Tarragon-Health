"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export interface HelplineRow {
  id: string;
  name: string;
  phone_e164: string | null;
  hours_text: string | null;
  source_note: string;
  is_active: boolean;
  last_verified_at: string | null;
  verification_note: string | null;
}

function HelplineCard({ row, reverifyDays }: { row: HelplineRow; reverifyDays: number }) {
  const router = useRouter();
  const [phone, setPhone] = useState(row.phone_e164 ?? "");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  const verified = row.last_verified_at !== null;
  const stale = verified && now - Date.parse(row.last_verified_at as string) > reverifyDays * 86_400_000;

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true);
    setError(null);
    const { error: err } = await fn();
    setBusy(false);
    if (err) setError(err.message);
    else {
      setNote("");
      router.refresh();
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {row.name}
          {!verified ? <Badge variant="amber">Not verified</Badge> : stale ? <Badge variant="amber">Verification is old</Badge> : <Badge variant="green">Verified</Badge>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-charcoal-ink/70 dark:text-night-ink/70">{row.source_note}</p>
        {verified && (
          <p>
            Verified {new Date(row.last_verified_at as string).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos" })}: {row.verification_note}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-xs">Number (international format, for example +234...)</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="block w-full rounded-md border border-charcoal-ink/20 bg-transparent px-2 py-1.5" />
          </label>
          <label className="space-y-1">
            <span className="text-xs">How you verified it (who answered, when)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} className="block w-full rounded-md border border-charcoal-ink/20 bg-transparent px-2 py-1.5" />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            onClick={() => run(() => createClient().rpc("verify_crisis_helpline", { p_id: row.id, p_phone_e164: phone.trim(), p_note: note }))}
          >
            {verified ? "Verify again" : "Mark verified"}
          </Button>
          {verified && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => run(() => createClient().rpc("unverify_crisis_helpline", { p_id: row.id, p_note: note || "No longer answering, removed from the card" }))}
            >
              Remove from the card
            </Button>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </CardContent>
    </Card>
  );
}

export function CrisisHelplinesManager({ rows, config }: { rows: HelplineRow[]; config: { version: number; status: string; config: Record<string, unknown> } | null }) {
  const reverifyDays = typeof config?.config.helpline_reverify_days === "number" ? config.config.helpline_reverify_days : 180;
  return (
    <div className="space-y-4">
      <Card variant="soft">
        <CardContent className="space-y-1 py-4 text-sm">
          <p>
            Card settings, version {config?.version ?? "none"}, status <strong>{config?.status ?? "missing"}</strong>. A line verified more than {reverifyDays} days ago drops back to
            unverified on its own.
          </p>
          {config?.status !== "confirmed" && (
            <p className="text-charcoal-ink/70 dark:text-night-ink/70">
              These settings are a draft the clinical lead has not confirmed. Because of that, the card does not tell a patient how fast the care team will call back.
            </p>
          )}
        </CardContent>
      </Card>
      {rows.map((r) => (
        <HelplineCard key={r.id} row={r} reverifyDays={reverifyDays} />
      ))}
    </div>
  );
}

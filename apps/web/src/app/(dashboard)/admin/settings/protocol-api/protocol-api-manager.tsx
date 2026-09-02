"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createProtocolPartnerAction,
  issueProtocolApiKeyAction,
  listProtocolApiKeysAction,
  revokeProtocolApiKeyAction,
  setProtocolApiLicenseAction,
} from "./actions";

type LicenseTier = "up_to_10k" | "up_to_50k" | "unlimited";

const TIER_LABEL: Record<LicenseTier, string> = {
  up_to_10k: "Up to 10,000 calls/month",
  up_to_50k: "Up to 50,000 calls/month",
  unlimited: "Unlimited",
};

interface PartnerRow {
  organisation_id: string;
  name: string;
  created_at: string;
  active_key_count: number;
  calls_last_30_days: number;
  last_called_at: string | null;
  tier: string | null;
  monthly_price_kobo: number | null;
  calls_included_per_month: number | null;
  calls_this_month: number;
}

interface KeyRow {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString("en-GB") : "never";
}

function formatNaira(kobo: number): string {
  return `₦${(kobo / 100).toLocaleString()}`;
}

export function ProtocolApiManager({ partners }: { partners: PartnerRow[] }) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate() {
    setMessage(null);
    startTransition(async () => {
      const result = await createProtocolPartnerAction(name);
      if (result.error) setMessage(result.error);
      else setName("");
    });
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add a licensed partner</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[240px] space-y-1">
            <Label htmlFor="partner-name">Organisation name</Label>
            <Input
              id="partner-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kaduna State PHC Board"
            />
          </div>
          <Button onClick={handleCreate} disabled={pending || name.trim().length < 2}>
            {pending ? "Adding…" : "Add partner"}
          </Button>
        </CardContent>
        {message && <p className="px-6 pb-4 text-sm text-red-600">{message}</p>}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Licensed partners ({partners.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {partners.length === 0 && (
            <p className="text-sm text-charcoal-ink/60">No partners added yet.</p>
          )}
          {partners.map((p) => (
            <div key={p.organisation_id} className="rounded-md border border-mist-grey/60 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium text-charcoal-ink">{p.name}</p>
                  <p className="text-xs text-charcoal-ink/50">
                    Added {formatDate(p.created_at)} · {p.active_key_count} active key
                    {p.active_key_count === 1 ? "" : "s"} · {p.calls_last_30_days} calls in the last
                    30 days · last called {formatDate(p.last_called_at)}
                  </p>
                  <p className="text-xs text-charcoal-ink/50">
                    {p.tier ? (
                      <>
                        {TIER_LABEL[p.tier as LicenseTier]} at {formatNaira(p.monthly_price_kobo ?? 0)}/month ·{" "}
                        {p.calls_this_month}
                        {p.calls_included_per_month ? ` / ${p.calls_included_per_month}` : ""} calls this
                        month
                      </>
                    ) : (
                      "No license set — calls are unrestricted"
                    )}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setExpanded(expanded === p.organisation_id ? null : p.organisation_id)}
                >
                  {expanded === p.organisation_id ? "Hide keys" : "Manage keys"}
                </Button>
              </div>
              {expanded === p.organisation_id && (
                <>
                  <PartnerLicense
                    organisationId={p.organisation_id}
                    tier={p.tier as LicenseTier | null}
                    monthlyPriceKobo={p.monthly_price_kobo}
                    callsIncludedPerMonth={p.calls_included_per_month}
                  />
                  <PartnerKeys organisationId={p.organisation_id} organisationName={p.name} />
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function PartnerLicense({
  organisationId,
  tier,
  monthlyPriceKobo,
  callsIncludedPerMonth,
}: {
  organisationId: string;
  tier: LicenseTier | null;
  monthlyPriceKobo: number | null;
  callsIncludedPerMonth: number | null;
}) {
  const [selectedTier, setSelectedTier] = useState<LicenseTier>(tier ?? "up_to_10k");
  const [priceNaira, setPriceNaira] = useState(String((monthlyPriceKobo ?? 0) / 100));
  const [callsCap, setCallsCap] = useState(String(callsIncludedPerMonth ?? ""));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setMessage(null);
    const price = Math.round(Number(priceNaira) * 100);
    if (!Number.isFinite(price) || price < 0) {
      setMessage("Enter a valid monthly price");
      return;
    }
    const cap = selectedTier === "unlimited" ? null : Number(callsCap);
    if (selectedTier !== "unlimited" && (!Number.isFinite(cap) || (cap as number) <= 0)) {
      setMessage("Enter a valid monthly call cap for this tier");
      return;
    }
    startTransition(async () => {
      const result = await setProtocolApiLicenseAction({
        organisationId,
        tier: selectedTier,
        monthlyPriceKobo: price,
        callsIncludedPerMonth: cap,
      });
      if (result.error) setMessage(result.error);
      else setMessage("Saved");
    });
  }

  return (
    <div className="mt-3 space-y-2 border-t border-mist-grey/60 pt-3">
      <p className="text-sm font-medium text-charcoal-ink">Billing tier</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor={`tier-${organisationId}`}>Tier</Label>
          <select
            id={`tier-${organisationId}`}
            value={selectedTier}
            onChange={(e) => setSelectedTier(e.target.value as LicenseTier)}
            className="h-9 rounded-md border border-charcoal-ink/20 bg-white px-2 text-sm"
          >
            {(Object.keys(TIER_LABEL) as LicenseTier[]).map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`price-${organisationId}`}>Monthly price (₦)</Label>
          <Input
            id={`price-${organisationId}`}
            type="number"
            min={0}
            value={priceNaira}
            onChange={(e) => setPriceNaira(e.target.value)}
            className="w-32"
          />
        </div>
        {selectedTier !== "unlimited" && (
          <div className="space-y-1">
            <Label htmlFor={`cap-${organisationId}`}>Calls/month</Label>
            <Input
              id={`cap-${organisationId}`}
              type="number"
              min={1}
              value={callsCap}
              onChange={(e) => setCallsCap(e.target.value)}
              className="w-28"
            />
          </div>
        )}
        <Button size="sm" onClick={handleSave} disabled={pending}>
          {pending ? "Saving…" : "Save tier"}
        </Button>
      </div>
      {message && <p className="text-sm text-charcoal-ink/60">{message}</p>}
    </div>
  );
}

function PartnerKeys({
  organisationId,
  organisationName,
}: {
  organisationId: string;
  organisationName: string;
}) {
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [keyName, setKeyName] = useState("");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(() => {
    startTransition(async () => {
      const result = await listProtocolApiKeysAction(organisationId);
      if ("error" in result) setMessage(result.error);
      else setKeys(result.keys);
    });
  }, [organisationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleIssue() {
    setMessage(null);
    startTransition(async () => {
      const result = await issueProtocolApiKeyAction({
        organisationId,
        name: keyName || `${organisationName} key`,
      });
      if ("error" in result) {
        setMessage(result.error);
      } else {
        setIssuedKey(result.key);
        setKeyName("");
        refresh();
      }
    });
  }

  function handleRevoke(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeProtocolApiKeyAction(id);
      if (result.error) setMessage(result.error);
      else refresh();
    });
  }

  return (
    <div className="mt-3 space-y-3 border-t border-mist-grey/60 pt-3">
      {issuedKey && (
        <div className="space-y-1 rounded-md bg-amber-50 p-3">
          <p className="text-sm font-medium text-charcoal-ink">
            Copy this key now — it won&apos;t be shown again.
          </p>
          <code className="block break-all rounded bg-white p-2 text-xs">{issuedKey}</code>
          <Button size="sm" variant="ghost" onClick={() => setIssuedKey(null)}>
            Done
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px] space-y-1">
          <Label htmlFor={`key-name-${organisationId}`}>New key name</Label>
          <Input
            id={`key-name-${organisationId}`}
            value={keyName}
            onChange={(e) => setKeyName(e.target.value)}
            placeholder="e.g. Primary integration"
          />
        </div>
        <Button size="sm" onClick={handleIssue} disabled={pending}>
          {pending ? "Issuing…" : "Issue key"}
        </Button>
      </div>

      {message && <p className="text-sm text-red-600">{message}</p>}

      <ul className="space-y-2">
        {(keys ?? []).map((k) => (
          <li key={k.id} className="flex items-center justify-between text-sm">
            <span>
              {k.name} — <code className="text-xs">{k.key_prefix}…</code>
              {k.revoked_at ? (
                <Badge variant="grey" className="ml-2">
                  Revoked
                </Badge>
              ) : (
                <span className="ml-2 text-xs text-charcoal-ink/50">
                  last used {formatDate(k.last_used_at)}
                </span>
              )}
            </span>
            {!k.revoked_at && (
              <Button size="sm" variant="ghost" onClick={() => handleRevoke(k.id)} disabled={pending}>
                Revoke
              </Button>
            )}
          </li>
        ))}
        {keys && keys.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">No keys issued yet.</p>
        )}
      </ul>
    </div>
  );
}

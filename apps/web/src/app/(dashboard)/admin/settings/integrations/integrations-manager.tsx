"use client";

import { useState, useTransition } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { API_KEY_SCOPES } from "@/lib/integrations/api-key-scopes";
import {
  createApiKeyAction,
  revokeApiKeyAction,
  savePartnerIntegrationAction,
  setPartnerIntegrationActiveAction,
  testPartnerConnectionAction,
} from "./actions";

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface PartnerRow {
  id: string;
  name: string;
  base_url: string;
  auth_header: string;
  notes: string | null;
  is_active: boolean;
  last_checked_at: string | null;
  last_check_ok: boolean | null;
  has_secret: boolean;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "never";
}

export function IntegrationsManager({
  apiKeys,
  partners,
}: {
  apiKeys: ApiKeyRow[];
  partners: PartnerRow[];
}) {
  return (
    <div className="space-y-6">
      <ApiKeysSection apiKeys={apiKeys} />
      <PartnersSection partners={partners} />
    </div>
  );
}

function ApiKeysSection({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["device_readings:write"]);
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  function handleCreate() {
    setMessage(null);
    startTransition(async () => {
      const result = await createApiKeyAction({ name, scopes });
      if ("error" in result) {
        setMessage(result.error);
      } else {
        setIssuedKey(result.key);
        setName("");
      }
    });
  }

  function handleRevoke(id: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await revokeApiKeyAction(id);
      if (result.error) setMessage(result.error);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound API keys</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/60">
          A partner sends the key as <code>Authorization: Bearer th_live_…</code>. The full key is
          shown once at issue time — only its hash is stored.
        </p>

        {issuedKey && (
          <div className="space-y-2 rounded-lg border border-brand-green/40 bg-brand-green/5 p-4">
            <p className="text-sm font-medium text-deep-forest">
              Copy this key now — it will never be shown again.
            </p>
            <code className="block break-all rounded bg-white p-2 text-xs text-charcoal-ink">
              {issuedKey}
            </code>
            <Button size="sm" variant="outline" onClick={() => setIssuedKey(null)}>
              I&apos;ve copied it
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1 space-y-1">
            <Label htmlFor="key-name">Key name</Label>
            <Input
              id="key-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Omron device cloud"
            />
          </div>
          <div className="space-y-1">
            <Label>Scopes</Label>
            <div className="flex gap-2">
              {API_KEY_SCOPES.map((scope) => (
                <button
                  key={scope}
                  type="button"
                  onClick={() => toggleScope(scope)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    scopes.includes(scope)
                      ? "border-brand-green bg-brand-green/10 text-deep-forest"
                      : "border-charcoal-ink/15 text-charcoal-ink/60"
                  }`}
                >
                  {scope}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleCreate} disabled={pending || name.trim().length < 2 || scopes.length === 0}>
            Issue key
          </Button>
        </div>
        {message && <p className="text-sm text-red-600">{message}</p>}

        {apiKeys.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No API keys issued yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {apiKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {key.name}{" "}
                    <code className="text-xs text-charcoal-ink/50">{key.key_prefix}…</code>
                  </p>
                  <p className="text-xs text-charcoal-ink/50">
                    {key.scopes.join(", ")} · created {formatDate(key.created_at)} · last used{" "}
                    {formatDate(key.last_used_at)}
                  </p>
                </div>
                {key.revoked_at ? (
                  <Badge variant="grey">Revoked</Badge>
                ) : (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => handleRevoke(key.id)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

const EMPTY_PARTNER = { name: "", base_url: "", auth_header: "Authorization", secret: "", notes: "" };

function PartnersSection({ partners }: { partners: PartnerRow[] }) {
  const [form, setForm] = useState<typeof EMPTY_PARTNER & { id?: string }>(EMPTY_PARTNER);
  const [message, setMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await savePartnerIntegrationAction({
        id: form.id,
        name: form.name,
        base_url: form.base_url,
        auth_header: form.auth_header,
        secret: form.secret || undefined,
        notes: form.notes || undefined,
      });
      if (result.error) {
        setMessage(result.error);
      } else {
        setForm(EMPTY_PARTNER);
      }
    });
  }

  function handleTest(id: string) {
    startTransition(async () => {
      const result = await testPartnerConnectionAction(id);
      setTestResult((prev) => ({ ...prev, [id]: result.detail }));
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outbound partner connections</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/60">
          Register a partner platform&apos;s API so TarragonHealth can call it. The secret is sent
          verbatim in the configured header (for a Bearer API, store <code>Bearer xyz…</code>).
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="p-name">Partner name</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Synlab results API"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-url">Base URL</Label>
            <Input
              id="p-url"
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="https://api.partner.com/v1"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-header">Auth header</Label>
            <Input
              id="p-header"
              value={form.auth_header}
              onChange={(e) => setForm({ ...form, auth_header: e.target.value })}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-secret">
              Secret{form.id ? " (leave blank to keep the stored one)" : ""}
            </Label>
            <Input
              id="p-secret"
              type="password"
              value={form.secret}
              onChange={(e) => setForm({ ...form, secret: e.target.value })}
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="p-notes">Notes (optional)</Label>
            <Textarea
              id="p-notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              rows={2}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSave} disabled={pending || !form.name || !form.base_url}>
            {form.id ? "Save changes" : "Add connection"}
          </Button>
          {form.id && (
            <Button variant="outline" onClick={() => setForm(EMPTY_PARTNER)}>
              Cancel edit
            </Button>
          )}
        </div>
        {message && <p className="text-sm text-red-600">{message}</p>}

        {partners.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No partner connections registered yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {partners.map((partner) => (
              <li key={partner.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-charcoal-ink">
                      {partner.name}{" "}
                      {partner.is_active ? (
                        <Badge variant="green">Active</Badge>
                      ) : (
                        <Badge variant="grey">Inactive</Badge>
                      )}
                    </p>
                    <p className="truncate text-xs text-charcoal-ink/50">
                      {partner.base_url} · {partner.auth_header}
                      {partner.has_secret ? " (secret set)" : " (no secret)"} · last check{" "}
                      {formatDate(partner.last_checked_at)}
                      {partner.last_check_ok === null ? "" : partner.last_check_ok ? " ✓" : " ✗"}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => handleTest(partner.id)}>
                      Test connection
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        setForm({
                          id: partner.id,
                          name: partner.name,
                          base_url: partner.base_url,
                          auth_header: partner.auth_header,
                          secret: "",
                          notes: partner.notes ?? "",
                        })
                      }
                    >
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await setPartnerIntegrationActiveAction(partner.id, !partner.is_active);
                        })
                      }
                    >
                      {partner.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </div>
                {testResult[partner.id] && (
                  <p className="text-xs text-charcoal-ink/60">{testResult[partner.id]}</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

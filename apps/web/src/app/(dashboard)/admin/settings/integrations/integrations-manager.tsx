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
  deleteWebhookEndpointAction,
  revokeApiKeyAction,
  saveWebhookEndpointAction,
  savePartnerIntegrationAction,
  setPartnerIntegrationActiveAction,
  setWebhookEndpointActiveAction,
  testPartnerConnectionAction,
} from "./actions";

const WEBHOOK_EVENT_TYPES = [
  "result.available",
  "result.amended",
  "lab_order.created",
  "lab_order.cancelled",
  "appointment.booked",
  "appointment.cancelled",
  "appointment.rescheduled",
  "prescription.created",
  "prescription.cancelled",
  "dispense.completed",
  "patient.registered",
  "patient.consent_changed",
  "payment.settled",
  "payment.refunded",
  "claim.status_changed",
] as const;

interface ApiKeyRow {
  id: string;
  name: string;
  key_prefix: string;
  scopes: string[];
  environment: "sandbox" | "live";
  rate_limit_per_minute: number;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  expires_at: string | null;
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

interface WebhookEndpointRow {
  id: string;
  partner_integration_id: string;
  name: string;
  url: string;
  event_types: string[];
  environment: "sandbox" | "live";
  is_active: boolean;
  last_success_at: string | null;
  last_failure_at: string | null;
  consecutive_failures: number;
  created_at: string;
}

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleString() : "never";
}

export function IntegrationsManager({
  apiKeys,
  partners,
  webhookEndpoints,
}: {
  apiKeys: ApiKeyRow[];
  partners: PartnerRow[];
  webhookEndpoints: WebhookEndpointRow[];
}) {
  return (
    <div className="space-y-6">
      <ApiKeysSection apiKeys={apiKeys} />
      <PartnersSection partners={partners} />
      <WebhookEndpointsSection partners={partners} webhookEndpoints={webhookEndpoints} />
    </div>
  );
}

function ApiKeysSection({ apiKeys }: { apiKeys: ApiKeyRow[] }) {
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["device_readings:write"]);
  const [environment, setEnvironment] = useState<"sandbox" | "live">("live");
  const [issuedKey, setIssuedKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleScope(scope: string) {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  }

  function handleCreate() {
    setMessage(null);
    startTransition(async () => {
      const result = await createApiKeyAction({ name, scopes, environment });
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
          shown once at issue time; only its hash is stored.
        </p>

        {issuedKey && (
          <div className="space-y-2 rounded-lg border border-brand-green/40 bg-brand-green/5 p-4">
            <p className="text-sm font-medium text-deep-forest">
              Copy this key now; it will never be shown again.
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
          <div className="space-y-1">
            <Label>Environment</Label>
            <div className="flex gap-2">
              {(["live", "sandbox"] as const).map((env) => (
                <button
                  key={env}
                  type="button"
                  onClick={() => setEnvironment(env)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    environment === env
                      ? "border-brand-green bg-brand-green/10 text-deep-forest"
                      : "border-charcoal-ink/15 text-charcoal-ink/60"
                  }`}
                >
                  {env}
                </button>
              ))}
            </div>
          </div>
          <Button onClick={handleCreate} disabled={pending || name.trim().length < 2 || scopes.length === 0}>
            Issue key
          </Button>
        </div>
        <p className="text-xs text-charcoal-ink/50">
          A sandbox key (<code>th_test_…</code>) is for §33.17 partner certification before going
          live — use it to test an integration without touching real patient data.
        </p>
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
                    <code className="text-xs text-charcoal-ink/50">{key.key_prefix}…</code>{" "}
                    {key.environment === "sandbox" && <Badge variant="amber">Sandbox</Badge>}
                  </p>
                  <p className="text-xs text-charcoal-ink/50">
                    {key.scopes.join(", ")} · {key.rate_limit_per_minute}/min · created{" "}
                    {formatDate(key.created_at)} · last used {formatDate(key.last_used_at)}
                    {key.expires_at ? ` · expires ${formatDate(key.expires_at)}` : ""}
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
              placeholder="e.g. Partner results API"
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

const EMPTY_WEBHOOK = {
  partnerIntegrationId: "",
  name: "",
  url: "",
  eventTypes: [] as string[],
  environment: "live" as "sandbox" | "live",
  description: "",
};

function WebhookEndpointsSection({
  partners,
  webhookEndpoints,
}: {
  partners: PartnerRow[];
  webhookEndpoints: WebhookEndpointRow[];
}) {
  const [form, setForm] = useState<typeof EMPTY_WEBHOOK & { id?: string }>(EMPTY_WEBHOOK);
  const [issuedSecret, setIssuedSecret] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggleEventType(type: string) {
    setForm((prev) => ({
      ...prev,
      eventTypes: prev.eventTypes.includes(type)
        ? prev.eventTypes.filter((t) => t !== type)
        : [...prev.eventTypes, type],
    }));
  }

  function handleSave() {
    setMessage(null);
    startTransition(async () => {
      const result = await saveWebhookEndpointAction(form);
      if ("error" in result) {
        setMessage(result.error);
      } else {
        if (result.secret) setIssuedSecret(result.secret);
        setForm(EMPTY_WEBHOOK);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhook endpoints</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-charcoal-ink/60">
          A partner receives events (result available, appointment cancelled, prescription
          created — §33.15) as a signed POST. Verify{" "}
          <code>X-Tarragon-Signature: sha256=…</code> against the raw body with the secret below
          before trusting a delivery.
        </p>

        {issuedSecret && (
          <div className="space-y-2 rounded-lg border border-brand-green/40 bg-brand-green/5 p-4">
            <p className="text-sm font-medium text-deep-forest">
              Copy this signing secret now; it will never be shown again.
            </p>
            <code className="block break-all rounded bg-white p-2 text-xs text-charcoal-ink">
              {issuedSecret}
            </code>
            <Button size="sm" variant="outline" onClick={() => setIssuedSecret(null)}>
              I&apos;ve copied it
            </Button>
          </div>
        )}

        {partners.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            Register an outbound partner connection above first — a webhook endpoint belongs to one.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="wh-partner">Partner</Label>
                <select
                  id="wh-partner"
                  value={form.partnerIntegrationId}
                  onChange={(e) => setForm({ ...form, partnerIntegrationId: e.target.value })}
                  className="h-9 w-full rounded-md border border-charcoal-ink/15 bg-white px-3 text-sm"
                >
                  <option value="">Select a partner…</option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="wh-name">Endpoint name</Label>
                <Input
                  id="wh-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Results webhook"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="wh-url">URL</Label>
                <Input
                  id="wh-url"
                  value={form.url}
                  onChange={(e) => setForm({ ...form, url: e.target.value })}
                  placeholder="https://partner.example.com/webhooks/tarragon"
                />
              </div>
              <div className="space-y-1 sm:col-span-2">
                <Label>Event types</Label>
                <div className="flex flex-wrap gap-2">
                  {WEBHOOK_EVENT_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => toggleEventType(type)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        form.eventTypes.includes(type)
                          ? "border-brand-green bg-brand-green/10 text-deep-forest"
                          : "border-charcoal-ink/15 text-charcoal-ink/60"
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>
              <div className="space-y-1">
                <Label>Environment</Label>
                <div className="flex gap-2">
                  {(["live", "sandbox"] as const).map((env) => (
                    <button
                      key={env}
                      type="button"
                      onClick={() => setForm({ ...form, environment: env })}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                        form.environment === env
                          ? "border-brand-green bg-brand-green/10 text-deep-forest"
                          : "border-charcoal-ink/15 text-charcoal-ink/60"
                      }`}
                    >
                      {env}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={pending || !form.partnerIntegrationId || form.name.trim().length < 2 || !form.url || form.eventTypes.length === 0}
              >
                {form.id ? "Save changes" : "Add endpoint"}
              </Button>
              {form.id && (
                <Button variant="outline" onClick={() => setForm(EMPTY_WEBHOOK)}>
                  Cancel edit
                </Button>
              )}
            </div>
          </>
        )}
        {message && <p className="text-sm text-red-600">{message}</p>}

        {webhookEndpoints.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">No webhook endpoints registered yet.</p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {webhookEndpoints.map((endpoint) => (
              <li key={endpoint.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-charcoal-ink">
                    {endpoint.name}{" "}
                    {endpoint.is_active ? (
                      <Badge variant="green">Active</Badge>
                    ) : (
                      <Badge variant="grey">Inactive</Badge>
                    )}{" "}
                    {endpoint.environment === "sandbox" && <Badge variant="amber">Sandbox</Badge>}
                    {endpoint.consecutive_failures >= 3 && <Badge variant="red">Failing</Badge>}
                  </p>
                  <p className="truncate text-xs text-charcoal-ink/50">
                    {endpoint.url} · {endpoint.event_types.join(", ")} · last success{" "}
                    {formatDate(endpoint.last_success_at)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await setWebhookEndpointActiveAction(endpoint.id, !endpoint.is_active);
                      })
                    }
                  >
                    {endpoint.is_active ? "Deactivate" : "Activate"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await deleteWebhookEndpointAction(endpoint.id);
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

"use client";

import { useState } from "react";
import {
  useWearableConnections,
  useSetWearableConnectionStatus,
  useUpdateWearableConsent,
  useDeleteWearableConnectionData,
  type WearableConnection,
} from "@/lib/queries/wearable-connections";
import type { CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";
import type { WearableConsentCategory } from "@/lib/wearables/normalise";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

const PROVIDER_LABEL: Record<CloudOAuthWearableProvider, string> = {
  oura: "Oura",
  whoop: "WHOOP",
  garmin: "Garmin",
  fitbit: "Fitbit",
  dexcom: "Dexcom (CGM)",
};

const ALL_PROVIDERS: CloudOAuthWearableProvider[] = [
  "oura",
  "whoop",
  "garmin",
  "fitbit",
  "dexcom",
];

/** The four categories a patient can grant or deny independently (53.3/53.4
 * — "allow Tarragon to access activity data" rather than one blanket "give
 * Tarragon everything"). Order matches how they read on the panel. */
const CONSENT_CATEGORIES: { key: WearableConsentCategory; label: string }[] = [
  { key: "activity", label: "Activity & steps" },
  { key: "heart_rate", label: "Heart rate & HRV" },
  { key: "sleep", label: "Sleep" },
  { key: "weight", label: "Weight" },
];

type ConsentChoices = Record<WearableConsentCategory, boolean>;

const FULL_CONSENT: ConsentChoices = { activity: true, heart_rate: true, sleep: true, weight: true };

function buildConnectHref(provider: CloudOAuthWearableProvider, consent: ConsentChoices): string {
  const params = new URLSearchParams({ consent: "1" });
  for (const { key } of CONSENT_CATEGORIES) {
    params.set(`consent_${key}`, consent[key] ? "1" : "0");
  }
  return `/api/wearables/connect/${provider}?${params.toString()}`;
}

/**
 * Patient-facing "Connect a wearable" card — the real gap CLAUDE.md flags
 * (oauth-providers.ts's authorize-URL builder existed with no UI on top of
 * it). Sync only starts once the provider relationship + webhook are fully
 * live (see api/wearables/webhook/[provider]); this card only proves the
 * OAuth handshake and records the connection.
 *
 * Also carries 53.3/53.4's granular per-category consent (choose before
 * connecting, narrow afterwards) and 53.13's patient-control actions
 * (pause/resume alongside connect/disconnect, plus deleting everything a
 * connection has already synced).
 *
 * Libre (Abbott) is shown as its own row below the OAuth providers, not as
 * a Connect button — Abbott has no self-serve OAuth developer program, so
 * "requires a partnership" is the honest state, not "not yet available"
 * (which would wrongly imply the same fix as the others: just register a
 * developer app). See oauth-providers.ts's CloudOAuthWearableProvider doc
 * comment for the full reasoning.
 */
export function WearableConnectCard({
  patientId,
  configuredProviders,
}: {
  patientId: string;
  configuredProviders: CloudOAuthWearableProvider[];
}) {
  const connections = useWearableConnections(patientId);
  const setStatus = useSetWearableConnectionStatus(patientId);
  const [consentOpenFor, setConsentOpenFor] = useState<CloudOAuthWearableProvider | null>(null);

  const connectionByProvider = new Map(
    (connections.data ?? []).map((c) => [c.provider, c])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest dark:text-brand-green-bright" strokeWidth={2} />
          Connect a wearable
        </CardTitle>
        <CardDescription>
          Sync steps, sleep, heart rate, or continuous glucose from your Oura, WHOOP,
          Garmin, Fitbit, or Dexcom device. Choose what to share before connecting.
          You can change it any time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
          {ALL_PROVIDERS.map((provider) => {
            const connection = connectionByProvider.get(provider);
            const isConfigured = configuredProviders.includes(provider);
            return (
              <li key={provider} className="py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                    {PROVIDER_LABEL[provider]}
                  </span>
                  {connection?.status === "error" ? (
                    <div className="flex items-center gap-2">
                      <Badge variant="red">Not syncing</Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ connectionId: connection.id, status: "disconnected" })}
                      >
                        Disconnect
                      </Button>
                      <Button size="sm" asChild>
                        <a href={`/api/wearables/connect/${provider}`}>Reconnect</a>
                      </Button>
                    </div>
                  ) : connection ? (
                    <div className="flex items-center gap-2">
                      <Badge variant={connection.status === "paused" ? "grey" : "green"}>
                        {connection.status === "paused" ? "Paused" : "Connected"}
                      </Badge>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() =>
                          setStatus.mutate({
                            connectionId: connection.id,
                            status: connection.status === "paused" ? "active" : "paused",
                          })
                        }
                      >
                        {connection.status === "paused" ? "Resume" : "Pause"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={setStatus.isPending}
                        onClick={() => setStatus.mutate({ connectionId: connection.id, status: "disconnected" })}
                      >
                        Disconnect
                      </Button>
                    </div>
                  ) : isConfigured ? (
                    <Button size="sm" onClick={() => setConsentOpenFor(provider)}>
                      Connect
                    </Button>
                  ) : (
                    <Badge variant="grey">Not yet available</Badge>
                  )}
                </div>

                {/* 55.12: an errored connection carries its last_sync_error
                    (why it stopped syncing) rather than silently looking
                    identical to a healthy one — see queries/wearable-
                    connections.ts's 55.12 comment for the query-side half. */}
                {connection?.status === "error" && connection.last_sync_error && (
                  <p className="mt-1 text-xs text-charcoal-ink/50 dark:text-night-ink/55">{connection.last_sync_error}</p>
                )}

                {connection && connection.status !== "error" && (
                  <ConnectionControls connection={connection} patientId={patientId} />
                )}

                {consentOpenFor === provider && (
                  <ConsentPanel
                    provider={provider}
                    onCancel={() => setConsentOpenFor(null)}
                  />
                )}
              </li>
            );
          })}
          <li className="flex items-center justify-between py-2.5">
            <div>
              <span className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                FreeStyle Libre (Abbott)
              </span>
              <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                Abbott requires a direct data-sharing partnership for Libre access.
                It isn&apos;t a self-serve connection like the others above.
              </p>
            </div>
            <Badge variant="grey">Requires partnership</Badge>
          </li>
        </ul>
      </CardContent>
    </Card>
  );
}

/** What the patient chooses before an OAuth redirect. Nothing is written
 * anywhere until "Continue" is clicked — this is just query-string state for
 * the /api/wearables/connect redirect (see connect/[provider]/route.ts's
 * consentFromQuery), carried through the round-trip via the signed OAuth
 * state token. */
function ConsentPanel({
  provider,
  onCancel,
}: {
  provider: CloudOAuthWearableProvider;
  onCancel: () => void;
}) {
  const [choices, setChoices] = useState<ConsentChoices>(FULL_CONSENT);

  return (
    <div className="mt-3 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 bg-charcoal-ink/[0.02] dark:bg-night-ink/10 p-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
        Choose what to share with {PROVIDER_LABEL[provider]}
      </p>
      <div className="mt-2 space-y-2">
        {CONSENT_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-charcoal-ink/30 dark:border-night-ink/35"
              checked={choices[key]}
              onChange={(e) => setChoices((prev) => ({ ...prev, [key]: e.target.checked }))}
            />
            {label}
          </label>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" asChild>
          <a href={buildConnectHref(provider, choices)}>Continue to {PROVIDER_LABEL[provider]}</a>
        </Button>
        <Button size="sm" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** Manage-consent disclosure + delete-my-data for an already-connected
 * provider. Collapsed by default — most patients never need to touch it,
 * and it shouldn't compete with the primary connect/pause/disconnect row. */
function ConnectionControls({
  connection,
  patientId,
}: {
  connection: Pick<
    WearableConnection,
    "id" | "consent_activity" | "consent_heart_rate" | "consent_sleep" | "consent_weight"
  >;
  patientId: string;
}) {
  const updateConsent = useUpdateWearableConsent(patientId);
  const deleteData = useDeleteWearableConnectionData(patientId);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteResult, setDeleteResult] = useState<string | null>(null);

  const consentValue: Record<WearableConsentCategory, boolean> = {
    activity: connection.consent_activity,
    heart_rate: connection.consent_heart_rate,
    sleep: connection.consent_sleep,
    weight: connection.consent_weight,
  };

  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-charcoal-ink/60 dark:text-night-ink/60 hover:text-charcoal-ink dark:hover:text-night-ink">
        Manage what syncs
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-charcoal-ink/10 dark:border-night-ink/15 p-3">
        {CONSENT_CATEGORIES.map(({ key, label }) => (
          <label key={key} className="flex items-center gap-2 text-sm text-charcoal-ink dark:text-night-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-charcoal-ink/30 dark:border-night-ink/35"
              checked={consentValue[key]}
              disabled={updateConsent.isPending}
              onChange={(e) =>
                updateConsent.mutate({ connectionId: connection.id, category: key, granted: e.target.checked })
              }
            />
            {label}
          </label>
        ))}

        <div className="border-t border-charcoal-ink/10 dark:border-night-ink/15 pt-2">
          {confirmingDelete ? (
            <div className="space-y-2">
              <p className="text-xs text-charcoal-ink/70 dark:text-night-ink/70">
                This permanently deletes everything this connection has synced so far and
                disconnects it. This can&apos;t be undone.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-300 dark:border-red-500/40 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-500/15"
                  disabled={deleteData.isPending}
                  onClick={async () => {
                    const result = await deleteData.mutateAsync(connection.id);
                    setDeleteResult(
                      `Deleted ${result.vitalsDeleted + result.wearableReadingsDeleted} synced reading(s).`
                    );
                    setConfirmingDelete(false);
                  }}
                >
                  {deleteData.isPending ? "Deleting…" : "Yes, delete my data"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setConfirmingDelete(true)}>
              Delete my synced data
            </Button>
          )}
          {deleteResult && <p className="mt-1 text-xs text-charcoal-ink/60 dark:text-night-ink/60">{deleteResult}</p>}
        </div>
      </div>
    </details>
  );
}

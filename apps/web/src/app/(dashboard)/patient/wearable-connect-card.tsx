"use client";

import { useWearableConnections, useDisconnectWearable } from "@/lib/queries/wearable-connections";
import type { CloudOAuthWearableProvider } from "@/lib/wearables/oauth-providers";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

const PROVIDER_LABEL: Record<CloudOAuthWearableProvider, string> = {
  oura: "Oura",
  whoop: "WHOOP",
  garmin: "Garmin",
  fitbit: "Fitbit",
};

const ALL_PROVIDERS: CloudOAuthWearableProvider[] = ["oura", "whoop", "garmin", "fitbit"];

/**
 * Patient-facing "Connect a wearable" card — the real gap CLAUDE.md flags
 * (oauth-providers.ts's authorize-URL builder existed with no UI on top of
 * it). Sync only starts once the provider relationship + webhook are fully
 * live (see api/wearables/webhook/[provider]); this card only proves the
 * OAuth handshake and records the connection.
 */
export function WearableConnectCard({
  patientId,
  configuredProviders,
}: {
  patientId: string;
  configuredProviders: CloudOAuthWearableProvider[];
}) {
  const connections = useWearableConnections(patientId);
  const disconnect = useDisconnectWearable(patientId);

  const connectionByProvider = new Map(
    (connections.data ?? []).map((c) => [c.provider, c])
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.aiCoach className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Connect a wearable
        </CardTitle>
        <CardDescription>
          Sync steps, sleep, and heart rate from your Oura, WHOOP, Garmin, or Fitbit device.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-charcoal-ink/10">
          {ALL_PROVIDERS.map((provider) => {
            const connection = connectionByProvider.get(provider);
            const isConfigured = configuredProviders.includes(provider);
            return (
              <li key={provider} className="flex items-center justify-between py-2.5">
                <span className="text-sm font-medium text-charcoal-ink">
                  {PROVIDER_LABEL[provider]}
                </span>
                {connection ? (
                  <div className="flex items-center gap-2">
                    <Badge variant="green">Connected</Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={disconnect.isPending}
                      onClick={() => disconnect.mutate(connection.id)}
                    >
                      Disconnect
                    </Button>
                  </div>
                ) : isConfigured ? (
                  <Button size="sm" asChild>
                    <a href={`/api/wearables/connect/${provider}`}>Connect</a>
                  </Button>
                ) : (
                  <Badge variant="grey">Not yet available</Badge>
                )}
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}

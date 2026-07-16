"use client";

import {
  useServiceRegions,
  useSetServiceRegionActive,
  useOpenWaitlistCounts,
  type ServiceRegion,
} from "@/lib/queries/service-regions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function ServiceRegionsManager() {
  const { data: regions, isLoading, isError } = useServiceRegions();
  const { data: waitlistCounts } = useOpenWaitlistCounts();
  const setActive = useSetServiceRegionActive();

  const liveCount = regions?.filter((r) => r.is_active).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>States</CardTitle>
        <CardDescription>
          {liveCount} of {regions?.length ?? 0} states live. Deactivating a state re-gates its
          partner actions immediately; it does not remove partner data you&apos;ve already loaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load service regions.</p>}
        {setActive.isError && (
          <p className="text-sm text-red-600">Could not update that state — please try again.</p>
        )}
        {regions && regions.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {regions.map((region: ServiceRegion) => {
              const waiting = waitlistCounts?.[region.state] ?? 0;
              return (
                <li key={region.id} className="flex items-center justify-between gap-4 py-2.5">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">{region.display_name}</p>
                    <p className="text-xs text-charcoal-ink/60">
                      {region.is_active && region.activated_at
                        ? `Live since ${new Date(region.activated_at).toLocaleDateString("en-GB", { dateStyle: "medium" })}`
                        : "Not live yet"}
                      {waiting > 0 && ` · ${waiting} waiting`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={region.is_active ? "green" : "grey"}>
                      {region.is_active ? "Live" : "Dark"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setActive.isPending}
                      onClick={() => setActive.mutate({ id: region.id, isActive: !region.is_active })}
                    >
                      {region.is_active ? "Deactivate" : "Activate"}
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

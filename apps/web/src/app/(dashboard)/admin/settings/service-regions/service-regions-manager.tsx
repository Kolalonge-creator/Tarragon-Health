"use client";

import {
  useServiceRegions,
  useSetServiceRegionActive,
  useSetServicePlusCollection,
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
  const setPlus = useSetServicePlusCollection();

  const liveCount = regions?.filter((r) => r.is_active).length ?? 0;
  const plusCount = regions?.filter((r) => r.plus_collection_enabled).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>States</CardTitle>
        <CardDescription>
          {liveCount} of {regions?.length ?? 0} states live. {plusCount} approved for Membership Plus blood
          collection (Plus buyers pick from these; the nationwide partner-lab list does not depend on it). Deactivating a state re-gates its
          partner actions immediately; it does not remove partner data you&apos;ve already loaded.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load service regions.</p>}
        {setPlus.isError && (
          <p className="text-sm text-red-600">Could not update Plus collection for that state. Please try again.</p>
        )}
        {setActive.isError && (
          <p className="text-sm text-red-600">Could not update that state. Please try again.</p>
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
                    <Badge variant={region.plus_collection_enabled ? "green" : "grey"}>
                      {region.plus_collection_enabled ? "Plus on" : "Plus off"}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={setPlus.isPending}
                      onClick={() =>
                        setPlus.mutate({ id: region.id, enabled: !region.plus_collection_enabled })
                      }
                    >
                      {region.plus_collection_enabled ? "Withdraw Plus" : "Approve for Plus"}
                    </Button>
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

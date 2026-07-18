"use client";

import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  useAllLabProviders,
  useCreateLabProvider,
  useSetLabProviderActive,
} from "@/lib/queries/partner-catalogues";

function parseRegions(raw: string): string[] {
  return raw.split(",").map((r) => r.trim()).filter(Boolean);
}

export function LabsManager() {
  const { data: labs, isLoading } = useAllLabProviders();
  const create = useCreateLabProvider();
  const toggle = useSetLabProviderActive();

  const [name, setName] = useState("");
  const [regions, setRegions] = useState("");
  const [homeCollection, setHomeCollection] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Add a lab provider</CardTitle>
          <CardDescription>Patients can book at an active lab covering their region.</CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setError(null);
              create.mutate(
                { name, regions: parseRegions(regions), homeCollection, isActive },
                {
                  onSuccess: () => {
                    setName("");
                    setRegions("");
                    setHomeCollection(false);
                    setIsActive(true);
                  },
                  onError: (err) => setError(err instanceof Error ? err.message : "Could not save"),
                }
              );
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="lab-name">Name</Label>
              <Input id="lab-name" value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="lab-regions">Regions (comma-separated)</Label>
              <Input id="lab-regions" value={regions} onChange={(e) => setRegions(e.target.value)} placeholder="Lagos, Abuja" />
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={homeCollection} onChange={(e) => setHomeCollection(e.target.checked)} />
              Offers home sample collection
            </label>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/80">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              Active
            </label>
            {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? "Saving…" : "Add lab"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Labs</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-charcoal-ink/60">Loading…</p>
          ) : (labs ?? []).length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No labs yet.</p>
          ) : (
            (labs ?? []).map((lab) => (
              <div key={lab.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-charcoal-ink/10 px-4 py-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-charcoal-ink">{lab.name}</span>
                  <Badge variant={lab.is_active ? "green" : "grey"}>{lab.is_active ? "Active" : "Inactive"}</Badge>
                  {lab.home_collection && <Badge variant="blue">Home collection</Badge>}
                  {lab.regions.length > 0 && (
                    <span className="text-xs text-charcoal-ink/50">{lab.regions.join(", ")}</span>
                  )}
                </div>
                <Button
                  variant="outline"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ id: lab.id, isActive: !lab.is_active })}
                >
                  {lab.is_active ? "Deactivate" : "Activate"}
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

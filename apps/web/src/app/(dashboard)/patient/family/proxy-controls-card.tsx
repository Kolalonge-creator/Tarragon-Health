"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { CARE_ACCESS_CATEGORIES, useMyCareFollowers, type CareAccessCategory, type CareFollower } from "@/lib/queries/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ViewLogRow {
  id: string;
  occurred_at: string;
  actor_first_name: string | null;
  kind: string;
  scope: string | null;
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function describe(row: ViewLogRow): string {
  const who = row.actor_first_name ?? "Someone";
  switch (row.kind) {
    case "acted_for":
      return `${who} did something on your behalf`;
    case "receipt_generated":
      return `${who} made a care receipt`;
    case "data_exported":
      return `${who} exported data from your record`;
    default:
      return `${who} opened your record`;
  }
}

/** What the people who help you have looked at, and the two controls that matter: stop them now, or let them see less. */
export function useProxyViewLog() {
  return useQuery({
    queryKey: ["my-proxy-view-log"],
    queryFn: async (): Promise<ViewLogRow[]> => {
      const { data, error } = await createClient().rpc("my_proxy_view_log", { p_limit: 20 });
      if (error) throw error;
      return (data ?? []) as ViewLogRow[];
    },
  });
}

function FollowerControls({ follower }: { follower: CareFollower }) {
  const queryClient = useQueryClient();
  const [keep, setKeep] = useState<CareAccessCategory[]>(follower.categories);
  const [tellThem, setTellThem] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const revoke = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("revoke_proxy_access", { p_grantee: follower.profileId });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage("Their access has stopped.");
      await queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
    onError: () => setMessage("We could not stop that just now. Please try again."),
  });

  const narrow = useMutation({
    mutationFn: async () => {
      const { error } = await createClient().rpc("narrow_proxy_access", {
        p_grantee: follower.profileId,
        p_categories: keep,
        p_notify: tellThem,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      setMessage(tellThem ? "Saved. We let them know." : "Saved. They will not be told.");
      await queryClient.invalidateQueries({ queryKey: ["my-care-followers"] });
    },
    onError: () => setMessage("We could not save that just now. Please try again."),
  });

  const labelFor = (value: CareAccessCategory) => CARE_ACCESS_CATEGORIES.find((c) => c.value === value)?.label ?? value;
  const changed = keep.length !== follower.categories.length;

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium">{follower.fullName ?? "Someone"}</p>
        <Button type="button" variant="outline" size="sm" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
          Stop their access now
        </Button>
      </div>
      {follower.categories.length > 0 && (
        <fieldset className="space-y-1.5">
          <legend className="text-xs text-charcoal-ink/60">They can see. Untick to let them see less.</legend>
          {follower.categories.map((category) => (
            <label key={category} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={keep.includes(category)}
                onChange={(event) =>
                  setKeep((current) => (event.target.checked ? [...current, category] : current.filter((c) => c !== category)))
                }
              />
              {labelFor(category)}
            </label>
          ))}
          <label className="flex items-center gap-2 pt-1 text-xs text-charcoal-ink/70">
            <input type="checkbox" checked={tellThem} onChange={(event) => setTellThem(event.target.checked)} />
            Tell them I changed this (they are not told unless you tick this)
          </label>
          <Button type="button" size="sm" disabled={!changed || narrow.isPending} onClick={() => narrow.mutate()}>
            Save
          </Button>
        </fieldset>
      )}
      {message && (
        <p role="status" className="text-sm text-charcoal-ink/80">
          {message}
        </p>
      )}
    </li>
  );
}

export function ProxyControlsCard() {
  const followers = useMyCareFollowers();
  const log = useProxyViewLog();
  const people = followers.data ?? [];
  if (followers.isLoading) return null;
  if (people.length === 0 && (log.data ?? []).length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>People who help you</CardTitle>
        <CardDescription>
          You decide what they can see. You can let them see less, or stop their access straight away. Changes take
          effect at once.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {people.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {people.map((follower) => (
              <FollowerControls key={follower.grantId} follower={follower} />
            ))}
          </ul>
        )}
        <div>
          <h3 className="text-sm font-medium">What they have looked at</h3>
          {log.isError && <p className="mt-2 text-sm text-red-700">Could not load this just now.</p>}
          {log.data && log.data.length === 0 && (
            <p className="mt-2 text-sm text-charcoal-ink/60">Nobody has opened your record yet.</p>
          )}
          {log.data && log.data.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {log.data.map((row) => (
                <li key={row.id} className="text-sm">
                  {describe(row)} <span className="text-xs text-charcoal-ink/60">{when(row.occurred_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

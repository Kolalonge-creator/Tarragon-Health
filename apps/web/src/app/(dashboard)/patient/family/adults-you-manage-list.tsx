"use client";

import { useAdultsIManage } from "@/lib/queries/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Adults whose care this caller manages — either an accepted eldercare
 * care_access_requests 'manage' grant between two people who each hold their
 * own account, or an elder_proxy dependant with no login of their own at all
 * (addElderProxyDependentAction, see 20260829082917 — "my father does not
 * use smartphones"). Deliberately separate from DependantsList (children):
 * dependent_kind is what tells all three apart even though eldercare and
 * elder_proxy write an identical-shaped profile_access row.
 */
export function AdultsYouManageList() {
  const { data: adults, isLoading, isError } = useAdultsIManage();

  if (!isLoading && !isError && (adults?.length ?? 0) === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>People whose care you manage</CardTitle>
        <CardDescription>
          Adults you book, log and manage care for alongside your own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load this.</p>}
        {adults && adults.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {adults.map((adult) => (
              <li key={adult.id} className="flex items-center justify-between gap-4 py-3">
                <p className="text-sm font-medium text-charcoal-ink">
                  {adult.full_name ?? "Unnamed"}
                </p>
                <Badge variant="grey">
                  {adult.dependent_kind === "elder_proxy"
                    ? "You keep this record for them"
                    : "They keep their own account"}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

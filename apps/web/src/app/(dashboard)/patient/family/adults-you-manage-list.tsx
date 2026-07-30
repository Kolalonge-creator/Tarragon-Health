"use client";

import { useAdultsIManage } from "@/lib/queries/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Adults whose care this caller manages — an accepted eldercare
 * care_access_requests 'manage' grant, between two people who each hold
 * their own account. Deliberately separate from DependantsList (children
 * with no login): is_dependent_account is what tells the two apart even
 * though both write an identical profile_access row.
 */
export function AdultsYouManageList() {
  const { data: adults, isLoading, isError } = useAdultsIManage();

  if (!isLoading && !isError && (adults?.length ?? 0) === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>People whose care you manage</CardTitle>
        <CardDescription>
          Adults who&apos;ve agreed to let you book, log and manage their care alongside your own —
          they keep their own account, and can withdraw this at any time.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load this.</p>}
        {adults && adults.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {adults.map((adult) => (
              <li key={adult.id} className="py-3">
                <p className="text-sm font-medium text-charcoal-ink">
                  {adult.full_name ?? "Unnamed"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

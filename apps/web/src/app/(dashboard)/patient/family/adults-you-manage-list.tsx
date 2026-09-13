"use client";

import { useAdultsIManage } from "@/lib/queries/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ClaimAccountCard } from "./claim-account-card";

/**
 * Adults whose care this caller manages — either an accepted eldercare
 * care_access_requests 'manage' grant between two people who each hold their
 * own account, or an elder_proxy dependant with no login of their own at all
 * (addElderProxyDependentAction, see 20260829082917 — "my father does not
 * use smartphones", and its 2026-09-10 reuse by /patient/supporting/new for a
 * diaspora sponsor's not-yet-a-patient beneficiary). Deliberately separate
 * from DependantsList (children): dependent_kind is what tells all three
 * apart even though eldercare and elder_proxy write an identical-shaped
 * profile_access row.
 *
 * An elder_proxy row gets the full claim card (see claim-account-card.tsx),
 * not just a badge: unlike a minor_child, there is no age threshold to wait
 * for, so "give them their own login" is always the immediately-available
 * next step, whenever the sponsor is ready. The instant a claim succeeds,
 * dependent_kind flips to null server-side, this list's own query refetches,
 * and the same row falls through to the plain "they keep their own account"
 * badge below — no separate "already claimed" state to track here.
 */
export function AdultsYouManageList() {
  const { data: adults, isLoading, isError } = useAdultsIManage();

  if (!isLoading && !isError && (adults?.length ?? 0) === 0) return null;

  const elderProxies = (adults ?? []).filter((a) => a.dependent_kind === "elder_proxy");
  const others = (adults ?? []).filter((a) => a.dependent_kind !== "elder_proxy");

  return (
    <div className="space-y-4">
      {elderProxies.map((adult) => (
        <ClaimAccountCard
          key={adult.id}
          dependentId={adult.id}
          title={`Give ${adult.full_name ?? "them"} their own login`}
          description="They can sign in with their own phone number whenever you're ready. You'll keep the same access you have today until they decide otherwise."
          invalidateQueryKey={["adults-i-manage"]}
        />
      ))}

      {(isLoading || isError || others.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>People whose care you manage</CardTitle>
            <CardDescription>
              Adults you book, log and manage care for alongside your own.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
            {isError && <p className="text-sm text-red-600 dark:text-red-400">Could not load this.</p>}
            {others.length > 0 && (
              <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
                {others.map((adult) => (
                  <li key={adult.id} className="flex items-center justify-between gap-4 py-3">
                    <p className="text-sm font-medium text-charcoal-ink dark:text-night-ink">
                      {adult.full_name ?? "Unnamed"}
                    </p>
                    <Badge variant="grey">They keep their own account</Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

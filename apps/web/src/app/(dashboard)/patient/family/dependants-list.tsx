"use client";

import Link from "next/link";
import { useManagedDependents } from "@/lib/queries/care-access";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ageFromDateOfBirth } from "@tarragon/shared";

/**
 * Children whose records this caller keeps — a 'manage' profile_access grant.
 * Adults never appear here: an adult holds their own account and their own
 * subscription, and shares their record by naming somebody as next of kin,
 * which grants 'view' rather than 'manage'.
 */
export function DependantsList() {
  const { data: dependants, isLoading, isError } = useManagedDependents();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Children you look after</CardTitle>
        <CardDescription>
          Records you keep on someone else&apos;s behalf, for children too young to hold an account.
          Their vaccination card, schedule and Tarragon-verified certificates work exactly like
          your own.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {isError && <p className="text-sm text-red-600">Could not load these records.</p>}
        {dependants && dependants.length === 0 && (
          <p className="text-sm text-charcoal-ink/60">
            No children added yet. Add one below to start their vaccination card.
          </p>
        )}
        {dependants && dependants.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {dependants.map((dependant) => {
              const age = dependant.date_of_birth
                ? ageFromDateOfBirth(dependant.date_of_birth)
                : null;
              return (
                <li key={dependant.id} className="flex items-center justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium text-charcoal-ink">
                      {dependant.full_name ?? "Unnamed"}
                    </p>
                    <p className="text-xs text-charcoal-ink/60">
                      {age === null ? "Date of birth not set" : `${age} years old`}
                    </p>
                  </div>
                  <Button asChild size="sm" variant="outline">
                    <Link href="/patient#prevention">Vaccination card</Link>
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

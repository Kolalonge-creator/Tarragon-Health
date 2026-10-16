"use client";

import { useState, useTransition } from "react";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { endProxyAccessAction } from "./proxy-arrangement-actions";

export interface ProxyArrangement {
  grant_id: string;
  set_up_by: string;
  since: string | null;
  categories: string[];
}

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { timeZone: "Africa/Lagos", day: "numeric", month: "short", year: "numeric" }) : "";

/**
 * Who set up access to this account, always visible on the account's own privacy page, with an instant way to end it
 * (v5 1.19, OQ-48). The name comes from the setup record, not from anything the other person can edit.
 */
export function ProxyArrangementsCard({ arrangements }: { arrangements: ProxyArrangement[] }) {
  const [armed, setArmed] = useState<string | null>(null);
  const [ended, setEnded] = useState<Record<string, string>>({});
  const [error, setError] = useState(false);
  const [pending, startTransition] = useTransition();
  if (arrangements.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("proxy.arrangement.title")}</CardTitle>
        <CardDescription>{t("proxy.arrangement.note")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {arrangements.map((a) => (
          <div key={a.grant_id} className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-charcoal-ink dark:text-night-ink">
              {ended[a.grant_id] ? t("proxy.arrangement.ended") : t("proxy.arrangement.line", "en", { name: a.set_up_by, date: when(a.since) })}
            </p>
            {!ended[a.grant_id] &&
              (armed === a.grant_id ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => {
                    setError(false);
                    startTransition(async () => {
                      const result = await endProxyAccessAction({ grantId: a.grant_id });
                      setArmed(null);
                      if (result?.ok) setEnded((e) => ({ ...e, [a.grant_id]: a.set_up_by }));
                      else setError(true);
                    });
                  }}
                >
                  {t("proxy.arrangement.end_confirm")}
                </Button>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setArmed(a.grant_id)}>
                  {t("proxy.arrangement.end")}
                </Button>
              ))}
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-700">
            {t("proxy.arrangement.error")}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

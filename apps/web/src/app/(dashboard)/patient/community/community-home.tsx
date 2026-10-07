"use client";

import Link from "next/link";
import { useState } from "react";
import { t, type Locale } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/ui/form-error";
import { COHORT_KINDS, KIND_KEYS, communityErrorKey, type CohortKind } from "@/lib/community/model";
import { CommunityError, useCommunityOff, useCreateCohort, useMyCohorts } from "@/lib/queries/community";

const MUTED = "text-charcoal-ink/70 dark:text-night-ink/70";
const TOUCH = "min-h-11";

export function CommunityHome({ locale }: { locale: Locale }) {
  const mine = useMyCohorts();
  const off = useCommunityOff();
  const create = useCreateCohort();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<CohortKind>("church");
  const [agree, setAgree] = useState(false);

  if (mine.isPending) return <p className={MUTED} role="status">{t("community.loading", locale)}</p>;
  if (mine.isError) return <FormError id="community-error" message={t(communityErrorKey(mine.error instanceof CommunityError ? mine.error.message : null), locale)} />;
  const data = mine.data;
  if (!data.open) return <p role="status">{t("community.closed", locale)}</p>;

  const createError = create.error instanceof CommunityError ? t(communityErrorKey(create.error.message), locale) : create.isError ? t("community.error.unknown", locale) : null;

  return (
    <div className="space-y-6">
      <p className={MUTED}>{t("community.intro", locale)}</p>

      <Card>
        <CardHeader><CardTitle>{t("community.off.title", locale)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className={`text-sm ${MUTED}`}>{t("community.off.body", locale)}</p>
          {data.off ? <p role="status">{t("community.off.is_off", locale)}</p> : null}
          <Button type="button" variant="outline" className={TOUCH} disabled={off.isPending} onClick={() => off.mutate(!data.off)}>
            {data.off ? t("community.off.turn_on", locale) : t("community.off.turn_off", locale)}
          </Button>
        </CardContent>
      </Card>

      {data.off ? null : (
        <>
          <Card>
            <CardHeader><CardTitle>{t("community.your_groups", locale)}</CardTitle></CardHeader>
            <CardContent>
              {data.cohorts.length === 0 ? <p className={MUTED}>{t("community.empty", locale)}</p> : (
                <ul className="space-y-3">
                  {data.cohorts.map((c) => (
                    <li key={c.cohort_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        <p className={`text-sm ${MUTED}`}>{t(KIND_KEYS[c.kind], locale)}{c.is_moderator ? ` · ${t("community.moderator_badge", locale)}` : ""}</p>
                        {c.state === "closed" ? <p className="text-sm">{t("community.mod.closed", locale)}</p> : null}
                      </div>
                      <Button asChild variant="outline" className={TOUCH}>
                        <Link href={`/patient/community/${c.cohort_id}`}>{t("community.open", locale)}</Link>
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t("community.create.title", locale)}</CardTitle></CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  create.mutate({ name, kind, consent: agree }, { onSuccess: (r) => { if (r.ok !== false) { setName(""); setAgree(false); } } });
                }}
              >
                <div className="space-y-1">
                  <Label htmlFor="cohort-name">{t("community.create.name", locale)}</Label>
                  <Input id="cohort-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-describedby="cohort-name-hint" required />
                  <p id="cohort-name-hint" className={`text-sm ${MUTED}`}>{t("community.create.name_hint", locale)}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cohort-kind">{t("community.create.kind", locale)}</Label>
                  <select id="cohort-kind" className={`w-full rounded-md border bg-transparent px-3 ${TOUCH}`} value={kind} onChange={(e) => setKind(e.target.value as CohortKind)}>
                    {COHORT_KINDS.map((k) => <option key={k} value={k}>{t(KIND_KEYS[k], locale)}</option>)}
                  </select>
                </div>
                <div className={`flex items-start gap-3 ${TOUCH}`}>
                  <input id="create-consent" type="checkbox" className="mt-1 h-5 w-5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
                  <Label htmlFor="create-consent" className="font-normal leading-snug">{t("community.create.consent", locale)}</Label>
                </div>
                <FormError id="create-error" message={createError} />
                <Button type="submit" className={TOUCH} disabled={!agree || name.trim().length < 3 || create.isPending}>{t("community.create.submit", locale)}</Button>
              </form>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

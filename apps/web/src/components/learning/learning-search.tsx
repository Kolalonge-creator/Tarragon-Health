"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t } from "@tarragon/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSearchHealthEducation } from "@/lib/queries/learning-centre";

/** Search the library in everyday words ("BP", "sugar", "belle"): the database expands them through the versioned synonym table. */
export function LearningSearch() {
  const [raw, setRaw] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(raw), 350);
    return () => clearTimeout(id);
  }, [raw]);
  const { data, isLoading, isError } = useSearchHealthEducation(query);
  const searched = query.trim().length >= 2;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("learn.search.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <input
          type="search"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={t("learn.search.placeholder")}
          aria-label={t("learn.search.title")}
          maxLength={80}
          className="w-full rounded-lg border border-charcoal-ink/20 bg-white px-3 py-2 text-sm dark:border-night-ink/25 dark:bg-night-surface"
        />
        {searched && isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">…</p>}
        {searched && !isLoading && !isError && data && data.length === 0 && (
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("learn.search.none")}</p>
        )}
        {data && data.length > 0 && searched && (
          <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15">
            {data.map((hit) => (
              <li key={hit.code} className="py-2">
                <Link href={`/patient/learn/${hit.code}`} className="text-sm font-medium text-charcoal-ink hover:text-brand-green dark:text-night-ink dark:hover:text-brand-green-bright">
                  {hit.title}
                </Link>
                {hit.summary && <p className="text-xs text-charcoal-ink/65 dark:text-night-ink/65">{hit.summary}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

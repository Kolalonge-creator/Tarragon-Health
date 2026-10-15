"use client";

import { useId, useState } from "react";
import { t, type Locale, type MessageKey } from "@tarragon/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { GroupSummary } from "@/lib/community/model";
import { GroupList } from "./group-list";
import { MUTED, TOUCH } from "./styles";
import { searchGroups } from "./community-actions";

/**
 * The group list with a search box. Search covers group names, descriptions and topics only, never posts. An empty or out-of-range
 * search (under 2 or over 60 characters) simply shows the normal list again; that rule lives in the action and the database.
 */
export function GroupSearch({ groups: initial, locale }: { groups: readonly GroupSummary[]; locale: Locale }) {
  const [groups, setGroups] = useState<readonly GroupSummary[]>(initial);
  const [q, setQ] = useState("");
  const [searched, setSearched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const id = useId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    const result = await searchGroups({ q }).catch(() => null);
    setPending(false);
    if (result && "groups" in result) {
      setGroups(result.groups);
      const n = q.trim().length;
      setSearched(n >= 2 && n <= 60);
    } else {
      setError(result ? result.key : "community.feed.error");
    }
  }

  return (
    <div className="space-y-4">
      <form onSubmit={onSubmit} role="search" className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1 space-y-1">
          <Label htmlFor={id}>{t("community.groups.search_label", locale)}</Label>
          <Input id={id} type="search" value={q} maxLength={60} placeholder={t("community.groups.search_placeholder", locale)} onChange={(e) => setQ(e.target.value)} className={TOUCH} />
        </div>
        <Button type="submit" className={TOUCH} disabled={pending}>
          {t("community.groups.search_label", locale)}
        </Button>
      </form>
      <p role="status" aria-live="polite" className={`text-sm ${MUTED}`}>
        {error ? t(error, locale) : searched && groups.length === 0 ? t("community.groups.search_empty", locale) : ""}
      </p>
      {searched && groups.length === 0 ? null : <GroupList groups={groups} locale={locale} />}
    </div>
  );
}

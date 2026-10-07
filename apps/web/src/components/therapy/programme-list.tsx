"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { t, type MessageKey } from "@tarragon/i18n";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ProgrammeRow { id: string; code: string; title: string; summary: string; status: string; guard_key: string }
interface EnrolmentRow { id: string; programme_id: string; state: string; completed_count: number; baseline_score: number | null; current_score: number | null }

/**
 * The programmes a patient can open and their own progress. Only draft or live programmes are offered; scaffolds and held programmes
 * are not shown. Reads go through RLS: a patient sees the catalogue and their own enrolments and nobody else's.
 */
export function TherapyProgrammeList() {
  const [state, setState] = useState<{ kind: "loading" } | { kind: "error" } | { kind: "ready"; programmes: ProgrammeRow[]; enrolments: EnrolmentRow[] }>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const supabase = createClient();
        const [p, e] = await Promise.all([
          supabase.from("therapy_programmes").select("id, code, title, summary, status, guard_key").in("status", ["draft", "live"]).order("code"),
          supabase.from("therapy_enrolments").select("id, programme_id, state, completed_count, baseline_score, current_score").order("started_at", { ascending: false }),
        ]);
        if (cancelled) return;
        if (p.error || e.error) { setState({ kind: "error" }); return; }
        // only a programme whose go-live guard is open for this person is offered (the database refuses the rest anyway)
        const open = await Promise.all((p.data ?? []).map(async (row) => {
          const { data } = await supabase.rpc("go_live_guard_is_open", { p_key: row.guard_key });
          return data === true ? row : null;
        }));
        setState({ kind: "ready", programmes: open.filter((row): row is ProgrammeRow => row !== null), enrolments: e.data ?? [] });
      } catch {
        if (!cancelled) setState({ kind: "error" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.kind === "loading") return <p className="text-sm" role="status">{t("therapy.enrol.checking")}</p>;
  if (state.kind === "error") return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{t("therapy.list_error")}</p>;
  if (state.programmes.length === 0) return <p className="text-sm">{t("therapy.list_none")}</p>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      {state.programmes.map((p) => {
        const mine = state.enrolments.find((e) => e.programme_id === p.id && (e.state === "active" || e.state === "paused" || e.state === "completed"));
        return (
          <Card key={p.id}>
            <CardHeader><CardTitle className="text-base">{p.title}</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-charcoal-ink/80 dark:text-night-ink/80">{p.summary}</p>
              {mine && (
                <div className="text-sm" aria-live="polite">
                  <p className="font-medium">{t(`therapy.progress.state.${mine.state}` as MessageKey)}</p>
                  <p>{t("therapy.progress.sessions_finished", "en", { done: mine.completed_count })}</p>
                  {mine.baseline_score !== null && <p>{t("therapy.progress.first_score", "en", { score: mine.baseline_score })}</p>}
                  {mine.current_score !== null && <p>{t("therapy.progress.latest_score", "en", { score: mine.current_score })}</p>}
                </div>
              )}
              <Link href={`/patient/programmes/${p.code}`} className="text-sm font-medium text-brand-green dark:text-brand-green-bright underline">
                {mine && mine.state !== "completed" ? t("therapy.programme.continue") : t("therapy.programme.start")}
              </Link>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

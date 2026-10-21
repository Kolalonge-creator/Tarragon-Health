import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import type { HomeCardPick } from "@tarragon/clinical/today";
import { asLocale, t, type MessageKey } from "@tarragon/i18n";
import { useUiLanguage } from "@/lib/ui-language";
import { supabase } from "@/lib/supabase";
import { loadHomePlan, type HomePlan } from "@/lib/home-plan";
import { CARD_TARGET, cardAction, cardDone, cardTitle, dayStateKey, readinessView, streakLines } from "@/lib/home-plan-model";
import type { SectionId } from "@/lib/sections";
import { space, radii } from "@/ui/design";
import { AppText, Badge, Button, Card, InlineAlert, Skeleton, SkeletonGroup } from "@/ui/kit";
import { TodayCard } from "@/screens/sections/today-card";

/**
 * The Today screen once the Chief Medical Officer has signed the S47b configuration (S47b, v5 4.1). At most two main actions are shown; everything
 * else sits under "More for today", collapsed until the person opens it. Until the configuration is signed (or if it cannot be read) this renders
 * today's ordinary Today list, unchanged.
 *
 * Wording is calm: a quiet day is "no reading", never "missed"; a saved rest day is shown as a rest day; every status is words, with colour only as an
 * extra. Readiness is labelled an estimate and is drawn only for someone with a connected device and stored data.
 */
export function TodayPlan({
  patientId,
  onNavigate,
  reloadToken,
}: {
  patientId: string;
  onNavigate: (section: SectionId) => void;
  reloadToken: number;
}) {
  const language = asLocale(useUiLanguage());
  const tr = (key: MessageKey, params?: Record<string, string | number>) => t(key, language, params);
  const [state, setState] = useState<{ status: "loading" } | { status: "ordinary" } | { status: "plan"; data: HomePlan }>({ status: "loading" });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const userId = data.session?.user.id;
        const plan = userId ? await loadHomePlan(userId, patientId) : null;
        if (alive) setState(plan ? { status: "plan", data: plan } : { status: "ordinary" });
      } catch {
        if (alive) setState({ status: "ordinary" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [patientId, reloadToken]);

  if (state.status === "loading") {
    return (
      <SkeletonGroup label={tr("today.loading")}>
        <Skeleton height={110} radius={radii.lg} />
      </SkeletonGroup>
    );
  }
  if (state.status === "ordinary") return <TodayCard patientId={patientId} onNavigate={onNavigate} reloadToken={reloadToken} />;

  const { plan, streak, readiness, weekly, today } = state.data;
  const ready = readinessView(readiness);

  const actionCard = (p: HomeCardPick) => {
    const title = cardTitle(p.code);
    const action = cardAction(p.code);
    const done = cardDone(p.code);
    if (!title) return null;
    return (
      <Card key={p.code} style={{ gap: space.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
          <AppText variant="bodyStrong" heading style={{ flex: 1 }}>
            {tr(title)}
          </AppText>
          <Badge label={p.state === "done" ? tr("today.card.state.done") : tr("today.card.state.action")} tone={p.state === "done" ? "positive" : "neutral"} />
        </View>
        {p.state === "done" && done ? <AppText variant="body">{tr(done)}</AppText> : null}
        {p.state !== "done" && action ? <Button title={tr(action)} onPress={() => onNavigate(CARD_TARGET[p.code])} /> : null}
      </Card>
    );
  };

  const infoCard = (p: HomeCardPick) => {
    if (p.code === "streak" && streak) {
      const lines = streakLines(streak);
      return (
        <Card key="streak" style={{ gap: space.xs }}>
          <AppText variant="bodyStrong" heading>
            {tr("streak.title")}
          </AppText>
          <AppText variant="body">{tr(lines.headline.key, lines.headline.params)}</AppText>
          <AppText variant="caption" tone="textMuted">
            {tr("streak.week", { done: streak.daysDoneThisWeek })}
          </AppText>
          {/* Each day carries a word as well as its place in the row, so nothing relies on colour. */}
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }} accessibilityRole="list">
            {streak.week.map((d) => (
              <AppText key={d.localDate} variant="caption" accessibilityRole="text">
                {`${d.localDate.slice(8)}: ${tr(dayStateKey(d.state))}`}
              </AppText>
            ))}
          </View>
          {lines.notes.map((n) => (
            <AppText key={n.key} variant="caption" tone="textMuted">
              {tr(n.key, n.params)}
            </AppText>
          ))}
        </Card>
      );
    }
    if (p.code === "weekly_summary" && weekly) {
      return (
        <Card key="weekly" style={{ gap: space.sm }}>
          <AppText variant="bodyStrong" heading>
            {tr("weekly.title")}
          </AppText>
          {weekly.cards.map((c) => (
            <View key={c.code} style={{ gap: 2 }}>
              <AppText variant="label" tone="textMuted">
                {tr(c.title.key as MessageKey, c.title.params)}
              </AppText>
              <AppText variant="body">{tr(c.line.key as MessageKey, c.line.params)}</AppText>
              {c.state === "not_enough" ? (
                <AppText variant="caption" tone="textMuted">
                  {tr("weekly.state.not_enough")}
                </AppText>
              ) : null}
            </View>
          ))}
          <AppText variant="caption" tone="textMuted">
            {tr("weekly.caption")}
          </AppText>
        </Card>
      );
    }
    if (p.code === "readiness" && ready) {
      return (
        <Card key="readiness" style={{ gap: space.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: space.sm }}>
            <AppText variant="bodyStrong" heading style={{ flex: 1 }}>
              {tr("readiness.title")}
            </AppText>
            <Badge label={tr("readiness.estimate")} tone="neutral" />
          </View>
          <AppText variant="bodyStrong">{tr(ready.band)}</AppText>
          <AppText variant="body">{tr(ready.line)}</AppText>
          {ready.reasons.map((r) => (
            <AppText key={r} variant="caption" tone="textMuted">
              {tr(r)}
            </AppText>
          ))}
          <AppText variant="caption" tone="textMuted">
            {tr("readiness.caption")}
          </AppText>
        </Card>
      );
    }
    return null;
  };

  const secondaryCard = (p: HomeCardPick) => (p.state === "info" ? infoCard(p) : actionCard(p));

  return (
    <View style={{ gap: space.md }}>
      <AppText variant="title" heading>
        {tr("today.plan.title")}
      </AppText>
      {/* A source that failed or a copy kept on the phone is said so, as on the ordinary list; an empty day is never claimed on a failed read. */}
      {today.partial ? <InlineAlert tone="info" message={tr("today.partial")} /> : null}
      {plan.primary.length === 0 && plan.secondary.length === 0 && !today.partial ? <AppText variant="body">{tr("today.plan.nothing")}</AppText> : null}
      {plan.primary.map(actionCard)}
      {plan.secondary.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            accessibilityLabel={open ? tr("today.plan.hide_more") : tr("today.plan.more", { count: plan.secondary.length })}
            onPress={() => setOpen((v) => !v)}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <AppText variant="bodyStrong">{open ? tr("today.plan.hide_more") : tr("today.plan.more", { count: plan.secondary.length })}</AppText>
          </Pressable>
          {open ? plan.secondary.map(secondaryCard) : null}
        </>
      ) : null}
    </View>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  deleteFavouriteAction,
  loadNutritionGuidanceAction,
  logFavouriteAction,
  lookupBarcodeAction,
  repeatMealAction,
  saveFavouriteAction,
  setMealSummaryModeAction,
} from "./nutrition-actions";
import { useFoodCatalogue } from "@/lib/queries/food-catalogue";
import { portionUnitLabel, summariseMeal, type FoodCatalogueItem, type FoodPortionUnit } from "@tarragon/shared";
import type { NutritionAnalysisResult } from "@/lib/nutrition/nutrition-analysis";
import type { NutritionGuidance } from "@/lib/nutrition/guidance";
import type { NutritionEntry } from "@/lib/queries/nutrition";
import { MEAL_TYPE_LABELS } from "@/lib/validation/nutrition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/components/ui-language-provider";

export const ENTRIES_KEY = "nutrition-entries";
const GUIDANCE_KEY = "nutrition-guidance";
const FAVOURITES_KEY = "favourite-meals";

/** Targets and the word summary. `hidden` is the database saying "not for this person" (or "not signed off yet"): the callers render nothing. */
export function useNutritionGuidance() {
  return useQuery({
    queryKey: [GUIDANCE_KEY],
    queryFn: (): Promise<NutritionGuidance> => loadNutritionGuidanceAction(),
    staleTime: 60 * 1000,
  });
}

function useFavourites(patientId: string) {
  return useQuery({
    queryKey: [FAVOURITES_KEY, patientId],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("favourite_meals")
        .select("id, name, description, meal_type, use_count, last_used_at")
        .eq("patient_id", patientId)
        .order("last_used_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!patientId,
  });
}

/** The calories, macros, salt and sugar line; the words version when the patient asked for words and the database allows it. */
export function MealSummaryLine({ analysis, guidance }: { analysis: NutritionAnalysisResult; guidance: NutritionGuidance | undefined }) {
  if (!guidance || guidance.state === "hidden" || guidance.mode !== "words") return null;
  const summary = summariseMeal(
    { caloriesKcal: analysis.caloriesKcal, sodiumMg: analysis.sodiumMg, sugarG: analysis.sugarG, reliable: analysis.reliable },
    guidance.mealSummary,
  );
  return (
    <p className="mt-2 rounded-md bg-soft-sage p-2 text-sm font-medium text-deep-forest dark:bg-brand-green/20 dark:text-brand-green-bright" role="status">
      {summary.text}
    </p>
  );
}

/** True when this patient asked for words AND the database lets them see a summary: then the number block is replaced by the words. */
export function showsWordsOnly(guidance: NutritionGuidance | undefined): boolean {
  return Boolean(guidance && guidance.state !== "hidden" && guidance.mode === "words");
}

/** Pick from the list instead of typing: search, choose a measure, add it to the description. */
export function FoodPicker({ onAdd }: { onAdd: (phrase: string) => void }) {
  const t = useT();
  const { data: catalogue, isError } = useFoodCatalogue();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<FoodCatalogueItem | null>(null);
  const [unit, setUnit] = useState<FoodPortionUnit>("serving");
  const [qty, setQty] = useState("1");

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2 || !catalogue) return [];
    return catalogue.filter((f) => f.name.toLowerCase().includes(q) || f.aliases.some((a) => a.toLowerCase().includes(q))).slice(0, 8);
  }, [catalogue, query]);

  const choose = (food: FoodCatalogueItem) => {
    setPicked(food);
    setUnit(food.portions.find((p) => p.isDefault)?.unit ?? food.portions[0]?.unit ?? "serving");
    setQty("1");
    setQuery("");
  };
  const grams = picked ? (picked.portions.find((p) => p.unit === unit)?.grams ?? null) : null;

  if (isError) return null; // typing still works; the picker is a convenience, not a requirement

  return (
    <div className="grid gap-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <Label htmlFor="food-search">{t("Or pick from the list")}</Label>
      <Input id="food-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search, for example eba or moi moi")} autoComplete="off" />
      {matches.length > 0 && (
        <ul className="grid gap-1" aria-label={t("Matching foods")}>
          {matches.map((f) => (
            <li key={f.code}>
              <button type="button" className="min-h-11 w-full rounded-md border px-3 py-2 text-left text-sm" onClick={() => choose(f)}>
                {f.name}
                {f.highSalt ? <Badge variant="amber" className="ml-2">{t("High salt")}</Badge> : null}
                {f.highSugar ? <Badge variant="amber" className="ml-2">{t("High sugar")}</Badge> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{picked.name}</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1">
              <Label htmlFor="food-qty" className="text-xs">{t("How many")}</Label>
              <Input id="food-qty" type="number" min={1} max={20} step={1} value={qty} onChange={(e) => setQty(e.target.value)} className="h-11 w-24" />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="food-unit" className="text-xs">{t("Measure")}</Label>
              <select
                id="food-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value as FoodPortionUnit)}
                className="h-11 rounded-md border bg-transparent px-2 text-sm"
              >
                {picked.portions.map((p) => (
                  <option key={p.unit} value={p.unit}>
                    {portionUnitLabel(p.unit, Number(qty) || 1)}
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="button"
              className="min-h-11"
              onClick={() => {
                const n = Math.min(20, Math.max(1, Math.round(Number(qty) || 1)));
                onAdd(`${n} ${portionUnitLabel(unit, n)} of ${picked.name.toLowerCase()}`);
                setPicked(null);
              }}
            >
              {t("Add")}
            </Button>
          </div>
          {/* Portion photos for each size are not supplied yet (the slots exist); until they are, the size is described in words. */}
          {grams != null && (
            <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
              {t("One")} {portionUnitLabel(unit, 1)} {t("is about")} {Math.round(grams)} g.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** Type or paste the code printed under a barcode. Looks it up in the Nigerian packaged-food list the team curates. */
export function BarcodeEntry({ onAdd }: { onAdd: (phrase: string) => void }) {
  const t = useT();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const lookup = useMutation({
    mutationFn: (c: string) => lookupBarcodeAction(c),
    onSuccess: (res) => {
      if (!res.ok) return setMessage(res.error);
      if (res.status === "invalid") return setMessage(t("That code does not look right. Check the numbers under the barcode."));
      if (res.status === "not_found") return setMessage(t("We do not have this product yet. Type what you ate instead."));
      onAdd(`1 serving of ${res.foodName.toLowerCase()}`);
      setMessage(`${res.productName}${res.nafdacNumber ? ` (NAFDAC ${res.nafdacNumber})` : ""} ${t("added.")}`);
      setCode("");
    },
    onError: () => setMessage(t("We could not look that up right now. You can still type what you ate.")),
  });
  return (
    <div className="grid gap-2 rounded-md border border-charcoal-ink/10 p-3 dark:border-night-ink/15">
      <Label htmlFor="barcode-code">{t("Packaged food? Enter the barcode number")}</Label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="barcode-code"
          inputMode="numeric"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="e.g. 6154000012345"
          className="h-11 flex-1 sm:min-w-56"
        />
        <Button type="button" variant="outline" className="min-h-11" disabled={lookup.isPending || code.trim().length < 8} onClick={() => lookup.mutate(code)}>
          {lookup.isPending ? t("Looking…") : t("Look up")}
        </Button>
      </div>
      {message && <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{message}</p>}
    </div>
  );
}

/** Daily targets with today's progress. Renders NOTHING when the database says targets are not for this person. */
export function DailyTargetsCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: g } = useNutritionGuidance();
  const mode = useMutation({
    mutationFn: (m: "numbers" | "words") => setMealSummaryModeAction(m),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [GUIDANCE_KEY] }),
  });
  if (!g || g.state === "hidden") return null;

  const modeToggle = (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("How to show a meal")}>
      <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{t("Show each meal as")}</span>
      {(["numbers", "words"] as const).map((m) => (
        <Button key={m} type="button" size="sm" variant={g.mode === m ? "default" : "outline"} className="min-h-11" aria-pressed={g.mode === m} disabled={mode.isPending} onClick={() => mode.mutate(m)}>
          {m === "numbers" ? t("Numbers") : t("Words")}
        </Button>
      ))}
    </div>
  );

  if (g.state === "needs_profile") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t("Daily targets")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">
            {t("Add your date of birth, sex, height and weight to your profile to see daily targets.")}
          </p>
          {modeToggle}
        </CardContent>
      </Card>
    );
  }

  const rows: { label: string; done: number; target: number; unit: string; kind: "aim" | "limit" }[] = [
    { label: t("Energy"), done: g.totals.caloriesKcal, target: g.targets.energyKcal, unit: "kcal", kind: "aim" },
    { label: t("Carbohydrate"), done: g.totals.carbsG, target: g.targets.carbsG, unit: "g", kind: "aim" },
    { label: t("Protein"), done: g.totals.proteinG, target: g.targets.proteinG, unit: "g", kind: "aim" },
    { label: t("Fat"), done: g.totals.fatG, target: g.targets.fatG, unit: "g", kind: "aim" },
    { label: t("Fibre"), done: g.totals.fibreG, target: g.targets.fibreG, unit: "g", kind: "aim" },
    { label: t("Salt"), done: Math.round(((g.totals.sodiumMg * 2.5) / 1000) * 10) / 10, target: g.targets.saltGMax, unit: "g", kind: "limit" },
    { label: t("Sugar"), done: g.totals.sugarG, target: g.targets.sugarGMax, unit: "g", kind: "limit" },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Today against your daily targets")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="space-y-2">
          {rows.map((r) => {
            const pct = r.target > 0 ? Math.min(100, Math.round((r.done / r.target) * 100)) : 0;
            const over = r.done > r.target;
            return (
              <li key={r.label}>
                <div className="flex justify-between text-sm">
                  <span>{r.label}</span>
                  <span>
                    {Math.round(r.done)} {t("of")} {Math.round(r.target * 10) / 10} {r.unit}
                    {r.kind === "limit" ? ` ${t("(keep under)")}` : ""}
                    {over ? ` · ${r.kind === "limit" ? t("over the limit") : t("over the target")}` : ""}
                  </span>
                </div>
                <div className="h-2 rounded-full bg-charcoal-ink/10 dark:bg-night-ink/15" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={r.label}>
                  <div className="h-2 rounded-full bg-brand-green" style={{ width: `${pct}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
        {g.totals.uncountedMeals > 0 && (
          <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
            {t("Some meals today were not matched to our food list, so these totals may be lower than the real total.")}
          </p>
        )}
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          {t("These are rough daily guides for staying where you are, not a diet. They are not medical advice. If you take medicines or have a condition, follow your care team.")}
          {g.floorApplied ? ` ${t("Your energy guide is held at a safe minimum.")}` : ""}
        </p>
        {modeToggle}
      </CardContent>
    </Card>
  );
}

/** Recent meals and favourites, each logged again in one tap. */
export function RepeatAndFavourites({ patientId, entries }: { patientId: string; entries: NutritionEntry[] | undefined }) {
  const t = useT();
  const queryClient = useQueryClient();
  const { data: favourites } = useFavourites(patientId);
  const [message, setMessage] = useState<string | null>(null);
  const [naming, setNaming] = useState<string | null>(null);
  const [name, setName] = useState("");

  const recent = useMemo(() => {
    const seen = new Set<string>();
    const out: NutritionEntry[] = [];
    for (const e of entries ?? []) {
      const key = (e.description ?? "").trim().toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(e);
      if (out.length === 5) break;
    }
    return out;
  }, [entries]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
    queryClient.invalidateQueries({ queryKey: [GUIDANCE_KEY] });
    queryClient.invalidateQueries({ queryKey: [FAVOURITES_KEY, patientId] });
  };
  const repeat = useMutation({
    mutationFn: (id: string) => repeatMealAction(id),
    onSuccess: (res) => {
      if (res?.error) return setMessage(res.error);
      setMessage(t("Logged again."));
      refresh();
    },
  });
  const logFav = useMutation({
    mutationFn: (id: string) => logFavouriteAction(id),
    onSuccess: (res) => {
      if (res?.error) return setMessage(res.error);
      setMessage(t("Logged."));
      refresh();
    },
  });
  const removeFav = useMutation({ mutationFn: (id: string) => deleteFavouriteAction(id), onSuccess: refresh });
  const saveFav = useMutation({
    mutationFn: async (entryId: string) => {
      const fd = new FormData();
      fd.set("entry_id", entryId);
      fd.set("name", name);
      return saveFavouriteAction(undefined, fd);
    },
    onSuccess: (res) => {
      if (res?.error) return setMessage(res.error);
      setNaming(null);
      setName("");
      setMessage(t("Saved to your favourites."));
      refresh();
    },
  });

  if (recent.length === 0 && (favourites?.length ?? 0) === 0) return null;
  const busy = repeat.isPending || logFav.isPending;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("Log again in one tap")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {(favourites?.length ?? 0) > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">{t("Favourites")}</p>
            <ul className="space-y-2">
              {favourites!.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{f.name}</p>
                    <p className="truncate text-xs text-charcoal-ink/60 dark:text-night-ink/60">{f.description}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" className="min-h-11" disabled={busy} onClick={() => logFav.mutate(f.id)}>
                      {t("Log")}
                    </Button>
                    <Button type="button" variant="outline" className="min-h-11" aria-label={`${t("Remove")} ${f.name}`} disabled={removeFav.isPending} onClick={() => removeFav.mutate(f.id)}>
                      {t("Remove")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
        {recent.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-semibold">{t("Recent meals")}</p>
            <ul className="space-y-2">
              {recent.map((e) => (
                <li key={e.id} className="rounded-md border p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">{MEAL_TYPE_LABELS[e.meal_type]}</p>
                      <p className="truncate text-sm">{e.description}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" className="min-h-11" disabled={busy} onClick={() => repeat.mutate(e.id)}>
                        {t("Log again")}
                      </Button>
                      <Button type="button" variant="outline" className="min-h-11" onClick={() => { setNaming(naming === e.id ? null : e.id); setName(""); }}>
                        {t("Save")}
                      </Button>
                    </div>
                  </div>
                  {naming === e.id && (
                    <form
                      className="mt-2 flex flex-wrap gap-2"
                      onSubmit={(ev) => {
                        ev.preventDefault();
                        saveFav.mutate(e.id);
                      }}
                    >
                      <Input value={name} onChange={(ev) => setName(ev.target.value)} placeholder={t("Name, for example My usual breakfast")} maxLength={60} className="h-11 flex-1 sm:min-w-56" aria-label={t("Favourite name")} />
                      <Button type="submit" className="min-h-11" disabled={saveFav.isPending || name.trim().length === 0}>
                        {t("Save favourite")}
                      </Button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {message && <p role="status" className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{message}</p>}
      </CardContent>
    </Card>
  );
}

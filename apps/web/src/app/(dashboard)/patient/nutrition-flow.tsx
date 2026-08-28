"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { logMealAction, confirmMealAction, getBudgetAlternativeAction } from "./nutrition-actions";
import type { BudgetAlternativeState } from "./nutrition-actions";
import { NutritionSupportCard } from "./nutrition-support-card";
import { useNutritionEntries, type NutritionEntry } from "@/lib/queries/nutrition";
import { useFoodCatalogue } from "@/lib/queries/food-catalogue";
import { MEAL_TYPES, MEAL_TYPE_LABELS } from "@/lib/validation/nutrition";
import { getConditionNutritionGuidance, type CarePlanCondition } from "@/lib/nutrition/condition-guidance";
import { pickDominantContributor, suggestSubstitution } from "@/lib/nutrition/substitutions";
import type { NutritionAnalysisResult } from "@/lib/nutrition/nutrition-analysis";
import type { ParsedFoodItem } from "@/lib/nutrition/food-parser";
import type { FoodCatalogueItem } from "@/lib/nutrition/food-catalogue";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MEAL_TYPE_ICON } from "@/lib/icons";
import { cn } from "@/lib/utils";

const MEAL_PHOTO_BUCKET = "meal-photos";
const ENTRIES_KEY = "nutrition-entries";

interface MealEstimateShape {
  items?: { name: string; portion: string; est_carbs_g: number }[];
  est_carbs_g?: number;
  est_calories?: number;
  confidence?: "low" | "medium" | "high";
  notes?: string | null;
}

function lagosDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NutritionFlow({
  patientId,
  visionConfigured,
  activeConditions,
}: {
  patientId: string;
  visionConfigured: boolean;
  activeConditions: CarePlanCondition[];
}) {
  return (
    <div className="space-y-6">
      <LogMealSection patientId={patientId} visionConfigured={visionConfigured} />
      <MealHistorySection patientId={patientId} activeConditions={activeConditions} />
      <NutritionSupportCard patientId={patientId} activeConditions={activeConditions} />
      <BudgetHelperSection />
    </div>
  );
}

function LogMealSection({
  patientId,
  visionConfigured,
}: {
  patientId: string;
  visionConfigured: boolean;
}) {
  const queryClient = useQueryClient();
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mealType, setMealType] = useState<(typeof MEAL_TYPES)[number]>("lunch");

  const mutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not signed in");

      if (file) {
        const ext = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from(MEAL_PHOTO_BUCKET)
          .upload(path, file, { contentType: file.type, upsert: false });
        if (uploadError) throw uploadError;
        formData.set("photo_path", path);
      }

      const res = await logMealAction(undefined, formData);
      if (res?.error) throw new Error(res.error);
      return res;
    },
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
      formRef.current?.reset();
      setFile(null);
      setMealType("lunch");
      if (res?.aiStatus === "estimated") {
        setMessage("Logged. We've added an estimate below. Check and confirm it.");
      } else if (res?.aiStatus === "unavailable") {
        setMessage("Logged. We couldn't estimate this photo automatically. You can add details.");
      } else {
        setMessage("Logged.");
      }
    },
    onError: (err) => {
      setMessage(err instanceof Error ? err.message : "Something went wrong");
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Log a meal</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          ref={formRef}
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            mutation.mutate(new FormData(e.currentTarget));
          }}
        >
          <div className="grid gap-2">
            <Label>Meal</Label>
            <input type="hidden" name="meal_type" value={mealType} />
            <div className="grid grid-cols-4 gap-2">
              {MEAL_TYPES.map((t) => {
                const Icon = MEAL_TYPE_ICON[t];
                const active = mealType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setMealType(t)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border p-3 text-xs font-medium transition-colors",
                      active
                        ? "border-brand-green bg-soft-sage text-deep-forest"
                        : "border-charcoal-ink/10 text-charcoal-ink/70 hover:border-charcoal-ink/20",
                    )}
                  >
                    <Icon className="h-5 w-5" strokeWidth={2} />
                    {MEAL_TYPE_LABELS[t]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">What did you eat? (optional)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="e.g. 2 spoons of jollof rice, a piece of chicken and a bit of dodo"
              maxLength={500}
            />
            <p className="text-xs text-charcoal-ink/60">
              We&apos;ll match this against our Nigerian food list to estimate calories, carbs, protein,
              fat, fibre and sodium — you can describe portions in everyday terms like a plate, cup,
              spoon, handful, piece or serving.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="photo">Photo (optional)</Label>
            <Input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <p className="text-xs text-charcoal-ink/60">
              {visionConfigured
                ? "Add a photo and we'll estimate the portions and carbs for you: a coaching guide, not a medical measurement."
                : "Photo estimates aren't switched on yet; your meal still logs with the details you add."}
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Logging…" : "Log meal"}
            </Button>
            {message && <span className="text-sm text-charcoal-ink/70">{message}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ConfidenceBadge({ confidence }: { confidence?: "low" | "medium" | "high" }) {
  if (!confidence) return null;
  const styles: Record<string, string> = {
    low: "bg-amber-100 text-amber-800",
    medium: "bg-blue-100 text-blue-800",
    high: "bg-green-100 text-green-800",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[confidence]}`}>
      {confidence} confidence
    </span>
  );
}

/** Full macro breakdown + matched-items list from text-based food logging
 * (spec 19.4/19.5) — independent of the photo/AI-vision estimate above it. */
function NutritionAnalysisBlock({
  analysis,
  items,
}: {
  analysis: NutritionAnalysisResult;
  items: ParsedFoodItem[] | null;
}) {
  return (
    <div className="mt-2 rounded-md border border-charcoal-ink/10 p-3 text-sm">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 font-medium text-charcoal-ink sm:grid-cols-3">
        <span>~{Math.round(analysis.caloriesKcal)} kcal</span>
        <span>{Math.round(analysis.carbsG)}g carbs</span>
        <span>{Math.round(analysis.proteinG)}g protein</span>
        <span>{Math.round(analysis.fatG)}g fat</span>
        <span>{Math.round(analysis.fibreG)}g fibre</span>
        <span>{Math.round(analysis.sodiumMg)}mg sodium</span>
      </div>
      {items && items.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-charcoal-ink/70">
          {items.map((item, i) => (
            <li key={i}>
              {item.matched
                ? `${item.foodName ?? item.raw}${item.grams != null ? ` (~${Math.round(item.grams)}g)` : ""}`
                : `"${item.raw}" — not recognised, not included in the totals above`}
            </li>
          ))}
        </ul>
      )}
      {!analysis.reliable && (
        <p className="mt-2 text-xs text-amber-700">
          One or more items weren&apos;t recognised, so these totals are a partial estimate.
        </p>
      )}
      <p className="mt-2 text-xs text-charcoal-ink/50">
        From our Nigerian food list — an estimate to guide you, not a lab measurement.
      </p>
    </div>
  );
}

/** Condition-specific guidance (19.6) + a data-driven substitution suggestion
 * (19.7) for whichever logged food is driving a "watch" message. */
function GuidanceBlock({
  activeConditions,
  analysis,
  items,
  catalogue,
}: {
  activeConditions: CarePlanCondition[];
  analysis: NutritionAnalysisResult;
  items: ParsedFoodItem[] | null;
  catalogue: FoodCatalogueItem[];
}) {
  const messages = useMemo(
    () => getConditionNutritionGuidance(activeConditions, analysis),
    [activeConditions, analysis],
  );

  const watchOnSodium = messages.some((m) => m.condition === "hypertension" && m.tone === "watch");
  const watchOnCarbs = messages.some((m) => m.condition === "diabetes" && m.tone === "watch");

  const substitution = useMemo(() => {
    if (!items || catalogue.length === 0 || (!watchOnSodium && !watchOnCarbs)) return null;
    const metric = watchOnSodium ? "sodium" : "carbs";
    const foodCode = pickDominantContributor(items, catalogue, metric);
    if (!foodCode) return null;
    return suggestSubstitution({ foodCode, concern: metric, catalogue });
  }, [items, catalogue, watchOnSodium, watchOnCarbs]);

  if (messages.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {messages.map((m, i) => (
        <p
          key={i}
          className={cn(
            "rounded-md p-2 text-sm",
            m.tone === "watch" ? "bg-amber-50 text-amber-900" : "bg-soft-sage text-deep-forest",
          )}
        >
          {m.message}
        </p>
      ))}
      {substitution && (
        <p className="rounded-md bg-charcoal-ink/5 p-2 text-sm text-charcoal-ink/80">
          {substitution.message}
        </p>
      )}
    </div>
  );
}

function EntryCard({
  entry,
  patientId,
  activeConditions,
  catalogue,
}: {
  entry: NutritionEntry;
  patientId: string;
  activeConditions: CarePlanCondition[];
  catalogue: FoodCatalogueItem[];
}) {
  const queryClient = useQueryClient();
  const [carbs, setCarbs] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const estimate = (entry.ai_estimate ?? null) as MealEstimateShape | null;
  const analysis = (entry.nutrition_analysis ?? null) as unknown as NutritionAnalysisResult | null;
  const parsedItems = (entry.parsed_items ?? null) as unknown as ParsedFoodItem[] | null;

  const confirm = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.set("entry_id", entry.id);
      if (carbs.trim() !== "") fd.set("confirmed_carbs_g", carbs.trim());
      const res = await confirmMealAction(undefined, fd);
      if (res?.error) throw new Error(res.error);
    },
    onSuccess: () => {
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: [ENTRIES_KEY, patientId] });
    },
  });

  return (
    <li className="rounded-lg border border-charcoal-ink/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-medium text-charcoal-ink">
          {MEAL_TYPE_LABELS[entry.meal_type]} · {lagosDateTime(entry.logged_at)}
        </div>
        {estimate?.confidence && <ConfidenceBadge confidence={estimate.confidence} />}
      </div>

      {entry.description && (
        <p className="mt-1 text-sm text-charcoal-ink/70">{entry.description}</p>
      )}
      {entry.photo_path && (
        <p className="mt-1 text-xs text-charcoal-ink/50">📷 Photo attached</p>
      )}

      {entry.ai_status === "unavailable" && !estimate && (
        <p className="mt-2 text-xs text-charcoal-ink/50">No automatic estimate for this meal.</p>
      )}

      {estimate && (
        <div className="mt-2 rounded-md bg-charcoal-ink/5 p-3 text-sm">
          <div className="font-medium text-charcoal-ink">
            ~{Math.round(estimate.est_carbs_g ?? 0)} g carbs
            {typeof estimate.est_calories === "number"
              ? ` · ~${Math.round(estimate.est_calories)} kcal`
              : ""}
          </div>
          {estimate.items && estimate.items.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-charcoal-ink/70">
              {estimate.items.map((item, i) => (
                <li key={i}>
                  {item.name}, {item.portion} (~{Math.round(item.est_carbs_g)} g)
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-charcoal-ink/50">
            Photo estimate — coaching guidance only, not a medical measurement.
          </p>
        </div>
      )}

      {analysis && <NutritionAnalysisBlock analysis={analysis} items={parsedItems} />}

      {analysis?.reliable && (
        <GuidanceBlock
          activeConditions={activeConditions}
          analysis={analysis}
          items={parsedItems}
          catalogue={catalogue}
        />
      )}

      {!entry.patient_confirmed && (estimate || entry.ai_status === "unavailable") && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="grid gap-1">
            <Label htmlFor={`carbs-${entry.id}`} className="text-xs">
              Adjust carbs (g, optional)
            </Label>
            <Input
              id={`carbs-${entry.id}`}
              type="number"
              min={0}
              max={2000}
              value={carbs}
              onChange={(e) => setCarbs(e.target.value)}
              className="h-9 w-32"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={confirm.isPending}
            onClick={() => confirm.mutate()}
          >
            {confirm.isPending ? "Saving…" : "Confirm"}
          </Button>
        </div>
      )}

      {(entry.patient_confirmed || saved) && (
        <p className="mt-2 text-xs font-medium text-brand-green">
          Confirmed
          {entry.confirmed_carbs_g != null ? ` · ${Math.round(entry.confirmed_carbs_g)} g carbs` : ""}
        </p>
      )}
    </li>
  );
}

function lagosDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
}

function dateGroupLabel(dateKey: string): string {
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", {
    timeZone: "Africa/Lagos",
  });
  if (dateKey === today) return "Today";
  if (dateKey === yesterday) return "Yesterday";
  return new Date(dateKey).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function MealHistorySection({
  patientId,
  activeConditions,
}: {
  patientId: string;
  activeConditions: CarePlanCondition[];
}) {
  const { data: entries, isLoading } = useNutritionEntries(patientId);
  const { data: catalogue } = useFoodCatalogue();

  const grouped = useMemo(() => {
    const rows = entries ?? [];
    const map = new Map<string, NutritionEntry[]>();
    for (const row of rows) {
      const key = lagosDateKey(row.logged_at);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [entries]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent meals</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {!isLoading && (!entries || entries.length === 0) && (
          <p className="text-sm text-charcoal-ink/60">No meals logged yet.</p>
        )}
        {grouped.length > 0 && (
          <div className="space-y-5">
            {grouped.map(([dateKey, rows]) => (
              <div key={dateKey}>
                <p className="mb-2 text-sm font-semibold text-charcoal-ink">{dateGroupLabel(dateKey)}</p>
                <ul className="space-y-3">
                  {rows.map((entry) => (
                    <EntryCard
                      key={entry.id}
                      entry={entry}
                      patientId={patientId}
                      activeConditions={activeConditions}
                      catalogue={catalogue ?? []}
                    />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Budget-aware substitution (spec 19.9): "I cannot afford X". */
function BudgetHelperSection() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<BudgetAlternativeState | null>(null);

  const mutation = useMutation({
    mutationFn: (q: string) => getBudgetAlternativeAction(q),
    onSuccess: (res) => setResult(res),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Need a cheaper option?</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          Tell us what you can&apos;t afford right now, and we&apos;ll suggest a local, budget-friendly
          swap with a similar role on the plate.
        </p>
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setResult(null);
            if (query.trim()) mutation.mutate(query);
          }}
        >
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. I can't afford salmon"
            className="flex-1 sm:min-w-64"
          />
          <Button type="submit" disabled={mutation.isPending || !query.trim()}>
            {mutation.isPending ? "Checking…" : "Suggest"}
          </Button>
        </form>
        {result && "error" in result && <p className="text-sm text-red-600">{result.error}</p>}
        {result && "notFound" in result && (
          <p className="text-sm text-charcoal-ink/60">
            We don&apos;t have a specific suggestion for that yet — generally affordable everyday
            options include beans, eggs, garri and seasonal vegetables.
          </p>
        )}
        {result && "message" in result && (
          <p className="text-sm text-charcoal-ink/80">{result.message}</p>
        )}
      </CardContent>
    </Card>
  );
}

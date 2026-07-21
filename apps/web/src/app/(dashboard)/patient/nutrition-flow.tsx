"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { logMealAction, confirmMealAction } from "./nutrition-actions";
import { useNutritionEntries, type NutritionEntry } from "@/lib/queries/nutrition";
import { MEAL_TYPES, MEAL_TYPE_LABELS } from "@/lib/validation/nutrition";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

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
}: {
  patientId: string;
  visionConfigured: boolean;
}) {
  return (
    <div className="space-y-6">
      <LogMealSection patientId={patientId} visionConfigured={visionConfigured} />
      <MealHistorySection patientId={patientId} />
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
      if (res?.aiStatus === "estimated") {
        setMessage("Logged. We've added an estimate below — check and confirm it.");
      } else if (res?.aiStatus === "unavailable") {
        setMessage("Logged. We couldn't estimate this photo automatically — you can add details.");
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
            <Label htmlFor="meal_type">Meal</Label>
            <Select id="meal_type" name="meal_type" defaultValue="lunch" required>
              {MEAL_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MEAL_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="description">What did you eat? (optional)</Label>
            <Textarea
              id="description"
              name="description"
              placeholder="e.g. jollof rice with chicken and a bit of dodo"
              maxLength={500}
            />
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
                ? "Add a photo and we'll estimate the portions and carbs for you — a coaching guide, not a medical measurement."
                : "Photo estimates aren't switched on yet — your meal still logs with the details you add."}
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

function EntryCard({ entry, patientId }: { entry: NutritionEntry; patientId: string }) {
  const queryClient = useQueryClient();
  const [carbs, setCarbs] = useState<string>("");
  const [saved, setSaved] = useState(false);
  const estimate = (entry.ai_estimate ?? null) as MealEstimateShape | null;

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
                  {item.name} — {item.portion} (~{Math.round(item.est_carbs_g)} g)
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-charcoal-ink/50">
            Coaching estimate only — not a medical measurement.
          </p>
        </div>
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

function MealHistorySection({ patientId }: { patientId: string }) {
  const { data: entries, isLoading } = useNutritionEntries(patientId);

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
        {entries && entries.length > 0 && (
          <ul className="space-y-3">
            {entries.map((entry) => (
              <EntryCard key={entry.id} entry={entry} patientId={patientId} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

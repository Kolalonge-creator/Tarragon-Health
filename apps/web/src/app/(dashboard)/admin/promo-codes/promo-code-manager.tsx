"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

const ORDER_TYPES = ["lab", "pharmacy", "referral"] as const;

interface PromoCodeRow {
  id: string;
  code: string;
  kind: "percentage" | "fixed_amount";
  value_bp: number | null;
  value_kobo: number | null;
  applicable_order_types: string[];
  max_redemptions: number | null;
  per_profile_limit: number;
  min_spend_kobo: number;
  starts_at: string;
  expires_at: string | null;
  is_active: boolean;
  created_at: string;
}

function usePromoCodes() {
  return useQuery({
    queryKey: ["admin", "promo-codes"],
    queryFn: async () => {
      const { data, error } = await createClient()
        .from("promo_codes")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as PromoCodeRow[];
    },
  });
}

function describeValue(row: PromoCodeRow): string {
  if (row.kind === "percentage") return `${(row.value_bp ?? 0) / 100}% off`;
  return `₦${((row.value_kobo ?? 0) / 100).toLocaleString()} off`;
}

export function PromoCodeManager() {
  const queryClient = useQueryClient();
  const { data: codes } = usePromoCodes();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [orderTypes, setOrderTypes] = useState<string[]>([...ORDER_TYPES]);

  const create = useMutation({
    mutationFn: async (input: {
      code: string;
      kind: "percentage" | "fixed_amount";
      value: number;
      applicableOrderTypes: string[];
      maxRedemptions: number | null;
      perProfileLimit: number;
      minSpendNaira: number;
      expiresAt: string | null;
    }) => {
      const { error: err } = await createClient().rpc("create_promo_code", {
        p_code: input.code,
        p_kind: input.kind,
        p_value: input.value,
        p_applicable_order_types: input.applicableOrderTypes,
        p_max_redemptions: input.maxRedemptions ?? undefined,
        p_per_profile_limit: input.perProfileLimit,
        p_min_spend_kobo: Math.round(input.minSpendNaira * 100),
        p_expires_at: input.expiresAt ?? undefined,
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Code created.");
      queryClient.invalidateQueries({ queryKey: ["admin", "promo-codes"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not create code"),
  });

  const setActive = useMutation({
    mutationFn: async (input: { id: string; isActive: boolean }) => {
      const { error: err } = await createClient().rpc("set_promo_code_active", {
        p_id: input.id,
        p_is_active: input.isActive,
      });
      if (err) throw err;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin", "promo-codes"] }),
    onError: (e) => setError(e instanceof Error ? e.message : "Could not update code"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>New promo code</CardTitle>
          <CardDescription>
            Applies only to one-off lab, pharmacy, and referral orders, not subscriptions or
            video visits, which are billed as recurring provider objects and cannot take a
            per-order discount this way.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              setMessage(null);
              setError(null);
              const form = new FormData(e.currentTarget);
              const kind = form.get("kind") as "percentage" | "fixed_amount";
              const expiresAtRaw = String(form.get("expires_at") ?? "").trim();
              create.mutate({
                code: String(form.get("code") ?? "").trim(),
                kind,
                value: Number(form.get("value")),
                applicableOrderTypes: orderTypes,
                maxRedemptions: form.get("max_redemptions") ? Number(form.get("max_redemptions")) : null,
                perProfileLimit: Number(form.get("per_profile_limit") || 1),
                minSpendNaira: Number(form.get("min_spend_naira") || 0),
                expiresAt: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : null,
              });
              e.currentTarget.reset();
              setOrderTypes([...ORDER_TYPES]);
            }}
          >
            <label className="block text-sm">
              <span className="text-charcoal-ink">Code</span>
              <Input name="code" required minLength={3} placeholder="WELCOME20" />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Kind</span>
              <select name="kind" className="mt-1 w-full rounded-md border px-3 py-2 text-sm" defaultValue="percentage">
                <option value="percentage">Percentage off</option>
                <option value="fixed_amount">Fixed amount off (₦)</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Value (% or ₦)</span>
              <Input name="value" type="number" step="0.01" min="0.01" required />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Minimum spend (₦, optional)</span>
              <Input name="min_spend_naira" type="number" step="0.01" min="0" defaultValue={0} />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Max total redemptions (optional)</span>
              <Input name="max_redemptions" type="number" min="1" />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Max uses per patient</span>
              <Input name="per_profile_limit" type="number" min="1" defaultValue={1} />
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="text-charcoal-ink">Expires (optional)</span>
              <Input name="expires_at" type="date" />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="text-sm text-charcoal-ink">Applies to</legend>
              <div className="mt-1 flex gap-4">
                {ORDER_TYPES.map((t) => (
                  <Label key={t} className="flex items-center gap-2 text-sm font-normal capitalize">
                    <input
                      type="checkbox"
                      checked={orderTypes.includes(t)}
                      onChange={(e) =>
                        setOrderTypes((prev) =>
                          e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                        )
                      }
                    />
                    {t}
                  </Label>
                ))}
              </div>
            </fieldset>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={create.isPending || orderTypes.length === 0}>
                {create.isPending ? "Creating…" : "Create code"}
              </Button>
              {orderTypes.length === 0 && (
                <p className="mt-1 text-xs text-red-600">Pick at least one order type.</p>
              )}
            </div>
          </form>
          {message && <p className="mt-3 text-sm text-brand-green">{message}</p>}
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Existing codes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-charcoal-ink/10 text-left">
                  <th className="py-2 pr-4 font-medium">Code</th>
                  <th className="py-2 pr-4 font-medium">Value</th>
                  <th className="py-2 pr-4 font-medium">Applies to</th>
                  <th className="py-2 pr-4 font-medium">Limits</th>
                  <th className="py-2 pr-4 font-medium">Expires</th>
                  <th className="py-2 pr-4 font-medium">Status</th>
                  <th className="py-2 pr-4 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(codes ?? []).map((row) => (
                  <tr key={row.id} className="border-b border-charcoal-ink/5">
                    <td className="py-2 pr-4 font-mono">{row.code}</td>
                    <td className="py-2 pr-4">{describeValue(row)}</td>
                    <td className="py-2 pr-4 capitalize">{row.applicable_order_types.join(", ")}</td>
                    <td className="py-2 pr-4">
                      {row.per_profile_limit}/patient
                      {row.max_redemptions ? `, ${row.max_redemptions} total` : ""}
                    </td>
                    <td className="py-2 pr-4">
                      {row.expires_at ? new Date(row.expires_at).toLocaleDateString("en-NG") : "—"}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge variant={row.is_active ? "green" : "grey"}>
                        {row.is_active ? "active" : "inactive"}
                      </Badge>
                    </td>
                    <td className="py-2 pr-4">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setActive.mutate({ id: row.id, isActive: !row.is_active })}
                      >
                        {row.is_active ? "Deactivate" : "Activate"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {(codes ?? []).length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-6 text-center text-charcoal-ink/50">
                      No promo codes yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

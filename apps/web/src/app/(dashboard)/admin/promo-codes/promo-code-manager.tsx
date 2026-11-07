"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";

/** Mirrors the database CHECK on promo_codes.applicable_order_types (20260901174915_promo_codes_service_purchases.sql).
 * service_purchase is the pay-per-item doctor time on /patient/subscription (Ask a doctor, video visit credits and the rest). */
const ORDER_TYPES = ["lab", "pharmacy", "referral", "service_purchase"] as const;
const ORDER_TYPE_LABEL: Record<(typeof ORDER_TYPES)[number], string> = {
  lab: "Laboratory orders",
  pharmacy: "Pharmacy orders",
  referral: "Referral orders",
  service_purchase: "Doctor-time purchases (Ask a doctor, video visit and the other per-item services)",
};
/** What a new code applies to before the admin touches the boxes: the three order kinds this page always covered. Doctor-time
 * purchases are opted into on purpose, so a code meant for the laboratory does not quietly discount a senior case review. */
const DEFAULT_ORDER_TYPES: readonly string[] = ["lab", "pharmacy", "referral"];
function orderTypeLabel(t: string): string {
  return (ORDER_TYPE_LABEL as Record<string, string>)[t] ?? t;
}

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
  const [orderTypes, setOrderTypes] = useState<string[]>([...DEFAULT_ORDER_TYPES]);

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
            Applies to one-off laboratory, pharmacy and referral orders, and to the doctor-time services a
            patient buys per item. The Membership and the other items sold at Membership checkout take a
            different kind of code, managed on the <a href="/admin/discount-codes" className="underline">Membership discount codes</a> page.
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
              setOrderTypes([...DEFAULT_ORDER_TYPES]);
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
              <div className="mt-1 flex flex-col gap-2">
                {ORDER_TYPES.map((t) => (
                  <Label key={t} className="flex items-center gap-2 text-sm font-normal">
                    <input
                      type="checkbox"
                      checked={orderTypes.includes(t)}
                      onChange={(e) =>
                        setOrderTypes((prev) =>
                          e.target.checked ? [...prev, t] : prev.filter((x) => x !== t),
                        )
                      }
                    />
                    {orderTypeLabel(t)}
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
          <DataTable
            caption="Promo codes"
            columns={[
              { header: "Code", sortable: true },
              { header: "Value" },
              { header: "Applies to" },
              { header: "Limits" },
              { header: "Expires", sortable: true },
              { header: "Status", sortable: true },
              { header: "Actions" },
            ]}
            rows={(codes ?? []).map((row) => ({
              key: row.id,
              searchText: `${row.code} ${describeValue(row)} ${row.applicable_order_types.map(orderTypeLabel).join(" ")}`,
              sort: [row.code, null, null, null, row.expires_at, row.is_active ? 0 : 1, null],
              cells: [
                <span key="c" className="font-mono">{row.code}</span>,
                describeValue(row),
                row.applicable_order_types.map(orderTypeLabel).join(", "),
                `${row.per_profile_limit}/patient${row.max_redemptions ? `, ${row.max_redemptions} total` : ""}`,
                row.expires_at ? new Date(row.expires_at).toLocaleDateString("en-NG", { timeZone: "Africa/Lagos" }) : "—",
                <Badge key="s" variant={row.is_active ? "green" : "grey"}>{row.is_active ? "active" : "inactive"}</Badge>,
                <Button key="a" variant="outline" size="sm" onClick={() => setActive.mutate({ id: row.id, isActive: !row.is_active })}>
                  {row.is_active ? "Deactivate" : "Activate"}
                </Button>,
              ],
            }))}
            searchLabel="Search promo codes"
            emptyMessage="No promo codes yet."
            noun={{ one: "promo code", many: "promo codes" }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

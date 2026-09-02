"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { koboToNaira } from "@tarragon/shared";

const naira = (kobo: number) => `₦${koboToNaira(kobo).toLocaleString()}`;

const STATUS_VARIANT: Record<string, "green" | "grey" | "amber"> = {
  active: "green",
  reserved: "amber",
  redeemed: "grey",
  expired: "grey",
  cancelled: "grey",
};

function useConfig() {
  return useQuery({
    queryKey: ["admin", "voucher-config"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_voucher_config")
        .select("*")
        .eq("id", true)
        .single();
      if (error) throw error;
      return data;
    },
  });
}

/** Vouchers that a human is most likely to be asked about: expiring soon,
 * already expired, or still being paid off. Deliberately not a full browse of
 * every voucher ever issued — a healthy, unredeemed 'active' voucher (the
 * common case) has no reason to appear here; that one is found by number via
 * the lookup tool below when a cancellation is actually needed. */
function useVouchersNeedingAttention() {
  return useQuery({
    queryKey: ["admin", "vouchers-attention"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_vouchers")
        .select("*")
        .in("status", ["reserved", "expired"])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    },
  });
}

function useVoucherLookup(voucherNumber: string) {
  return useQuery({
    queryKey: ["admin", "voucher-lookup", voucherNumber],
    enabled: voucherNumber.trim().length > 0,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("care_vouchers")
        .select("*")
        .eq("voucher_number", voucherNumber.trim())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function VoucherManager() {
  const queryClient = useQueryClient();
  const { data: config } = useConfig();
  const { data: vouchers } = useVouchersNeedingAttention();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lookupNumber, setLookupNumber] = useState("");
  const { data: lookedUpVoucher, isFetching: lookingUp } = useVoucherLookup(lookupNumber);

  const saveConfig = useMutation({
    mutationFn: async (input: {
      validity_months: number;
      max_extensions: number;
      extension_months: number;
      min_instalment_kobo: number;
    }) => {
      const supabase = createClient();
      const { error: err } = await supabase
        .from("care_voucher_config")
        .update({ ...input, updated_at: new Date().toISOString() })
        .eq("id", true);
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Saved.");
      queryClient.invalidateQueries({ queryKey: ["admin", "voucher-config"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not save"),
  });

  const extend = useMutation({
    mutationFn: async (voucherId: string) => {
      const supabase = createClient();
      const { error: err } = await supabase.rpc("extend_care_voucher", {
        p_voucher: voucherId,
        p_reason: "Extended on request",
      });
      if (err) throw err;
    },
    onSuccess: () => {
      setMessage("Extended.");
      queryClient.invalidateQueries({ queryKey: ["admin", "vouchers-attention"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not extend"),
  });

  const cancel = useMutation({
    mutationFn: async (input: { voucherId: string; reason: string }) => {
      const supabase = createClient();
      const { data, error: err } = await supabase.rpc("cancel_care_voucher", {
        p_voucher: input.voucherId,
        p_reason: input.reason,
      });
      if (err) throw err;
      return data as { refunds_queued?: number } | null;
    },
    onSuccess: (data) => {
      const n = data?.refunds_queued ?? 0;
      setMessage(
        n > 0
          ? `Cancelled — ${n} refund${n === 1 ? "" : "s"} queued, processed overnight.`
          : "Cancelled. Nothing was paid, so no refund is owed.",
      );
      queryClient.invalidateQueries({ queryKey: ["admin", "vouchers-attention"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not cancel"),
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Voucher settings</CardTitle>
          <CardDescription>
            The validity window applies from the day a voucher is fully paid for, not from the day
            it is reserved, so a long instalment plan never eats into it.
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
              saveConfig.mutate({
                validity_months: Number(form.get("validity_months")),
                max_extensions: Number(form.get("max_extensions")),
                extension_months: Number(form.get("extension_months")),
                min_instalment_kobo: Number(form.get("min_instalment_naira")) * 100,
              });
            }}
          >
            <label className="block text-sm">
              <span className="text-charcoal-ink">Valid for (months)</span>
              <Input
                name="validity_months"
                type="number"
                min={1}
                max={120}
                defaultValue={config?.validity_months ?? 24}
                className="mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Smallest instalment (₦)</span>
              <Input
                name="min_instalment_naira"
                type="number"
                min={1}
                defaultValue={koboToNaira(config?.min_instalment_kobo ?? 100000)}
                className="mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Extensions allowed per voucher</span>
              <Input
                name="max_extensions"
                type="number"
                min={0}
                defaultValue={config?.max_extensions ?? 2}
                className="mt-1"
              />
            </label>
            <label className="block text-sm">
              <span className="text-charcoal-ink">Each extension adds (months)</span>
              <Input
                name="extension_months"
                type="number"
                min={1}
                max={60}
                defaultValue={config?.extension_months ?? 12}
                className="mt-1"
              />
            </label>
            <div className="sm:col-span-2">
              <Button type="submit" size="sm" disabled={saveConfig.isPending}>
                {saveConfig.isPending ? "Saving…" : "Save settings"}
              </Button>
              {message && <span className="pl-3 text-sm text-emerald-700">{message}</span>}
              {error && <span className="pl-3 text-sm text-red-600">{error}</span>}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Needs a look</CardTitle>
          <CardDescription>
            Vouchers still being paid off, and ones that ran out unused. Someone asking about an
            expired voucher should normally get it back: they paid for care and have not had it
            yet.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {(vouchers ?? []).length === 0 && (
            <p className="text-sm text-charcoal-ink/60">Nothing waiting.</p>
          )}
          <ul className="space-y-2">
            {(vouchers ?? []).map((v) => (
              <li
                key={v.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b border-charcoal-ink/10 pb-2 text-sm"
              >
                <span className="text-charcoal-ink/80">
                  {v.sku_name ?? "Care voucher"}{" "}
                  <span className="text-charcoal-ink/40">{v.voucher_number}</span>
                  <span className="text-charcoal-ink/40">
                    {" "}
                    · {naira(v.amount_paid_kobo)} of {naira(v.face_value_kobo)} paid
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={STATUS_VARIANT[v.status] ?? "grey"}>{v.status}</Badge>
                  {v.status === "expired" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={extend.isPending}
                      onClick={() => {
                        setMessage(null);
                        setError(null);
                        extend.mutate(v.id);
                      }}
                    >
                      Put it back
                    </Button>
                  )}
                  {v.status !== "expired" && v.status !== "cancelled" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={cancel.isPending}
                      onClick={() => {
                        const reason = window.prompt("Reason for cancelling this voucher?");
                        if (!reason?.trim()) return;
                        setMessage(null);
                        setError(null);
                        cancel.mutate({ voucherId: v.id, reason: reason.trim() });
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cancel a voucher</CardTitle>
          <CardDescription>
            Look up any voucher by number to cancel it. A paid, un-redeemed voucher queues a real
            refund to the original card — nothing is ever paid out as cash. A voucher that has
            already been redeemed cannot be cancelled here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            placeholder="Voucher number"
            value={lookupNumber}
            onChange={(e) => setLookupNumber(e.target.value)}
            className="max-w-xs"
          />
          {lookingUp && <p className="text-sm text-charcoal-ink/50">Looking up…</p>}
          {!lookingUp && lookupNumber.trim() && !lookedUpVoucher && (
            <p className="text-sm text-charcoal-ink/50">No voucher with that number.</p>
          )}
          {lookedUpVoucher && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-charcoal-ink/10 p-3 text-sm">
              <span>
                {lookedUpVoucher.sku_name ?? "Care voucher"}{" "}
                <span className="text-charcoal-ink/40">{lookedUpVoucher.voucher_number}</span>
                <span className="text-charcoal-ink/40">
                  {" "}
                  · {naira(lookedUpVoucher.amount_paid_kobo)} of {naira(lookedUpVoucher.face_value_kobo)} paid
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Badge variant={STATUS_VARIANT[lookedUpVoucher.status] ?? "grey"}>
                  {lookedUpVoucher.status}
                </Badge>
                {lookedUpVoucher.status !== "redeemed" && lookedUpVoucher.status !== "cancelled" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={cancel.isPending}
                    onClick={() => {
                      const reason = window.prompt("Reason for cancelling this voucher?");
                      if (!reason?.trim()) return;
                      setMessage(null);
                      setError(null);
                      cancel.mutate({ voucherId: lookedUpVoucher.id, reason: reason.trim() });
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </span>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

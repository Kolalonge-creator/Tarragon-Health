"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type WalletComplianceFlagRow = {
  id: string;
  wallet_id: string;
  flag_type: "kyc_cap_exceeded" | "large_sponsor_topup" | "multi_wallet_sponsor";
  detail: Record<string, unknown>;
  status: "open" | "reviewed" | "dismissed";
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  health_wallets: { profile_id: string; profiles: { full_name: string | null } | null } | null;
};

const FLAG_LABEL: Record<WalletComplianceFlagRow["flag_type"], string> = {
  kyc_cap_exceeded: "Over KYC-tier balance cap",
  large_sponsor_topup: "Large sponsor top-up",
  multi_wallet_sponsor: "One payer funding several wallets",
};

function formatKobo(value: unknown): string {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "—";
  return `₦${(n / 100).toLocaleString()}`;
}

function DetailLine({ flag }: { flag: WalletComplianceFlagRow }) {
  const d = flag.detail;
  switch (flag.flag_type) {
    case "kyc_cap_exceeded":
      return (
        <span>
          Balance {formatKobo(d.balance_kobo)} exceeds the {String(d.tier ?? "default")} tier cap of{" "}
          {formatKobo(d.cap_kobo)}.
        </span>
      );
    case "large_sponsor_topup":
      return <span>A single sponsor top-up of {formatKobo(d.amount_kobo)}.</span>;
    case "multi_wallet_sponsor":
      return (
        <span>
          Same payer sponsor-topped-up {String(d.distinct_other_wallets_30d ?? "?")} other wallets in
          the last 30 days.
        </span>
      );
    default:
      return null;
  }
}

export function WalletComplianceManager({
  initialFlags,
  tierLimits,
}: {
  initialFlags: WalletComplianceFlagRow[];
  tierLimits: { tier: string; max_balance_kobo: number | null }[];
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [filter, setFilter] = useState<"open" | "all">("open");
  const [limits, setLimits] = useState(tierLimits);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function setStatus(id: string, status: "reviewed" | "dismissed") {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const { error: updateError } = await supabase
        .from("wallet_compliance_flags")
        .update({ status, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() })
        .eq("id", id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setFlags((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, status, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() } : f
        )
      );
    });
  }

  function saveLimit(tier: string, nairaValue: string) {
    setError(null);
    const kobo = nairaValue.trim() === "" ? null : Math.round(Number(nairaValue) * 100);
    if (nairaValue.trim() !== "" && (!Number.isFinite(kobo) || (kobo ?? 0) <= 0)) {
      setError("Enter a positive naira amount, or leave blank for unlimited.");
      return;
    }
    startTransition(async () => {
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("wallet_kyc_tier_limits")
        .update({ max_balance_kobo: kobo, updated_at: new Date().toISOString() })
        .eq("tier", tier);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setLimits((prev) => prev.map((l) => (l.tier === tier ? { ...l, max_balance_kobo: kobo } : l)));
    });
  }

  const visible = filter === "open" ? flags.filter((f) => f.status === "open") : flags;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Tier balance caps</CardTitle>
          <CardDescription>
            Placeholder figures matching CBN&apos;s published tiered-KYC shape — confirm exact
            amounts with counsel/CBN before relying on them for a real license position.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {limits.map((l) => (
            <div key={l.tier} className="space-y-1">
              <Label htmlFor={`limit-${l.tier}`}>
                {l.tier === "identity_verified" ? "Identity-verified tier (₦)" : "Default tier (₦)"}
              </Label>
              <Input
                id={`limit-${l.tier}`}
                type="number"
                min={0}
                defaultValue={l.max_balance_kobo != null ? l.max_balance_kobo / 100 : ""}
                placeholder="Unlimited"
                onBlur={(e) => saveLimit(l.tier, e.target.value)}
                disabled={pending}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Flagged activity</CardTitle>
              <CardDescription>
                Never blocks a credit — for review only. {flags.filter((f) => f.status === "open").length}{" "}
                open.
              </CardDescription>
            </div>
            <div className="flex gap-2 text-xs">
              <button
                type="button"
                className={`rounded-full border px-3 py-1 font-medium ${
                  filter === "open"
                    ? "border-brand-green bg-brand-green/10 text-brand-green"
                    : "border-charcoal-ink/20 text-charcoal-ink/70"
                }`}
                onClick={() => setFilter("open")}
              >
                Open
              </button>
              <button
                type="button"
                className={`rounded-full border px-3 py-1 font-medium ${
                  filter === "all"
                    ? "border-brand-green bg-brand-green/10 text-brand-green"
                    : "border-charcoal-ink/20 text-charcoal-ink/70"
                }`}
                onClick={() => setFilter("all")}
              >
                All
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {visible.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">Nothing to review.</p>
          ) : (
            visible.map((flag) => (
              <div key={flag.id} className="rounded-md border border-charcoal-ink/10 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-charcoal-ink">
                      {flag.health_wallets?.profiles?.full_name ?? "Unknown patient"}
                    </span>
                    <Badge variant={flag.status === "open" ? "amber" : "grey"}>
                      {FLAG_LABEL[flag.flag_type]}
                    </Badge>
                    <span className="text-xs text-charcoal-ink/50">
                      {new Date(flag.created_at).toLocaleDateString("en-GB")}
                    </span>
                  </div>
                  {flag.status === "open" && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setStatus(flag.id, "reviewed")}
                      >
                        Mark reviewed
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={pending}
                        onClick={() => setStatus(flag.id, "dismissed")}
                      >
                        Dismiss
                      </Button>
                    </div>
                  )}
                </div>
                <p className="mt-1 text-sm text-charcoal-ink/70">
                  <DetailLine flag={flag} />
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}

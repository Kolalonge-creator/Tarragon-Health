"use client";

import { useState } from "react";
import {
  useWellnessPointsBalance,
  useWellnessPointsLedger,
  useRedeemWellnessPoints,
} from "@/lib/queries/wellness";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEMANTIC_ICON } from "@/lib/icons";
import { koboToNaira } from "@tarragon/shared";

const REASON_LABEL: Record<string, string> = {
  vitals_logged: "Logged a vitals reading",
  meal_logged: "Logged a meal",
  adherence_checkin_completed: "Answered a medication check-in",
  education_lesson_completed: "Completed a lesson",
  lpe_task_completed: "Completed a lifestyle task",
  lpe_goal_achieved: "Achieved a lifestyle goal",
  challenge_completed: "Completed a challenge",
  wellness_class_attended: "Attended a class",
  redeemed_to_voucher: "Redeemed for a voucher",
};

function reasonLabel(reason: string): string {
  return REASON_LABEL[reason] ?? reason.replace(/_/g, " ");
}

export function WellnessPointsCard({ patientId }: { patientId: string }) {
  const { data: balance, isLoading } = useWellnessPointsBalance(patientId);
  const { data: ledger } = useWellnessPointsLedger(patientId, 8);
  const redeem = useRedeemWellnessPoints(patientId);
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const currentBalance = balance?.balance ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.points className="h-5 w-5 text-sprout-gold" strokeWidth={2} aria-hidden />
          Wellness points
        </CardTitle>
        <CardDescription>
          Earn points for logging vitals, meals, and check-ins, finishing lessons, and hitting
          challenges. Redeem any time for a reward voucher you can put toward your care.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {!isLoading && (
          <div className="flex items-baseline gap-2">
            <span className="font-heading text-3xl font-bold text-charcoal-ink dark:text-night-ink">
              {currentBalance.toLocaleString()}
            </span>
            <span className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              points{balance?.lifetime_earned ? ` · ${balance.lifetime_earned.toLocaleString()} earned all-time` : ""}
            </span>
          </div>
        )}

        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setMessage(null);
            const points = Number(amount);
            if (!points || points <= 0) {
              setMessage("Enter a positive number of points.");
              return;
            }
            redeem.mutate(points, {
              onSuccess: (res) => {
                // koboToNaira rather than an inline /100: every NGN amount on the
                // platform is stored in kobo, and the one shared converter is
                // what keeps a stray factor of 100 from reaching a patient.
                setMessage(`Redeemed: a ₦${koboToNaira(res.kobo_credited ?? 0).toLocaleString()} reward voucher is now on your account.`);
                setAmount("");
              },
              onError: (err) => setMessage(err instanceof Error ? err.message : "Something went wrong."),
            });
          }}
        >
          <div className="grid gap-1">
            <label htmlFor="redeem-points" className="text-xs font-medium text-charcoal-ink/70 dark:text-night-ink/70">
              Redeem for a voucher
            </label>
            <Input
              id="redeem-points"
              type="number"
              min={1}
              max={currentBalance || undefined}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 100"
              className="h-9 w-32"
            />
          </div>
          <Button type="submit" size="sm" disabled={redeem.isPending || currentBalance <= 0}>
            {redeem.isPending ? "Redeeming…" : "Redeem"}
          </Button>
          {message && <span className="text-sm text-charcoal-ink/70 dark:text-night-ink/70">{message}</span>}
        </form>

        {ledger && ledger.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-charcoal-ink/50 dark:text-night-ink/55">
              Recent activity
            </p>
            <ul className="divide-y divide-charcoal-ink/10 dark:divide-night-ink/15 text-sm">
              {ledger.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between py-1.5">
                  <span className="text-charcoal-ink/80 dark:text-night-ink/80">{reasonLabel(entry.reason)}</span>
                  <span
                    className={entry.points > 0 ? "font-medium text-brand-green dark:text-brand-green-bright" : "font-medium text-charcoal-ink/60 dark:text-night-ink/60"}
                  >
                    {entry.points > 0 ? "+" : ""}
                    {entry.points}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

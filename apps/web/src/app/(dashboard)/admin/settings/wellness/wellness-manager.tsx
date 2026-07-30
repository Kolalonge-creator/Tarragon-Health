"use client";

import { useState } from "react";
import {
  useAdminWellnessBadges,
  useSetWellnessBadgeActive,
  useAdminWellnessChallenges,
  useSetWellnessChallengeActive,
  useAdminWellnessClassProviders,
  useSetWellnessClassProviderActive,
  useAdminWellnessClasses,
  useSetWellnessClassActive,
  useWellnessPointsConfig,
  useSetWellnessPointsRate,
} from "@/lib/queries/wellness";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

/** The DB stores kobo-per-point (points_to_kobo_rate) since every other
 * money figure in this codebase is kobo-denominated, but an admin thinks in
 * naira — so this card converts at the boundary and works entirely in naira
 * for both the displayed current rate and the input, rather than mixing
 * units (a prior version showed the rate in naira but expected kobo back on
 * save, which meant re-typing the displayed number silently zeroed it out). */
function PointsConfigCard() {
  const { data: config } = useWellnessPointsConfig();
  const setRate = useSetWellnessPointsRate();
  const [nairaInput, setNairaInput] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);

  const currentNaira = config ? config.points_to_kobo_rate / 100 : null;
  const exampleValue = config ? Math.round(config.points_to_kobo_rate * 100) / 100 : null; // 100 pts in naira

  return (
    <Card>
      <CardHeader>
        <CardTitle>Points-to-wallet conversion rate</CardTitle>
        <CardDescription>
          What one wellness point is worth when a patient redeems it for Health Wallet balance.
          Current rate: {currentNaira !== null ? `₦${currentNaira} per point` : "…"}
          {exampleValue !== null ? ` — 100 points = ₦${exampleValue}.` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-end gap-2">
        <div className="grid gap-1">
          <label htmlFor="points-rate-naira" className="text-xs font-medium text-charcoal-ink/70">
            Naira per point
          </label>
          <Input
            id="points-rate-naira"
            type="number"
            min={0}
            step="0.01"
            placeholder={currentNaira !== null ? String(currentNaira) : ""}
            value={nairaInput}
            onChange={(e) => setNairaInput(e.target.value)}
            className="h-9 w-40"
          />
        </div>
        <Button
          size="sm"
          disabled={setRate.isPending || nairaInput === ""}
          onClick={() => {
            const naira = Number(nairaInput);
            if (!Number.isFinite(naira) || naira < 0) return;
            const kobo = Math.round(naira * 100);
            setRate.mutate(kobo, {
              onSuccess: () => {
                setMessage(`Saved — 1 point is now worth ₦${naira}.`);
                setNairaInput("");
              },
              onError: () => setMessage("Could not save — please try again."),
            });
          }}
        >
          {setRate.isPending ? "Saving…" : "Save"}
        </Button>
        {message && <span className="text-sm text-charcoal-ink/70">{message}</span>}
      </CardContent>
    </Card>
  );
}

function BadgesCard() {
  const { data: badges, isLoading } = useAdminWellnessBadges();
  const setActive = useSetWellnessBadgeActive();
  const liveCount = badges?.filter((b) => b.is_active).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Badges</CardTitle>
        <CardDescription>
          {liveCount} of {badges?.length ?? 0} live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {badges && badges.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {badges.map((badge) => (
              <li key={badge.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{badge.name}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {badge.criteria_type} · threshold {badge.criteria_threshold}
                    {badge.criteria_reason ? ` · ${badge.criteria_reason}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={badge.is_active ? "green" : "grey"}>
                    {badge.is_active ? "Live" : "Hidden"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: badge.id, isActive: !badge.is_active })}
                  >
                    {badge.is_active ? "Hide" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ChallengesCard() {
  const { data: challenges, isLoading } = useAdminWellnessChallenges();
  const setActive = useSetWellnessChallengeActive();
  const liveCount = challenges?.filter((c) => c.is_active).length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Challenges</CardTitle>
        <CardDescription>
          {liveCount} of {challenges?.length ?? 0} live.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {challenges && challenges.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {challenges.map((challenge) => (
              <li key={challenge.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{challenge.title}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {challenge.metric} · target {challenge.target_count} in {challenge.duration_days}d ·{" "}
                    {challenge.points_reward} pts
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={challenge.is_active ? "green" : "grey"}>
                    {challenge.is_active ? "Live" : "Hidden"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: challenge.id, isActive: !challenge.is_active })}
                  >
                    {challenge.is_active ? "Hide" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClassProvidersCard() {
  const { data: providers, isLoading } = useAdminWellnessClassProviders();
  const setActive = useSetWellnessClassProviderActive();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Class &amp; workshop partners</CardTitle>
        <CardDescription>
          Flip a partner to active once a real contract exists — the patient-facing class list is
          dormant until then. New partners are added via seed/migration for now.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {providers && providers.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {providers.map((provider) => (
              <li key={provider.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{provider.name}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {provider.regions.length > 0 ? provider.regions.join(", ") : "No regions set"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={provider.is_active ? "green" : "grey"}>
                    {provider.is_active ? "Active" : "Inactive"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: provider.id, isActive: !provider.is_active })}
                  >
                    {provider.is_active ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ClassesCard() {
  const { data: classes, isLoading } = useAdminWellnessClasses();
  const setActive = useSetWellnessClassActive();

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled classes</CardTitle>
        <CardDescription>
          A class only shows to patients when both it and its partner are active.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60">Loading…</p>}
        {classes && classes.length > 0 && (
          <ul className="divide-y divide-charcoal-ink/10">
            {classes.map((cls) => (
              <li key={cls.id} className="flex items-center justify-between gap-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-charcoal-ink">{cls.title}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {cls.wellness_class_providers?.name ?? "Unknown partner"} ·{" "}
                    {new Date(cls.starts_at).toLocaleString("en-GB", { timeZone: "Africa/Lagos" })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={cls.is_active ? "green" : "grey"}>
                    {cls.is_active ? "Live" : "Hidden"}
                  </Badge>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={setActive.isPending}
                    onClick={() => setActive.mutate({ id: cls.id, isActive: !cls.is_active })}
                  >
                    {cls.is_active ? "Hide" : "Publish"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function WellnessManager() {
  return (
    <div className="space-y-6">
      <PointsConfigCard />
      <BadgesCard />
      <ChallengesCard />
      <ClassProvidersCard />
      <ClassesCard />
    </div>
  );
}

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SEMANTIC_ICON } from "@/lib/icons";

/**
 * Volunteer a testimonial — the only way a quote ever reaches the marketing
 * site: patient-written, explicit consent, admin-reviewed. Never prompted by
 * money or reward (deliberately no wallet credit here — paid testimonials
 * aren't testimonials).
 */
export function TestimonialCard({
  patientId,
  organisationId,
}: {
  patientId: string;
  organisationId: string;
}) {
  const queryClient = useQueryClient();
  const [displayName, setDisplayName] = useState("");
  const [quote, setQuote] = useState("");
  const [consent, setConsent] = useState(false);

  const { data: mine } = useQuery({
    queryKey: ["testimonial", patientId],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("patient_testimonials")
        .select("id, status, quote")
        .eq("patient_id", patientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const submit = useMutation({
    mutationFn: async () => {
      const supabase = createClient();
      const { error } = await supabase.from("patient_testimonials").insert({
        organisation_id: organisationId,
        patient_id: patientId,
        display_name: displayName.trim(),
        quote: quote.trim(),
        consent_to_publish: true,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["testimonial", patientId] }),
  });

  if (mine) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your story</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <Badge variant={mine.status === "published" ? "green" : "amber"}>
            {mine.status === "published"
              ? "Published — thank you"
              : mine.status === "declined"
                ? "Not published"
                : "Waiting for review"}
          </Badge>
          <p className="text-sm italic text-charcoal-ink/70">&ldquo;{mine.quote}&rdquo;</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SEMANTIC_ICON.clinicianFollowUp className="h-5 w-5 text-deep-forest" strokeWidth={2} />
          Has Tarragon helped you?
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-charcoal-ink/70">
          If you&apos;d like to, share a few sentences other Nigerians could read on our
          website. Entirely optional, reviewed before anything is published, and you choose the
          name shown (first name or initials are fine).
        </p>
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Name to show (e.g. Ada, Lagos)"
          aria-label="Display name"
          className="block w-full max-w-xs rounded-md border border-charcoal-ink/15 px-3 py-1.5 text-sm"
        />
        <textarea
          value={quote}
          onChange={(e) => setQuote(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Your experience, in your own words (20–500 characters)"
          aria-label="Your testimonial"
          className="block w-full rounded-md border border-charcoal-ink/15 px-3 py-2 text-sm"
        />
        <label className="flex items-start gap-2 text-xs text-charcoal-ink/70">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          I agree this quote and display name may be shown publicly on TarragonHealth&apos;s
          website. I can ask for it to be removed at any time.
        </label>
        <Button
          size="sm"
          disabled={!consent || displayName.trim().length < 2 || quote.trim().length < 20 || submit.isPending}
          onClick={() => submit.mutate()}
        >
          {submit.isPending ? "Sending…" : "Share my story"}
        </Button>
        {submit.isError && <p className="text-xs text-red-600">Could not submit — try again.</p>}
      </CardContent>
    </Card>
  );
}

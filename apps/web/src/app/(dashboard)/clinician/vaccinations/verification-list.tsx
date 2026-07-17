"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import { decideVaccinationVerification } from "./actions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface PendingVerificationItem {
  id: string;
  patientName: string;
  patientNumber: string | null;
  vaccineName: string;
  doseNumber: number;
  dateAdministered: string;
  provider: string | null;
  uploadedAt: string;
  /** Short-lived signed URL for the uploaded physical certificate, or null if
   * it could not be signed (missing/removed object). */
  signedUrl: string | null;
  isPdf: boolean;
}

function VerificationRow({ item }: { item: PendingVerificationItem }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  const decide = useMutation({
    mutationFn: async (decision: "verified" | "rejected") => {
      const result = await decideVaccinationVerification({
        recordId: item.id,
        decision,
        note: note.trim() || undefined,
      });
      if (result.error) throw new Error(result.error);
    },
    onSuccess: () => {
      setError(null);
      router.refresh();
    },
    onError: (e: Error) => setError(e.message),
  });

  return (
    <li className="space-y-3 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium text-charcoal-ink">
          {item.patientName}
          {item.patientNumber ? ` · ${item.patientNumber}` : ""}
        </p>
        <span className="text-sm text-charcoal-ink/70">
          {item.vaccineName} · dose {item.doseNumber}
        </span>
      </div>
      <p className="text-xs text-charcoal-ink/60">
        Administered {new Date(item.dateAdministered).toLocaleDateString()}
        {item.provider ? ` · ${item.provider}` : ""} · uploaded{" "}
        {new Date(item.uploadedAt).toLocaleDateString()}
      </p>

      {item.signedUrl ? (
        item.isPdf ? (
          <a
            href={item.signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-sm font-medium text-brand-green hover:underline"
          >
            Open uploaded certificate (PDF) →
          </a>
        ) : (
          <a href={item.signedUrl} target="_blank" rel="noopener noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.signedUrl}
              alt={`Certificate uploaded by ${item.patientName}`}
              className="max-h-72 rounded-md border border-charcoal-ink/10 object-contain"
            />
          </a>
        )
      ) : (
        <p className="text-xs text-red-600">Uploaded image could not be loaded.</p>
      )}

      <div className="space-y-2">
        <Input
          placeholder="Note (optional — required context if rejecting)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className="max-w-md text-sm"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={decide.isPending} onClick={() => decide.mutate("verified")}>
            {decide.isPending ? "Saving…" : "Verify & issue certificate"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={decide.isPending}
            onClick={() => decide.mutate("rejected")}
          >
            Reject
          </Button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </li>
  );
}

export function VaccinationVerificationList({ items }: { items: PendingVerificationItem[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Certificates awaiting verification</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-charcoal-ink/60">
            Nothing waiting — you&apos;re all caught up.
          </p>
        ) : (
          <ul className="divide-y divide-charcoal-ink/10">
            {items.map((item) => (
              <VerificationRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

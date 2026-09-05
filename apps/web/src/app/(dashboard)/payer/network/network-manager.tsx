"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { addPayerNetworkProviderAction, removePayerNetworkProviderAction } from "./actions";

type Row = {
  id: string;
  provider_type: string;
  provider_id: string;
  status: string;
  service_category: string | null;
  notes: string | null;
};

const STATUS_BADGE: Record<string, "green" | "red" | "amber"> = {
  in_network: "green",
  out_of_network: "red",
  restricted: "amber",
};

export function NetworkManager({ insurerId, rows }: { insurerId: string; rows: Row[] }) {
  const [feedback, setFeedback] = useState<{ error?: string; message?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function run(action: (fd: FormData) => Promise<{ error?: string; message?: string } | undefined>, fd: FormData) {
    startTransition(async () => {
      const result = await action(fd);
      setFeedback(result ?? null);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {feedback?.error && <p className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{feedback.error}</p>}
      {feedback?.message && (
        <p className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-700">{feedback.message}</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Add an exception</CardTitle>
          <CardDescription>
            Paste the directory row&apos;s id (find it under Admin → Partners) and choose what this insurer
            says about it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="grid grid-cols-1 gap-4 sm:grid-cols-5 sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              fd.set("insurerId", insurerId);
              run((f) => addPayerNetworkProviderAction(undefined, f), fd);
              e.currentTarget.reset();
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="providerType">Directory</Label>
              <Select id="providerType" name="providerType" required defaultValue="facility">
                <option value="facility">Facility</option>
                <option value="lab_provider">Lab</option>
                <option value="pharmacy_partner">Pharmacy</option>
                <option value="specialist_provider">Specialist</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="providerId">Provider id</Label>
              <Input id="providerId" name="providerId" required placeholder="uuid" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" required defaultValue="in_network">
                <option value="in_network">In-network</option>
                <option value="out_of_network">Out-of-network</option>
                <option value="restricted">Restricted</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="serviceCategory">Limited to (optional)</Label>
              <Select id="serviceCategory" name="serviceCategory" defaultValue="">
                <option value="">Every category</option>
                <option value="consultation">Consultation</option>
                <option value="laboratory">Laboratory</option>
                <option value="pharmacy">Pharmacy</option>
                <option value="referral">Referral</option>
              </Select>
            </div>
            <Button type="submit" disabled={pending}>
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Exceptions on file</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-charcoal-ink/60">No exceptions. Every provider defaults to in-network.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-charcoal-ink/60">
                  <tr>
                    <th className="py-2 pr-4">Directory</th>
                    <th className="py-2 pr-4">Provider id</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Limited to</th>
                    <th className="py-2 pr-4" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-charcoal-ink/10">
                      <td className="py-2 pr-4">{r.provider_type}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{r.provider_id}</td>
                      <td className="py-2 pr-4">
                        <Badge variant={STATUS_BADGE[r.status] ?? "grey"}>{r.status}</Badge>
                      </td>
                      <td className="py-2 pr-4">{r.service_category ?? "Every category"}</td>
                      <td className="py-2 pr-4">
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            run((f) => removePayerNetworkProviderAction(undefined, f), new FormData(e.currentTarget));
                          }}
                        >
                          <input type="hidden" name="id" value={r.id} />
                          <Button type="submit" size="sm" variant="outline" disabled={pending}>
                            Remove
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

"use client";

import { useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addChildDependentAction } from "./add-child-actions";
import { addChildDependentSchema } from "@/lib/validation/add-child-dependent";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Adds a child family member — the one relationship in family_plan_members
 * that has never signed up and never will (see add-child-actions.ts). Once
 * added, the child shows up in the "whose vaccinations?" selector
 * (vaccination-for-family.tsx) with their own real vaccination card.
 */
export function AddChildForm() {
  const queryClient = useQueryClient();
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const parsed = addChildDependentSchema.safeParse({
      full_name: fullName,
      date_of_birth: dateOfBirth,
      sex: sex || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setIsPending(true);
    try {
      const result = await addChildDependentAction(parsed.data);
      if ("error" in result) {
        setError(result.error);
      } else {
        setSuccess(result.message);
        setFullName("");
        setDateOfBirth("");
        setSex("");
        await queryClient.invalidateQueries({ queryKey: ["managed-dependents"] });
        await queryClient.invalidateQueries({ queryKey: ["family-plan-members"] });
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add a child</CardTitle>
        <CardDescription>
          Keep your child&apos;s vaccination card here — the same schedule, reminders, and
          Tarragon-verified certificates as your own, since they&apos;re too young to have their
          own account.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {success && <p className="text-sm text-brand-green">{success}</p>}

          <div className="space-y-1.5">
            <Label htmlFor="child_full_name">Child&apos;s name</Label>
            <Input
              id="child_full_name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="child_date_of_birth">Date of birth</Label>
              <Input
                id="child_date_of_birth"
                type="date"
                value={dateOfBirth}
                onChange={(event) => setDateOfBirth(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="child_sex">Sex (optional)</Label>
              <Select id="child_sex" value={sex} onChange={(event) => setSex(event.target.value)}>
                <option value="">Not specified</option>
                <option value="female">Female</option>
                <option value="male">Male</option>
              </Select>
            </div>
          </div>

          <Button type="submit" disabled={isPending}>
            {isPending ? "Adding…" : "Add child"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

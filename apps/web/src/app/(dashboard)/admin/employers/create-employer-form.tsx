"use client";

import { useActionState } from "react";
import { createEmployerOrgAction, type EmployerActionState } from "./actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CreateEmployerForm() {
  const [state, formAction, isPending] = useActionState<EmployerActionState, FormData>(
    createEmployerOrgAction,
    undefined
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Register a new employer</CardTitle>
        <CardDescription>Module 26 §26.3, step one — creates the organisation and its account record.</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-wrap items-end gap-3">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="name">Employer name</Label>
            <Input id="name" name="name" placeholder="Acme Nigeria Ltd" required />
          </div>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Registering…" : "Register employer"}
          </Button>
        </form>
        {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
        {state?.message && <p className="mt-2 text-sm text-green-700">{state.message}</p>}
      </CardContent>
    </Card>
  );
}

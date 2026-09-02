"use client";

import { useState, type FormEvent } from "react";
import {
  useEmployerAccount,
  useEmployerLocations,
  useAddEmployerLocation,
  useEmployerDepartments,
  useAddEmployerDepartment,
  useRotateJoinCode,
} from "@/lib/queries/employer-accounts";
import {
  useBenefitPackages,
  useSubscriptionPlanCatalog,
  useCreateBenefitPackage,
  useBenefitAllowances,
  useSetBenefitAllowance,
} from "@/lib/queries/employer-benefits";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

const ALLOWANCE_LABEL: Record<string, string> = {
  gp_consultation: "GP consultations / year",
  specialist_consultation: "Specialist consultations / year",
  health_assessment: "Health assessments / year",
};

function LocationsCard({ organisationId }: { organisationId: string }) {
  const locations = useEmployerLocations(organisationId);
  const addLocation = useAddEmployerLocation(organisationId);
  const [name, setName] = useState("");

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addLocation.mutate({ name: name.trim() }, { onSuccess: () => setName("") });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Locations</CardTitle>
        <CardDescription>Sites your workforce reports from (Module 26 §26.2/§26.5).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="flex items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="location_name">New location</Label>
            <Input id="location_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Lagos HQ" />
          </div>
          <Button type="submit" size="sm" disabled={addLocation.isPending}>
            Add
          </Button>
        </form>
        <ul className="text-sm text-charcoal-ink/80">
          {(locations.data ?? []).map((l) => (
            <li key={l.id}>{l.name}</li>
          ))}
          {locations.data?.length === 0 && <li className="text-charcoal-ink/50">No locations yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function DepartmentsCard({ organisationId }: { organisationId: string }) {
  const departments = useEmployerDepartments(organisationId);
  const locations = useEmployerLocations(organisationId);
  const addDepartment = useAddEmployerDepartment(organisationId);
  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    addDepartment.mutate(
      { name: name.trim(), location_id: locationId || null },
      { onSuccess: () => setName("") }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Departments</CardTitle>
        <CardDescription>Eligibility segments for reporting and targeted messages.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="department_name">New department</Label>
            <Input id="department_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Engineering" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="department_location">Site (optional)</Label>
            <Select id="department_location" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Org-wide</option>
              {(locations.data ?? []).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" size="sm" disabled={addDepartment.isPending}>
            Add
          </Button>
        </form>
        <ul className="text-sm text-charcoal-ink/80">
          {(departments.data ?? []).map((d) => (
            <li key={d.id}>{d.name}</li>
          ))}
          {departments.data?.length === 0 && <li className="text-charcoal-ink/50">No departments yet.</li>}
        </ul>
      </CardContent>
    </Card>
  );
}

function AllowancesEditor({ packageId }: { packageId: string }) {
  const allowances = useBenefitAllowances(packageId);
  const setAllowance = useSetBenefitAllowance(packageId);
  const [type, setType] = useState("gp_consultation");
  const [limit, setLimit] = useState("2");

  return (
    <div className="mt-2 space-y-2 rounded-md bg-charcoal-ink/5 p-2">
      <div className="flex flex-wrap items-end gap-2">
        <Select value={type} onChange={(e) => setType(e.target.value)} className="h-8 text-xs">
          {Object.entries(ALLOWANCE_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        <Input
          type="number"
          min={1}
          value={limit}
          onChange={(e) => setLimit(e.target.value)}
          className="h-8 w-20 text-xs"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={setAllowance.isPending}
          onClick={() => setAllowance.mutate({ allowance_type: type, annual_limit: Number(limit) })}
        >
          Set
        </Button>
      </div>
      <ul className="text-xs text-charcoal-ink/70">
        {(allowances.data ?? []).map((a) => (
          <li key={a.id}>
            {ALLOWANCE_LABEL[a.allowance_type] ?? a.allowance_type}: {a.annual_limit}/year
          </li>
        ))}
      </ul>
    </div>
  );
}

function BenefitPackagesCard({ organisationId }: { organisationId: string }) {
  const packages = useBenefitPackages(organisationId);
  const plans = useSubscriptionPlanCatalog();
  const createPackage = useCreateBenefitPackage(organisationId);
  const [name, setName] = useState("");
  const [planId, setPlanId] = useState("");
  const [discount, setDiscount] = useState("0");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function handleCreate(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || !planId) return;
    createPackage.mutate(
      { name: name.trim(), subscription_plan_id: planId, lab_discount_percent: Number(discount) || 0 },
      { onSuccess: () => setName("") }
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benefit packages</CardTitle>
        <CardDescription>
          What your plan includes (Module 26 §26.6/§26.7) — a plan tier plus a per-year allowance and a
          diagnostics discount. Assign a package to a roster member from the Overview tab.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="package_name">Package name</Label>
            <Input id="package_name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Standard" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package_plan">Plan tier</Label>
            <Select id="package_plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
              <option value="">Select…</option>
              {(plans.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="package_discount">Lab discount %</Label>
            <Input
              id="package_discount"
              type="number"
              min={0}
              max={100}
              value={discount}
              onChange={(e) => setDiscount(e.target.value)}
              className="w-20"
            />
          </div>
          <Button type="submit" size="sm" disabled={createPackage.isPending}>
            Create package
          </Button>
        </form>

        <ul className="divide-y divide-charcoal-ink/10">
          {(packages.data ?? []).map((p) => (
            <li key={p.id} className="py-2">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-charcoal-ink">{p.name}</p>
                  <p className="text-xs text-charcoal-ink/60">
                    {p.lab_discount_percent}% lab discount{p.is_default ? " · Default" : ""}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                >
                  {expandedId === p.id ? "Hide allowances" : "Allowances"}
                </Button>
              </div>
              {expandedId === p.id && <AllowancesEditor packageId={p.id} />}
            </li>
          ))}
          {packages.data?.length === 0 && (
            <li className="py-2 text-sm text-charcoal-ink/50">No benefit packages yet — create one above.</li>
          )}
        </ul>
      </CardContent>
    </Card>
  );
}

function JoinCodeCard({ organisationId }: { organisationId: string }) {
  const account = useEmployerAccount(organisationId);
  const rotate = useRotateJoinCode(organisationId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Organisation join code
          <Badge variant="grey">Self-serve joining</Badge>
        </CardTitle>
        <CardDescription>
          Share this code so staff can join themselves from the app (Module 26 §26.4) — only works once your
          account has gone live. Rotating it invalidates the old code immediately.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center gap-3">
        <p className="font-mono text-lg tracking-widest text-charcoal-ink">
          {account.data?.join_code ?? "Not set yet"}
        </p>
        <Button type="button" size="sm" variant="outline" disabled={rotate.isPending} onClick={() => rotate.mutate()}>
          {rotate.isPending ? "Rotating…" : "Rotate code"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function EligibilityBenefitsManager({ organisationId }: { organisationId: string }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <LocationsCard organisationId={organisationId} />
        <DepartmentsCard organisationId={organisationId} />
      </div>
      <BenefitPackagesCard organisationId={organisationId} />
      <JoinCodeCard organisationId={organisationId} />
    </div>
  );
}

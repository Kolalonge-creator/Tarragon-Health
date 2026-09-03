"use client";

import { useActionState } from "react";
import type { Tables } from "@tarragon/shared";
import {
  updateEmployerProfileAction,
  setEmployerVerificationAction,
  upsertEmployerContractAction,
  goLiveEmployerAction,
  type EmployerActionState,
} from "../actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

type EmployerAccount = Tables<"employer_accounts">;
type CorporateContract = Tables<"corporate_contracts">;

function ActionMessage({ state }: { state: EmployerActionState }) {
  if (!state) return null;
  return (
    <>
      {state.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state.message && <p className="mt-2 text-sm text-green-700">{state.message}</p>}
    </>
  );
}

export function EmployerDetailManager({
  organisationId,
  organisationName,
  account,
  contract,
  rosterCount,
}: {
  organisationId: string;
  organisationName: string;
  account: EmployerAccount | null;
  contract: CorporateContract | null;
  rosterCount: number;
}) {
  const [profileState, profileAction, profilePending] = useActionState<EmployerActionState, FormData>(
    updateEmployerProfileAction,
    undefined
  );
  const [verificationState, verificationAction, verificationPending] = useActionState<
    EmployerActionState,
    FormData
  >(setEmployerVerificationAction, undefined);
  const [contractState, contractAction, contractPending] = useActionState<EmployerActionState, FormData>(
    upsertEmployerContractAction,
    undefined
  );
  const [goLiveState, goLiveAction, goLivePending] = useActionState<EmployerActionState, FormData>(
    goLiveEmployerAction,
    undefined
  );

  const isLive = !!account?.went_live_at;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-charcoal-ink">{organisationName}</h1>
          <p className="text-sm text-charcoal-ink/60">{rosterCount} on the roster</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={account?.verification_status === "verified" ? "green" : "grey"}>
            {account?.verification_status ?? "unverified"}
          </Badge>
          <Badge variant={isLive ? "green" : "grey"}>{isLive ? "Live" : account?.onboarding_step ?? "registration"}</Badge>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Business details</CardTitle>
          <CardDescription>Module 26 §26.3: organisation registration.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={profileAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="organisationId" value={organisationId} />
            <div className="space-y-1.5">
              <Label htmlFor="legalName">Legal name</Label>
              <Input id="legalName" name="legalName" defaultValue={account?.legal_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rcNumber">CAC RC number</Label>
              <Input id="rcNumber" name="rcNumber" defaultValue={account?.rc_number ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tin">TIN</Label>
              <Input id="tin" name="tin" defaultValue={account?.tin ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="industry">Industry</Label>
              <Input id="industry" name="industry" defaultValue={account?.industry ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primaryContactName">Primary contact</Label>
              <Input id="primaryContactName" name="primaryContactName" defaultValue={account?.primary_contact_name ?? ""} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primaryContactEmail">Contact email</Label>
              <Input
                id="primaryContactEmail"
                name="primaryContactEmail"
                type="email"
                defaultValue={account?.primary_contact_email ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="primaryContactPhone">Contact phone</Label>
              <Input id="primaryContactPhone" name="primaryContactPhone" defaultValue={account?.primary_contact_phone ?? ""} />
            </div>
            <div className="flex items-end">
              <Button type="submit" size="sm" disabled={profilePending}>
                {profilePending ? "Saving…" : "Save details"}
              </Button>
            </div>
          </form>
          <ActionMessage state={profileState} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Business verification</CardTitle>
          <CardDescription>Reviewed only against the details above, not a regulator check.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={verificationAction} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="organisationId" value={organisationId} />
            <div className="space-y-1.5">
              <Label htmlFor="status">Status</Label>
              <Select id="status" name="status" defaultValue={account?.verification_status ?? "unverified"}>
                <option value="unverified">Unverified</option>
                <option value="pending">Pending review</option>
                <option value="verified">Verified</option>
                <option value="rejected">Rejected</option>
              </Select>
            </div>
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="notes">Notes</Label>
              <Textarea id="notes" name="notes" defaultValue={account?.verification_notes ?? ""} rows={2} />
            </div>
            <Button type="submit" size="sm" disabled={verificationPending}>
              {verificationPending ? "Saving…" : "Set verification"}
            </Button>
          </form>
          <ActionMessage state={verificationState} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Contract & billing</CardTitle>
          <CardDescription>Module 26 §26.15: five billing models, all money in kobo.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={contractAction} className="grid gap-3 sm:grid-cols-2">
            <input type="hidden" name="organisationId" value={organisationId} />
            <div className="space-y-1.5">
              <Label htmlFor="billingModel">Billing model</Label>
              <Select id="billingModel" name="billingModel" defaultValue={contract?.billing_model ?? "per_employee"}>
                <option value="per_employee">Per employee</option>
                <option value="per_active_member">Per active member</option>
                <option value="fixed_contract">Fixed contract</option>
                <option value="service_based">Service-based</option>
                <option value="hybrid">Fixed + per active member (hybrid)</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingInterval">Interval</Label>
              <Select id="billingInterval" name="billingInterval" defaultValue={contract?.billing_interval ?? "monthly"}>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingRateKobo">Rate (kobo, per person)</Label>
              <Input
                id="billingRateKobo"
                name="billingRateKobo"
                type="number"
                min={0}
                defaultValue={contract?.billing_rate_kobo ?? ""}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingFixedAmountKobo">Fixed amount (kobo)</Label>
              <Input
                id="billingFixedAmountKobo"
                name="billingFixedAmountKobo"
                type="number"
                min={0}
                defaultValue={contract?.billing_fixed_amount_kobo ?? ""}
              />
            </div>
            <label className="flex items-center gap-2 text-sm text-charcoal-ink/70 sm:col-span-2">
              <input type="checkbox" name="signNow" defaultChecked={!!contract?.signed_at} />
              Mark as signed now (required before this employer can go live)
            </label>
            <div>
              <Button type="submit" size="sm" disabled={contractPending}>
                {contractPending ? "Saving…" : "Save contract"}
              </Button>
            </div>
          </form>
          <ActionMessage state={contractState} />
          {contract?.signed_at && (
            <p className="mt-2 text-xs text-charcoal-ink/60">Signed {new Date(contract.signed_at).toLocaleDateString()}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Go live</CardTitle>
          <CardDescription>
            Requires a verified business and a signed, active contract with a billing model (enforced at the
            database level: see employer_accounts_live_is_the_last_step / assert_employer_live_has_contract).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLive ? (
            <p className="text-sm text-green-700">
              Live since {account?.went_live_at && new Date(account.went_live_at).toLocaleDateString()}.
            </p>
          ) : (
            <form action={goLiveAction}>
              <input type="hidden" name="organisationId" value={organisationId} />
              <Button type="submit" disabled={goLivePending}>
                {goLivePending ? "Going live…" : "Go live"}
              </Button>
            </form>
          )}
          <ActionMessage state={goLiveState} />
        </CardContent>
      </Card>
    </div>
  );
}

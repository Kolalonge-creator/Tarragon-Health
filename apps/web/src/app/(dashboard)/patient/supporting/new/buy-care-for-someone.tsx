"use client";

import Link from "next/link";
import { useActionState, useState, type FormEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { koboToNaira } from "@tarragon/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { useSupportedPeople } from "@/lib/queries/sponsorship";
import { useActiveServiceProducts } from "@/lib/queries/service-products";
import { addElderProxyDependentAction } from "../../family/add-elder-actions";
import { addElderProxyDependentSchema } from "@/lib/validation/elder-proxy-dependent";
import { paySomeonesPlan, type SponsorActionState } from "../actions";

function naira(kobo: number): string {
  return `₦${koboToNaira(kobo).toLocaleString("en-NG")}`;
}

type Beneficiary = { id: string; name: string };

/**
 * Step 1 of 2: who is this for.
 *
 * Two real paths, not one form pretending to cover both: someone already
 * linked to you (an ordinary profile_access grant, 'manage' level — 'view'
 * next-of-kin can follow but not be paid for, same rule paySomeonesPlan
 * itself enforces), or someone who has never touched Tarragon. The second
 * path does not invent anything: it is the existing elder-proxy mechanism
 * from /patient/family, reused here with copy that does not assume the
 * person is elderly or offline — a diaspora sponsor's relative is just as
 * often a working-age parent who simply hasn't signed up yet as an elder who
 * can't.
 */
function ChooseBeneficiary({ onChosen }: { onChosen: (b: Beneficiary) => void }) {
  const { data: people, isLoading } = useSupportedPeople();
  const queryClient = useQueryClient();
  const [showNewForm, setShowNewForm] = useState(false);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [relationship, setRelationship] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [sex, setSex] = useState("");
  const [confirmedConsent, setConfirmedConsent] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const manageable = (people ?? []).filter((p) => p.permissionLevel === "manage");

  async function handleNewPersonSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const parsed = addElderProxyDependentSchema.safeParse({
      full_name: fullName,
      phone,
      relationship,
      date_of_birth: dateOfBirth,
      sex: sex || undefined,
      confirmed_consent: confirmedConsent || undefined,
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid details");
      return;
    }

    setIsPending(true);
    try {
      const result = await addElderProxyDependentAction(parsed.data);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ["sponsorship", "supported-people"] });
      await queryClient.invalidateQueries({ queryKey: ["adults-i-manage"] });
      await queryClient.invalidateQueries({ queryKey: ["sponsorable-profiles"] });
      onChosen({ id: result.profileId, name: fullName.trim() });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Someone you already support</CardTitle>
          <CardDescription>
            Anyone who has linked you to their care with permission to act for them appears here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>
          )}
          {!isLoading && manageable.length === 0 && (
            <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
              Nobody yet. If they already have a Tarragon account, ask them to name you as an
              eldercare grantee from{" "}
              <Link href="/patient/family" className="text-brand-green underline">
                their own Your people page
              </Link>
              , or set up a record for them below if they don&apos;t have one yet.
            </p>
          )}
          {!isLoading && manageable.length > 0 && (
            <ul className="space-y-2">
              {manageable.map((person) => (
                <li key={person.profileId} className="flex items-center justify-between gap-3">
                  <span className="text-sm text-charcoal-ink dark:text-night-ink">
                    {person.fullName ?? "Unnamed"}
                    {person.isDependentAccount && (
                      <Badge variant="grey" className="ml-2">
                        No login of their own
                      </Badge>
                    )}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() =>
                      onChosen({ id: person.profileId, name: person.fullName ?? "them" })
                    }
                  >
                    Buy for them
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Someone who isn&apos;t on Tarragon yet</CardTitle>
          <CardDescription>
            You set up their record and pay for it; they do not need to sign up, download anything,
            or do anything at all before you can buy this for them. If they already have a
            Tarragon account under this number, we&apos;ll tell you and point you at the right
            path instead: you can&apos;t take over an account that already exists.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!showNewForm ? (
            <Button type="button" variant="outline" onClick={() => setShowNewForm(true)}>
              Set up their record
            </Button>
          ) : (
            <form onSubmit={handleNewPersonSubmit} className="space-y-4">
              {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

              <div className="space-y-1.5">
                <Label htmlFor="new-full-name">Their name</Label>
                <Input
                  id="new-full-name"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-phone">Their phone number</Label>
                  <Input
                    id="new-phone"
                    type="tel"
                    placeholder="+2348012345678"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-relationship">Their relationship to you</Label>
                  <Input
                    id="new-relationship"
                    placeholder="e.g. mother, brother, cousin"
                    value={relationship}
                    onChange={(event) => setRelationship(event.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-dob">Date of birth</Label>
                  <Input
                    id="new-dob"
                    type="date"
                    value={dateOfBirth}
                    onChange={(event) => setDateOfBirth(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-sex">Sex (optional)</Label>
                  <Select id="new-sex" value={sex} onChange={(event) => setSex(event.target.value)}>
                    <option value="">Not specified</option>
                    <option value="female">Female</option>
                    <option value="male">Male</option>
                  </Select>
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-charcoal-ink dark:text-night-ink">
                <input
                  type="checkbox"
                  className="mt-0.5 h-4 w-4 rounded border-charcoal-ink/30 dark:border-night-ink/35"
                  checked={confirmedConsent}
                  onChange={(event) => setConfirmedConsent(event.target.checked)}
                  required
                />
                <span className="text-charcoal-ink/80 dark:text-night-ink/80">
                  I confirm they&apos;ve agreed to me setting this up and paying for care on their
                  behalf.
                </span>
              </label>

              <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
                This creates their record and lets you manage it, the same as adding family from
                Your people. We won&apos;t text or notify them on your behalf: that part is
                between you and them for now.
              </p>

              <Button type="submit" disabled={isPending}>
                {isPending ? "Setting up…" : "Set up their record and continue"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/**
 * Step 2 of 2: pick what to buy and pay.
 *
 * Reads the same generic active-products list every other purchase surface
 * reads (useActiveServiceProducts), so it needs no update when a product is
 * added or retired — Continuous Monitoring and Supervised Weight Management
 * show up here exactly because they are ordinary active, NGN-priced
 * service_products rows, same as every product that came before them.
 */
function PickAndPay({ beneficiary }: { beneficiary: Beneficiary }) {
  const { data: plans, isLoading } = useActiveServiceProducts();
  const [state, action, pending] = useActionState<SponsorActionState, FormData>(
    paySomeonesPlan,
    undefined,
  );

  const payable = (plans ?? []).filter((plan) => plan.currency === "NGN" && plan.price_kobo > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>What are you buying for {beneficiary.name}?</CardTitle>
        <CardDescription>
          Any paid service on Tarragon: a doctor&apos;s time, Continuous Monitoring, or Supervised
          Weight Management. The app itself is free, so this list is everything there is to pay
          for.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">Loading…</p>}
        {!isLoading && payable.length === 0 && (
          <p className="text-sm text-charcoal-ink/60 dark:text-night-ink/60">
            Nothing is available to buy right now.
          </p>
        )}
        {!isLoading && payable.length > 0 && (
          <form action={action} className="space-y-3">
            <input type="hidden" name="beneficiaryProfileId" value={beneficiary.id} />
            <Select name="planCode" defaultValue="" className="max-w-sm" required>
              <option value="">Choose what to buy</option>
              {payable.map((plan) => (
                <option key={plan.code} value={plan.code}>
                  {plan.name} ({naira(plan.price_kobo)})
                </option>
              ))}
            </Select>
            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Starting…" : "Pay on my card"}
              </Button>
            </div>
            {state?.error && <p className="text-sm text-red-600 dark:text-red-300">{state.error}</p>}
            <p className="text-xs text-charcoal-ink/50 dark:text-night-ink/55">
              Billed to you now, in naira, via Paystack. {beneficiary.name} keeps their own record
              and can see it was paid for; their results stay with them. After payment you land back
              on{" "}
              <Link href="/patient/supporting" className="text-brand-green underline">
                People you support
              </Link>
              , where you can see it as soon as it lands.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function BuyCareForSomeone() {
  const [beneficiary, setBeneficiary] = useState<Beneficiary | null>(null);

  if (!beneficiary) {
    return <ChooseBeneficiary onChosen={setBeneficiary} />;
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="outline" size="sm" onClick={() => setBeneficiary(null)}>
        ← Choose someone else
      </Button>
      <PickAndPay beneficiary={beneficiary} />
    </div>
  );
}

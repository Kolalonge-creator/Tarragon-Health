"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { isValidNgPhone } from "@tarragon/shared";
import { AuthCard, Button, Input, Label } from "@/components/ui/auth-ui";
import { createClient } from "@/lib/supabase/client";

type AuthMethod = "phone" | "email";
type Step = "credentials" | "otp";

function normalizeNgPhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (digits.startsWith("234") && digits.length === 13) {
    return `+${digits}`;
  }
  if (digits.startsWith("0") && digits.length === 11) {
    return `+234${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `+234${digits}`;
  }
  return input.startsWith("+") ? input : `+${digits}`;
}

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const authError = searchParams.get("error");

  const [method, setMethod] = useState<AuthMethod>("phone");
  const [step, setStep] = useState<Step>("credentials");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(
    authError === "auth" ? "We could not sign you in. Please try again." : null,
  );

  async function sendOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    if (method === "phone") {
      const normalized = normalizeNgPhone(phone);
      if (!isValidNgPhone(normalized)) {
        setMessage("Enter a valid Nigerian number, e.g. 08012345678.");
        setLoading(false);
        return;
      }

      const { error } = await supabase.auth.signInWithOtp({ phone: normalized });
      if (error) {
        setMessage(error.message);
      } else {
        setPhone(normalized);
        setStep("otp");
        setMessage("We sent a code to your phone.");
      }
    } else {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false },
      });
      if (error) {
        setMessage(error.message);
      } else {
        setStep("otp");
        setMessage("Check your email for a sign-in code.");
      }
    }

    setLoading(false);
  }

  async function verifyOtp(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const supabase = createClient();

    const payload =
      method === "phone"
        ? { phone, token: otp, type: "sms" as const }
        : { email: email.trim(), token: otp, type: "email" as const };

    const { error } = await supabase.auth.verifyOtp(payload);
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    router.refresh();
    router.push(searchParams.get("next") ?? "/");
    router.refresh();
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Care that stays with you. Sign in to continue."
    >
      <div className="mb-4 flex gap-2">
        <Button
          type="button"
          variant={method === "phone" ? "primary" : "secondary"}
          className="flex-1"
          onClick={() => {
            setMethod("phone");
            setStep("credentials");
            setMessage(null);
          }}
        >
          Phone
        </Button>
        <Button
          type="button"
          variant={method === "email" ? "primary" : "secondary"}
          className="flex-1"
          onClick={() => {
            setMethod("email");
            setStep("credentials");
            setMessage(null);
          }}
        >
          Email
        </Button>
      </div>

      {step === "credentials" ? (
        <form onSubmit={sendOtp} className="space-y-4">
          {method === "phone" ? (
            <div>
              <Label htmlFor="phone">Phone number</Label>
              <Input
                id="phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                placeholder="08012345678"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                required
              />
            </div>
          ) : (
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
          )}

          {message ? (
            <p className="text-sm text-brand-ink/70" role="status">
              {message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending code…" : "Send sign-in code"}
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyOtp} className="space-y-4">
          <div>
            <Label htmlFor="otp">Verification code</Label>
            <Input
              id="otp"
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              required
            />
          </div>

          {message ? (
            <p className="text-sm text-brand-ink/70" role="status">
              {message}
            </p>
          ) : null}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Verifying…" : "Sign in"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => {
              setStep("credentials");
              setOtp("");
              setMessage(null);
            }}
          >
            Use a different {method === "phone" ? "number" : "email"}
          </Button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-brand-ink/70">
        New here?{" "}
        <Link href="/sign-up" className="font-medium text-brand-green">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}

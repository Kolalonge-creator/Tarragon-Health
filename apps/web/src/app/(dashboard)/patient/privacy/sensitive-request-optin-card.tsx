"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export const SENSITIVE_OPTIN_KEY = ["sensitive-request-optin"] as const;

export type SensitiveOptin = { available: boolean; opted_in: boolean };

/** What the card shows. Pure so it can be tested: hidden while the feature is not available and the patient has not opted in. */
export function sensitiveOptinView(s: SensitiveOptin | undefined): "hidden" | "off" | "on" {
  if (!s) return "hidden";
  if (s.opted_in) return "on";
  return s.available ? "off" : "hidden";
}

export function SensitiveRequestOptinCard() {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: SENSITIVE_OPTIN_KEY,
    queryFn: async (): Promise<SensitiveOptin> => {
      const supabase = createClient();
      const { data: rows, error } = await supabase.rpc("my_sensitive_request_optin");
      if (error) throw error;
      const row = rows?.[0];
      return { available: Boolean(row?.available), opted_in: Boolean(row?.opted_in) };
    },
  });
  const change = useMutation({
    mutationFn: async (optIn: boolean) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_my_sensitive_request_optin", { p_opt_in: optIn });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SENSITIVE_OPTIN_KEY }),
  });

  const view = sensitiveOptinView(data);
  if (view === "hidden") return null;
  const on = view === "on";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Automatic requests for private tests</CardTitle>
        <CardDescription>
          Some tests are more private, such as tests for infections. When one of these is due, we can get the printable request ready for you
          the way we do for other tests, so you do not have to ask. It stays in your account. The messages we send never say which test it is.
          The name of the test appears only on the request itself, which only you can open.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-sm text-charcoal-ink dark:text-night-ink" data-testid="sensitive-optin-state">
          {on ? "This is on. We will get these requests ready for you." : "This is off. We will not prepare these requests unless you ask."}
        </p>
        <Button type="button" variant="outline" size="sm" disabled={change.isPending} onClick={() => change.mutate(!on)}>
          {on ? "Turn off" : "Turn on"}
        </Button>
        <p className="text-xs text-charcoal-ink/60 dark:text-night-ink/60">
          You can change this at any time. Turning it off stops new requests; it does not remove any request you already have.
        </p>
        {change.isError && <p className="text-xs text-red-600 dark:text-red-300">We could not save that. Please try again.</p>}
      </CardContent>
    </Card>
  );
}

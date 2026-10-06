import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { checkoutReplySchema, parseCatalogue, parseMembership, parseOrders, verifyReplySchema } from "@/lib/commerce/model";

export const commerceKeys = {
  catalogue: ["commerce", "catalogue"] as const,
  orders: ["commerce", "orders"] as const,
  membership: ["commerce", "membership"] as const,
};

/** The shop window. Empty while checkout is closed; the database decides, the screen only shows what it is given. */
export function useCatalogue() {
  return useQuery({
    queryKey: commerceKeys.catalogue,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("catalogue");
      if (error) throw error;
      return parseCatalogue(data);
    },
  });
}

export function useMyOrders() {
  return useQuery({
    queryKey: commerceKeys.orders,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_orders");
      if (error) throw error;
      return parseOrders(data);
    },
  });
}

export function useMyMembership() {
  return useQuery({
    queryKey: commerceKeys.membership,
    queryFn: async () => {
      const { data, error } = await createClient().rpc("my_membership");
      if (error) throw error;
      return parseMembership(data);
    },
  });
}

/** A failed call to an edge function carries the stable error code in its JSON body. */
async function errorCodeOf(error: unknown): Promise<string> {
  const ctx = (error as { context?: unknown } | null)?.context;
  if (ctx instanceof Response) {
    try {
      const body: unknown = await ctx.clone().json();
      const code = (body as { error?: unknown } | null)?.error;
      if (typeof code === "string") return code;
    } catch {
      // not JSON: fall through to the generic code
    }
  }
  return "unknown";
}

export class CheckoutError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CheckoutError";
  }
}

/**
 * Starts a checkout. `clientKey` is made once per tap by the caller and reused on a retry, so a double tap or a dropped
 * connection returns the same order instead of making a second one. Only the item code is sent, never an amount.
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: async (input: { code: string; clientKey: string }) => {
      const { data, error } = await createClient().functions.invoke("order-checkout", { body: { code: input.code, client_key: input.clientKey } });
      if (error) throw new CheckoutError(await errorCodeOf(error));
      const parsed = checkoutReplySchema.safeParse(data);
      if (!parsed.success) throw new CheckoutError("unknown");
      return parsed.data;
    },
  });
}

/** Asks Paystack, through our server, whether an order is paid. Safe to repeat. */
export function useVerifyOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (reference: string) => {
      const { data, error } = await createClient().functions.invoke("order-verify", { body: { reference } });
      if (error) throw new CheckoutError(await errorCodeOf(error));
      const parsed = verifyReplySchema.safeParse(data);
      if (!parsed.success) throw new CheckoutError("unknown");
      return parsed.data;
    },
    onSuccess: (reply) => {
      if (reply.state === "paid") void qc.invalidateQueries({ queryKey: ["commerce"] });
    },
  });
}

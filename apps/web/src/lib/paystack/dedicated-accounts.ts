import { paystackFetch, type PaystackResult } from "./client";

interface PaystackCustomer {
  customer_code: string;
}

interface PaystackDedicatedAccount {
  id: number;
  account_number: string;
  account_name: string;
  bank: { name: string; slug: string };
  customer: { customer_code: string };
}

/**
 * Finds or creates the Paystack Customer behind a patient's dedicated
 * account. POST /customer is not idempotent on email — a second call for
 * the same email 422s with a message Paystack doesn't give a stable error
 * code for, so this falls back to GET /customer/{email} on any failure
 * rather than pattern-matching the message text.
 */
async function findOrCreatePaystackCustomer(args: {
  email: string;
  fullName: string;
  phone: string;
}): Promise<PaystackResult<{ customerCode: string }>> {
  const [firstName, ...rest] = args.fullName.trim().split(/\s+/);
  const lastName = rest.join(" ") || firstName;

  const created = await paystackFetch<PaystackCustomer>("/customer", {
    method: "POST",
    body: {
      email: args.email,
      first_name: firstName || "Tarragon",
      last_name: lastName,
      phone: args.phone,
    },
  });
  if (created.ok) return { ok: true, data: { customerCode: created.data.customer_code } };

  const existing = await paystackFetch<PaystackCustomer>(`/customer/${encodeURIComponent(args.email)}`);
  if (!existing.ok) return created; // surface the original creation error, more informative than the lookup's

  return { ok: true, data: { customerCode: existing.data.customer_code } };
}

/**
 * Assigns a patient their own permanent NUBAN. Requires the Dedicated
 * Virtual Account product to be enabled on the Paystack merchant account
 * (a Paystack-side approval, not a code change) — confirmed enabled
 * 2026-08-29. `preferredBank` defaults to Wema Bank, Paystack's most widely
 * available DVA provider; override via PAYSTACK_DVA_PREFERRED_BANK if the
 * account is provisioned against a different one (e.g. "titan-paystack").
 */
export async function assignDedicatedAccount(args: {
  email: string;
  fullName: string;
  phone: string;
}): Promise<
  PaystackResult<{
    customerCode: string;
    dedicatedAccountId: number;
    accountNumber: string;
    bankName: string;
    bankSlug: string;
  }>
> {
  const customer = await findOrCreatePaystackCustomer(args);
  if (!customer.ok) return customer;

  const preferredBank = process.env.PAYSTACK_DVA_PREFERRED_BANK || "wema-bank";

  const account = await paystackFetch<PaystackDedicatedAccount>("/dedicated_account", {
    method: "POST",
    body: { customer: customer.data.customerCode, preferred_bank: preferredBank },
  });
  if (!account.ok) return account;

  return {
    ok: true,
    data: {
      customerCode: customer.data.customerCode,
      dedicatedAccountId: account.data.id,
      accountNumber: account.data.account_number,
      bankName: account.data.bank.name,
      bankSlug: account.data.bank.slug,
    },
  };
}

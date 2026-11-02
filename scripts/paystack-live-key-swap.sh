#!/usr/bin/env bash
# Put the LIVE Paystack secret key into the two Supabase edge secrets, by the founder's hand.
# The key is read from a hidden prompt and never echoed, logged or written to disk. Run from the repo root.
set -euo pipefail
PROJECT_REF="koiplnmbgnqnbywhpjlf"
echo "Paste the Paystack LIVE secret key (starts with sk_live_). It will not be shown."
read -r -s -p "sk_live_...: " KEY; echo
case "$KEY" in
  sk_live_*) ;;
  sk_test_*) echo "That is a TEST key. Nothing changed."; exit 1 ;;
  *) echo "That does not look like a Paystack secret key. Nothing changed."; exit 1 ;;
esac
npx supabase secrets set --project-ref "$PROJECT_REF" "PAYSTACK_SECRET_KEY=$KEY" "PAYSTACK_WEBHOOK_SECRET=$KEY" >/dev/null
unset KEY
echo "Both secrets updated. Digests now:"
npx supabase secrets list --project-ref "$PROJECT_REF" 2>/dev/null | grep -E "PAYSTACK" || true
echo "Done. The edge functions pick the new value up on their next invocation; no redeploy needed."

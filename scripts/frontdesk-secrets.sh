#!/usr/bin/env bash
#
# Creates the two Front Desk secrets, each in BOTH places it is needed, from one random value apiece. Run once, from the main checkout,
# by a person (an automated session is not allowed to write secrets). Nothing is printed. Safe to re-run: it replaces the values, which
# invalidates unsubscribe links already sent, so only re-run on purpose.
#
#   fd_followup_secret    (Vault)  = FD_FOLLOWUP_SECRET    (Edge Function secret)   pg_cron -> dispatcher
#   fd_unsubscribe_secret (Vault)  = FD_UNSUBSCRIBE_SECRET (Edge Function secret)   signs and verifies unsubscribe links
#
# Needs: the Supabase CLI logged in (it is, on this machine), openssl.
set -euo pipefail
REF="${SUPABASE_PROJECT_REF:-koiplnmbgnqnbywhpjlf}"
A="$(openssl rand -base64 48 | tr -d '\n')"
B="$(openssl rand -base64 48 | tr -d '\n')"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
chmod 600 "$TMP"

npx --yes supabase@latest secrets set "FD_FOLLOWUP_SECRET=$A" "FD_UNSUBSCRIBE_SECRET=$B" --project-ref "$REF" >/dev/null

cat > "$TMP" <<SQL
delete from vault.secrets where name in ('fd_followup_secret', 'fd_unsubscribe_secret');
select vault.create_secret('$A', 'fd_followup_secret', 'Front Desk dispatcher shared secret') is not null as followup_created;
select vault.create_secret('$B', 'fd_unsubscribe_secret', 'Front Desk unsubscribe token secret') is not null as unsubscribe_created;
SQL
npx --yes supabase@latest db query --linked -f "$TMP" >/dev/null
echo "Front Desk secrets set in the Edge Functions and the Vault (values not shown)."

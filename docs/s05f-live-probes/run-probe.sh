#!/bin/zsh
# Usage (from a checkout where `supabase link` has been run):  docs/s05f-live-probes/run-probe.sh docs/s05f-live-probes/probe-1-staff-access.sql
# Runs one probe against the LINKED production project and prints one PASS/FAIL line per check.
# Every probe is a single transaction that ends in ROLLBACK; read the header of the .sql file before running it.
set -e
npx supabase db query --linked -f "$1" 2>&1 | grep -vE 'Initialising' | python3 -c "
import sys,json
t=sys.stdin.read()
i=t.find('{')
d,_=json.JSONDecoder().raw_decode(t[i:])
if 'rows' in d:
    for r in d['rows']: print(('PASS ' if r['ok'] else 'FAIL ')+r['item']+' | expected: '+r['expected']+' | actual: '+r['actual'])
else: print(t[:1800])"

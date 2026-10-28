# Cuff guide wording, version 2 proposal (for the CMO)

Status: PROPOSAL ONLY. Nothing in the app changes with this document. The signed wording stays live until the CMO signs a version 2 row on the sign-off hub.
Origin: gap register item W-35 / copy register C-10 (2026-10-27).

## The question

The copy register lists "validated" as a refused word, and `hc.cuff.device` uses it. The refused-claims rule exists to stop Tarragon claiming that its own product or advice is validated. Telling a person to choose a validated THIRD-PARTY device (one listed by the independent stridebp.org register) is clinical advice about what to buy, not a claim about Tarragon. So there are two honest readings, and the signed text is the CMO's to decide:

- A. Keep "validated" because it is advice about someone else's device (the current signed text, no change).
- B. Replace it with a pointer to the list (proposed text below), which keeps the advice and avoids the refused word.

The founder, acting as CMO, decides. Until then the app ships the signed text and the pin test enforces it.

## Current signed wording (version 1, live)

| Key | Text |
|---|---|
| `hc.cuff.device` | Choose a validated upper-arm device. You can check the model at stridebp.org. |
| `hc.cuff.pregnancy` | In pregnancy, use a device that has been validated for pregnancy. |

Signed hash of all 34 `hc.cuff.*` strings: `1179c39d263814d87b9563886afd9fc18f2764d58368f29f0bb53318033162cf` (matches `wordingSha256` in the version 1 seed; enforced by `packages/i18n/src/cuff-wording-pin.test.ts`).

## Proposed wording

| Key | Proposed text |
|---|---|
| `hc.cuff.device` | Choose a cuff that appears on the stridebp.org list of validated devices. |
| `hc.cuff.pregnancy` | In pregnancy, choose a cuff on the stridebp.org list that has been validated for pregnancy. |

Option B1 (device line only, pregnancy line unchanged): hash `fc9b8da5051aad8e7484d8e0a71cf509675cf3ba2e5899b43ffa073303b7290e`.
Option B2 (both lines, as above): hash `694f7515400f53e764a573dfcdccf265775ae6cd08d9f4244640727ed3755ab1`.

Note that both proposals still contain the word "validated", now attributed to the stridebp.org list. If the CMO wants the word gone entirely, the device line could read "Choose a cuff and look up its model on stridebp.org before you buy." (hash not computed; recompute with the method below).

Hash method: sort the `hc.cuff.*` keys, join as `key=text\n`, SHA-256 (`cuffWordingHash` in the pin test).

## What shipping a change takes (draft, NOT applied, NOT a migration file)

1. A new migration (timestamp from the real clock, never hand-typed) adds version 2, unsigned and inactive, copying the sizes from the live signed row:

```sql
insert into public.bp_cuff_guidance_signoffs (version, is_active, config, notes)
select 2, false,
       jsonb_set(config, '{wordingSha256}', to_jsonb('<HASH OF THE CHOSEN OPTION>'::text)),
       'Version 2: device and pregnancy lines point to the stridebp.org list (W-35)'
from public.bp_cuff_guidance_signoffs
where is_active;
```

2. The CMO signs version 2 on `/clinician/clinical-signoff` (the existing signing RPC activates it and retires version 1).
3. In the same release, `en.ts` takes the new text and `cuff-wording-pin.test.ts` compares against the version 2 hash. Code must not ship before the row is signed, or the shipped wording would be unsigned.

## Guard until then

`cuff-wording-pin.test.ts` fails if the shipped `hc.cuff.*` strings differ from the signed hash, so nobody can change the wording without a new signed row.

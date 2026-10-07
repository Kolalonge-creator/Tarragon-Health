/**
 * Catalogue keys (in `@tarragon/i18n`, namespace `pathway`) for each explanation code a pathway rule can return. The wording is DRAFT:
 * it is clinical copy and the CMO signs it like the EMG and TRI codes; nothing here claims it is signed.
 */
export interface PathwayMessageKeys { readonly title: string; readonly body: string }
const keys = (stem: string): PathwayMessageKeys => ({ title: `${stem}.title`, body: `${stem}.body` });

export const PATHWAY_MESSAGE_KEYS: Readonly<Record<string, PathwayMessageKeys>> = {
  "PW-DM-RED": keys("pathway.dm_red"),
  "PW-DM-DKA": keys("pathway.dm_dka"),
  "PW-DM-LOW": keys("pathway.dm_low"),
  "PW-DM-REVIEW": keys("pathway.dm_review"),
  "PW-DM-LOGGED": keys("pathway.logged"),
  "PW-AS-RED": keys("pathway.as_red"),
  "PW-GEN-REVIEW": keys("pathway.gen_review"),
  "PW-GEN-LOGGED": keys("pathway.logged"),
};

export const pathwayMessageKeyFor = (code: string | null): PathwayMessageKeys | null => (code === null ? null : (PATHWAY_MESSAGE_KEYS[code] ?? null));

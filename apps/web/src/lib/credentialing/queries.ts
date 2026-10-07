import { createClient } from "@/lib/supabase/server";
import { rpcParsed } from "./rpc";
import {
  contentSchema,
  detailSchema,
  expiryOverviewSchema,
  myApplicationSchema,
  myCredentialStatusSchema,
  queueSchema,
  startTestSchema,
  type ApplicationDetail,
  type CredentialingContent,
  type ExpiryRow,
  type MyApplication,
  type MyCredentialStatus,
  type QueueRow,
} from "./schemas";
import { z } from "zod";

/**
 * Page reads for credentialing (S15). Each is one call to a database function that checks who is asking: a person
 * who may not see a thing gets a refusal from the database, not an empty list the page has to interpret.
 */
export async function getMyApplication(): Promise<MyApplication | null> {
  return rpcParsed(await createClient(), "my_clinician_application", {}, myApplicationSchema);
}

export async function getMyCredentialStatus(): Promise<MyCredentialStatus | null> {
  return rpcParsed(await createClient(), "my_credential_status", {}, myCredentialStatusSchema);
}

export async function getReviewQueue(): Promise<QueueRow[]> {
  return rpcParsed(await createClient(), "credentialing_queue", {}, queueSchema);
}

export async function getApplicationDetail(id: string): Promise<ApplicationDetail> {
  return rpcParsed(await createClient(), "credentialing_application_detail", { p_application: z.uuid().parse(id) }, detailSchema);
}

export async function getExpiryOverview(): Promise<ExpiryRow[]> {
  return rpcParsed(await createClient(), "credentialing_expiry_overview", {}, expiryOverviewSchema);
}

export async function getContent(): Promise<CredentialingContent> {
  return rpcParsed(await createClient(), "credentialing_content", {}, contentSchema);
}

/** The scenarios of the applicant's open attempt (no answer key). Resumes the attempt; never creates one. */
export async function getOpenTest(applicationId: string): Promise<z.infer<typeof startTestSchema>> {
  return rpcParsed(await createClient(), "start_credential_test", { p_application: applicationId }, startTestSchema);
}

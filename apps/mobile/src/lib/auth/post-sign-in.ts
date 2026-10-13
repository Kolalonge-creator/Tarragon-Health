import { recordLoginDevice, type RpcApi } from "./device-recognition";

/**
 * Runs once per real sign-in (App.tsx, on the SIGNED_IN event), after the
 * session exists. Best effort and must never block or fail the sign-in:
 * record the device (new-device notice).
 */
export interface PostSignInResult {
  deviceRecorded: boolean;
}

export async function runPostSignIn(deps: { userId: string; rpc: RpcApi }): Promise<PostSignInResult> {
  const deviceRecorded = await recordLoginDevice(deps.rpc);
  return { deviceRecorded };
}

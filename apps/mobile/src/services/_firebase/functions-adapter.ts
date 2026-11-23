import { httpsCallable } from 'firebase/functions';
import { ensureFirebaseReady, getFirebaseFunctions } from './firebase-app';

export async function callCloudFunction<TReq = Record<string, any>, TRes = any>(
  name: string,
  payload: TReq,
  { timeoutMs = 120_000 }: { timeoutMs?: number } = {},
): Promise<TRes> {
  ensureFirebaseReady();
  const fn = httpsCallable<TReq, TRes>(getFirebaseFunctions(), name, { timeout: timeoutMs });
  const result = await fn(payload);
  return result.data;
}

import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '../_firebase/firebase-service.js';

/**
 * Calls the `enhanceFoodImage` Cloud Function.
 *
 * @param {Object} input
 * @param {{ base64: string, mimeType: string }} input.image - Original image.
 * @param {{ lighting?: string, angle?: string, surface?: string, styling?: string }} [input.parameters]
 *        Optional axis overrides; unset axes are chosen by the model.
 * @param {string} [input.instruction] - Free-text user note (Hebrew or English).
 * @returns {Promise<{ base64: string, mimeType: string, selectedParameters: Object }>}
 */
export async function enhanceFoodImage({ image, parameters, instruction } = {}) {
  if (!image || !image.base64) {
    throw new Error('image payload is required');
  }
  const fns = getFunctions(getFirebaseApp());
  const fn = httpsCallable(fns, 'enhanceFoodImage');
  const payload = { image };
  if (parameters) payload.parameters = parameters;
  if (instruction) payload.instruction = instruction;
  const result = await fn(payload);
  const data = result?.data;
  if (!data || !data.base64) throw new Error('Empty response from enhancement service');
  return data;
}

const { GoogleGenAI } = require('@google/genai');
const { defineSecret } = require('firebase-functions/params');

const geminiApiKey = defineSecret('GEMINI_API_KEY');

function createClient() {
  if (!geminiApiKey.value()) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

/**
 * Returns a recipe extraction response's text, or throws when Gemini sent none
 * (blocked prompt, recitation stop, token limit…). Why it stopped is logged and
 * kept in the error message, which also lands in `failed_url_extractions`.
 *
 * @param {Object} response - A `generateContent` response.
 * @param {string} label - Which call this was, for the log line.
 * @returns {string}
 */
function requireRecipeText(response, label) {
  const text = response?.text;
  if (text) return text;

  const candidate = response?.candidates?.[0];
  const reason = {
    finishReason: candidate?.finishReason,
    finishMessage: candidate?.finishMessage,
    blockReason: response?.promptFeedback?.blockReason,
    blockReasonMessage: response?.promptFeedback?.blockReasonMessage,
  };
  console.warn(`[gemini] ${label}: empty response`, JSON.stringify(reason));
  const why = reason.blockReason || reason.finishReason || 'unknown';
  throw new Error(`Could not extract valid recipe data - Gemini returned no text (${why})`);
}

module.exports = {
  geminiApiKey,
  createClient,
  requireRecipeText,
};

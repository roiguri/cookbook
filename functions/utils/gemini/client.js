const { GoogleGenAI } = require('@google/genai');
const { defineSecret } = require('firebase-functions/params');

const geminiApiKey = defineSecret('GEMINI_API_KEY');

function createClient() {
  if (!geminiApiKey.value()) {
    throw new Error('GEMINI_API_KEY is not set');
  }
  return new GoogleGenAI({ apiKey: geminiApiKey.value() });
}

module.exports = {
  geminiApiKey,
  createClient,
};

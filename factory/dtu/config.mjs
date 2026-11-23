/**
 * Shared configuration & port map for the Cookbook Digital Twin Universe (DTU).
 * Reads Firebase emulator ports from `firebase.json` so there is one source of truth.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const firebaseJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase.json'), 'utf8'));
const emu = firebaseJson.emulators || {};

export const DTU_CONFIG = Object.freeze({
  projectId: process.env.DTU_PROJECT_ID || 'demo-cookbook',
  bucket: process.env.DTU_BUCKET || `${process.env.DTU_PROJECT_ID || 'demo-cookbook'}.appspot.com`,
  host: process.env.DTU_HOST || '127.0.0.1',
  ports: Object.freeze({
    auth: Number(process.env.DTU_AUTH_PORT || emu.auth?.port || 9099),
    firestore: Number(process.env.DTU_FIRESTORE_PORT || emu.firestore?.port || 8080),
    storage: Number(process.env.DTU_STORAGE_PORT || emu.storage?.port || 9199),
    functions: Number(process.env.DTU_FUNCTIONS_PORT || emu.functions?.port || 5001),
    seed: Number(process.env.DTU_SEED_PORT || 9200),
    gemini: Number(process.env.DTU_GEMINI_PORT || 9201),
    fcm: Number(process.env.DTU_FCM_PORT || 9202),
    resize: Number(process.env.DTU_RESIZE_PORT || 9203),
  }),
});

export function dtuUrls(config = DTU_CONFIG) {
  const h = config.host;
  const p = config.ports;
  return {
    auth: `http://${h}:${p.auth}`,
    firestore: `http://${h}:${p.firestore}`,
    storage: `http://${h}:${p.storage}`,
    functions: `http://${h}:${p.functions}/${config.projectId}/us-central1`,
    seed: `http://${h}:${p.seed}`,
    gemini: `http://${h}:${p.gemini}`,
    fcm: `http://${h}:${p.fcm}`,
    resize: `http://${h}:${p.resize}`,
  };
}

/**
 * Minimal JSON body parser for Node's http.IncomingMessage.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} [maxBytes]
 * @returns {Promise<any>}
 */
export function readJsonBody(req, maxBytes = 25 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(new Error(`Invalid JSON body: ${err.message}`));
      }
    });
    req.on('error', reject);
  });
}

export function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

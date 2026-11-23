/**
 * Shared push-notification device schema & deterministic device-ID helpers.
 * Used across Web SPA, React Native (iOS & Android), and Cloud Functions.
 *
 * Firestore location: `users/{uid}/devices/{deviceId}`
 * Document shape:
 *   {
 *     token: string,                       // non-empty FCM token (<= 4096 chars)
 *     platform: 'web' | 'android' | 'ios', // determines FCM channel payload
 *     ua?: string,                         // optional device label / UA (<= 200 chars)
 *     updatedAt: Timestamp | Date,         // last registration/refresh time
 *   }
 */

export const PUSH_PLATFORMS = Object.freeze({
  WEB: 'web',
  ANDROID: 'android',
  IOS: 'ios',
});

export const PUSH_PLATFORM_LIST = Object.freeze(Object.values(PUSH_PLATFORMS));
export const MAX_PUSH_TOKEN_LENGTH = 4096;
export const MAX_PUSH_UA_LENGTH = 200;

/**
 * @param {*} value
 * @returns {boolean}
 */
export function isValidPushPlatform(value) {
  return typeof value === 'string' && PUSH_PLATFORM_LIST.includes(value);
}

// Synchronous, dependency-free SHA-256 (FIPS 180-4) so deviceIdForToken() works
// identically in Browsers, Node, Jest/jsdom, and React Native (Hermes).
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function utf8Bytes(str) {
  const bytes = [];
  for (let i = 0; i < str.length; i++) {
    let code = str.charCodeAt(i);
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < str.length) {
      const low = str.charCodeAt(++i);
      code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
      bytes.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    }
  }
  return bytes;
}

function sha256Hex(input) {
  const bytes = utf8Bytes(input);
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-bit big-endian length (high 32 bits then low 32 bits)
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  bytes.push(
    (hi >>> 24) & 0xff,
    (hi >>> 16) & 0xff,
    (hi >>> 8) & 0xff,
    hi & 0xff,
    (lo >>> 24) & 0xff,
    (lo >>> 16) & 0xff,
    (lo >>> 8) & 0xff,
    lo & 0xff,
  );

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] =
        ((bytes[offset + i * 4] << 24) |
          (bytes[offset + i * 4 + 1] << 16) |
          (bytes[offset + i * 4 + 2] << 8) |
          bytes[offset + i * 4 + 3]) >>>
        0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7].map((v) => v.toString(16).padStart(8, '0')).join('');
}

/**
 * Deterministic, Firestore-safe device document ID derived from an FCM token.
 * Registering the same token twice always overwrites the exact same doc idempotently.
 * @param {string} token
 * @returns {string} 32 lowercase hex characters
 */
export function deviceIdForToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('deviceIdForToken: non-empty token string is required');
  }
  return sha256Hex(token).slice(0, 32);
}

/**
 * Build and validate a `users/{uid}/devices/{deviceId}` payload matching firestore.rules.
 * @param {{ token: string, platform: 'web'|'android'|'ios', ua?: string, updatedAt: * }} params
 * @returns {{ token: string, platform: 'web'|'android'|'ios', updatedAt: *, ua?: string }}
 */
export function buildDeviceRecord({ token, platform, ua, updatedAt }) {
  if (typeof token !== 'string' || !token.trim() || token.length > MAX_PUSH_TOKEN_LENGTH) {
    throw new Error('buildDeviceRecord: valid token is required');
  }
  if (!isValidPushPlatform(platform)) {
    throw new Error(`buildDeviceRecord: platform must be one of ${PUSH_PLATFORM_LIST.join(', ')}`);
  }
  if (!updatedAt) {
    throw new Error('buildDeviceRecord: updatedAt timestamp is required');
  }
  const record = { token, platform, updatedAt };
  if (typeof ua === 'string' && ua.length > 0) {
    record.ua = ua.slice(0, MAX_PUSH_UA_LENGTH);
  }
  return record;
}

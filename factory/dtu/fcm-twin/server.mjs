/**
 * FCM Push Delivery Digital Twin (:9202)
 *
 * Captures all outgoing per-platform FCM batches from `functions/notifications.js`
 * when `FUNCTIONS_EMULATOR=true` & `FCM_TWIN_URL` is configured.
 *
 * Features:
 *   - GET  /health            -> readiness + captured message count
 *   - GET  /messages          -> list captured messages (?platform=web|android|ios)
 *   - POST /send              -> called by functions/notifications.js; returns standard multicast response
 *   - POST /invalid-tokens    -> register tokens to fail with `messaging/registration-token-not-registered`
 *   - POST /deliver-simulated -> trigger a simulated native push onto Android Emulator (`adb`) or iOS Simulator (`xcrun simctl push`)
 *   - POST /reset             -> clear captured messages and invalid token list
 */
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DTU_CONFIG, readJsonBody, sendJson } from '../config.mjs';

export function createFcmTwinServer() {
  const state = {
    messages: [],
    invalidTokens: new Set(),
    nextId: 1,
  };

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && urlObj.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'fcm-twin',
        count: state.messages.length,
        invalidTokens: state.invalidTokens.size,
      });
    }

    if (req.method === 'GET' && urlObj.pathname === '/messages') {
      const platformFilter = urlObj.searchParams.get('platform');
      const recipeIdFilter = urlObj.searchParams.get('recipeId');
      let items = state.messages;
      if (platformFilter) items = items.filter((m) => m.platform === platformFilter);
      if (recipeIdFilter) items = items.filter((m) => m.message?.data?.recipeId === recipeIdFilter);
      return sendJson(res, 200, { messages: items });
    }

    if (req.method === 'POST' && urlObj.pathname === '/reset') {
      state.messages = [];
      state.invalidTokens.clear();
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && urlObj.pathname === '/invalid-tokens') {
      try {
        const body = await readJsonBody(req);
        state.invalidTokens.clear();
        for (const tok of body.tokens || []) {
          if (typeof tok === 'string' && tok) state.invalidTokens.add(tok);
        }
        return sendJson(res, 200, { ok: true, count: state.invalidTokens.size });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'POST' && urlObj.pathname === '/send') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const platform = body.platform || 'unknown';
      const message = body.message || {};
      const tokens = Array.isArray(message.tokens) ? message.tokens : [];

      const responses = tokens.map((token) => {
        if (state.invalidTokens.has(token)) {
          return {
            success: false,
            error: {
              code: 'messaging/registration-token-not-registered',
              message: 'DTU simulated invalid token',
            },
          };
        }
        return { success: true, messageId: `dtu-msg-${state.nextId++}` };
      });

      const successCount = responses.filter((r) => r.success).length;
      const failureCount = responses.length - successCount;

      state.messages.push({
        id: `batch-${state.messages.length + 1}`,
        receivedAt: new Date().toISOString(),
        platform,
        message,
        successCount,
        failureCount,
      });

      return sendJson(res, 200, { successCount, failureCount, responses });
    }

    if (req.method === 'POST' && urlObj.pathname === '/deliver-simulated') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const {
        platform,
        title = 'מתכון חדש ממתין לאישור',
        body: alertBody = 'שקשוקה',
        url = '/dashboard',
        bundleId = 'com.roiguri.cookbook.e2e',
        deviceId = 'booted',
        data = {},
      } = body;

      if (platform === 'ios') {
        const payloadPath = path.join(os.tmpdir(), `dtu-apns-${Date.now()}.json`);
        const apnsPayload = {
          aps: { alert: { title, body: alertBody }, sound: 'default' },
          url,
          ...data,
        };
        fs.writeFileSync(payloadPath, JSON.stringify(apnsPayload));
        const run = spawnSync('xcrun', ['simctl', 'push', deviceId, bundleId, payloadPath], {
          encoding: 'utf8',
          timeout: 15000,
        });
        fs.rmSync(payloadPath, { force: true });
        return sendJson(res, run.status === 0 ? 200 : 500, {
          ok: run.status === 0,
          platform: 'ios',
          stdout: run.stdout,
          stderr: run.stderr,
        });
      }

      if (platform === 'android') {
        const adbArgs = [];
        if (deviceId && deviceId !== 'booted') adbArgs.push('-s', deviceId);
        adbArgs.push(
          'shell',
          'am',
          'broadcast',
          '-a',
          `${bundleId}.DTU_PUSH`,
          '-n',
          `${bundleId}/.MainActivity`,
          '--es',
          'title',
          title,
          '--es',
          'body',
          alertBody,
          '--es',
          'url',
          url,
        );
        const run = spawnSync('adb', adbArgs, { encoding: 'utf8', timeout: 15000 });
        return sendJson(res, run.status === 0 ? 200 : 500, {
          ok: run.status === 0,
          platform: 'android',
          stdout: run.stdout,
          stderr: run.stderr,
        });
      }

      return sendJson(res, 400, { error: 'platform must be "android" or "ios"' });
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  return { server, state };
}

export function startFcmTwin({ host = DTU_CONFIG.host, port = DTU_CONFIG.ports.fcm } = {}) {
  const { server, state } = createFcmTwinServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const addr = server.address();
      resolve({
        server,
        state,
        port: addr.port,
        url: `http://${host}:${addr.port}`,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFcmTwin().then(({ url }) => {
    console.log(`[fcm-twin] listening on ${url}`);
  });
}

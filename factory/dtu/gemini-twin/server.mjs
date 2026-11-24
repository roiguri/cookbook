/**
 * Gemini AI Digital Twin (:9201)
 *
 * Deterministic local twin of Gemini's `models.generateContent` API used strictly
 * when `FUNCTIONS_EMULATOR=true` & `GEMINI_TWIN_URL` is set. Covers all 4
 * Cookbook Cloud Functions:
 *   - extractRecipeFromImage
 *   - extractRecipeFromUrl
 *   - extractRecipeFromVideo (YouTube)
 *   - enhanceFoodImage (both parameter auto-selection and image generation)
 *
 * Supports controllable artificial delay (to test async-wait filler mini-games)
 * and fault injection (via POST /config or URL query params `dtu_fault=...`).
 */
import http from 'node:http';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DTU_CONFIG, readJsonBody, sendJson } from '../config.mjs';

// Deterministic valid 16x16 warm herb-green PNG (base64, zlib/CRC32 verified) for enhanceFoodImage twin responses.
export const DETERMINISTIC_ENHANCED_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAIElEQVR4nGP49OI8SYiBTA1ZM/0IolENoxqI0UDD1AoAydbnkEIbojoAAAAASUVORK5CYII=';

const FIXTURE_RECIPES = {
  image: {
    name: 'עוגת שוקולד ביתית מתמונה',
    description: 'עוגת שוקולד עשירה ונימוחה שחולצה מתמונה בתאום הדיגיטלי',
    prepTime: 20,
    waitTime: 40,
    servings: 12,
    servingsUnit: 'פרוסות',
    difficulty: 'קלה',
    category: 'desserts',
    mainIngredient: 'שוקולד מריר',
    ingredients: [
      { item: 'שוקולד מריר', amount: 200, unit: 'גרם' },
      { item: 'קמח לבן', amount: 1.5, unit: 'כוסות' },
      { item: 'ביצים', amount: 3, unit: null },
      { item: 'סוכר', amount: 1, unit: 'כוס' },
      { item: 'קורט מלח', amount: null, unit: null },
    ],
    ingredientSections: null,
    instructions: [
      'מחממים תנור ל-180 מעלות ומשמנים תבנית.',
      'ממיסים שוקולד ומערבבים עם הביצים והסוכר.',
      'מקפלים קמח ומלח ואופים כ-35 דקות.',
    ],
    stages: null,
    comments: ['טעימה במיוחד חמה עם כדור גלידה'],
    tags: ['שוקולד', 'עוגות', 'מהיר'],
  },
  url: {
    name: 'שקשוקה משפחתית מקישור',
    description: 'שקשוקה קלאסית ברוטב עגבניות עשיר שחולצה מקישור',
    prepTime: 15,
    waitTime: 15,
    servings: 4,
    servingsUnit: 'מנות',
    difficulty: 'קלה',
    category: 'breakfast-brunch',
    mainIngredient: 'עגבניות',
    ingredients: [
      { item: 'עגבניות בשלות', amount: 6, unit: null },
      { item: 'ביצים', amount: 4, unit: null },
      { item: 'שום כתוש', amount: 3, unit: 'שיניים' },
      { item: 'שמן זית', amount: 2, unit: 'כפות' },
      { item: 'מלח ופלפל לפי הטעם', amount: null, unit: null },
    ],
    ingredientSections: null,
    instructions: [
      'מטגנים שום בשמן זית כדקה עד שעולה ריח.',
      'מוסיפים עגבניות קצוצות ומבשלים 15 דקות להסמכה.',
      'יוצרים גומות, שוברים ביצים ומכסים עד לדרגת העשייה הרצויה.',
    ],
    stages: null,
    comments: ['להגיש עם לחם טרי לניגוב'],
    tags: ['ארוחת בוקר', 'שקשוקה', 'ישראלי'],
  },
  video: {
    name: "פוקאצ'ה אוורירית מסרטון",
    description: "פוקאצ'ה איטלקית עם שמן זית ורוזמרין שחולצה מסרטון יוטיוב",
    prepTime: 25,
    waitTime: 90,
    servings: 8,
    servingsUnit: 'חתיכות',
    difficulty: 'בינונית',
    category: 'breads-pastries',
    mainIngredient: 'קמח',
    ingredients: null,
    ingredientSections: [
      {
        title: 'לבצק',
        items: [
          { item: 'קמח לחם', amount: 500, unit: 'גרם' },
          { item: 'מים פושרים', amount: 380, unit: 'מ"ל' },
          { item: 'שמרים יבשים', amount: 1, unit: 'כפית' },
        ],
      },
      {
        title: 'לציפוי',
        items: [
          { item: 'שמן זית', amount: 3, unit: 'כפות' },
          { item: 'מלח גס ורוזמרין', amount: null, unit: null },
        ],
      },
    ],
    instructions: null,
    stages: [
      {
        title: 'הכנת הבצק והתפחה',
        instructions: ['מערבבים קמח, מים ושמרים לבצק רך.', 'מתפיחים שעה וחצי עם שני קיפולים בדרך.'],
      },
      {
        title: 'עיצוב ואפייה',
        instructions: [
          'מעבירים לתבנית משומנת, יוצרים גומות ומזלפים שמן זית.',
          'אופים ב-220 מעלות כ-20 דקות עד להשחמה.',
        ],
      },
    ],
    comments: ['מומלץ לתת לבצק מנוחה קרה ללילה'],
    tags: ['לחם', 'אפייה', 'איטלקי'],
  },
};

function flattenPromptText(contents) {
  if (!Array.isArray(contents)) return String(contents || '');
  return contents
    .map((entry) => {
      if (typeof entry === 'string') return entry;
      if (entry && Array.isArray(entry.parts)) {
        return entry.parts
          .map((p) => (typeof p === 'string' ? p : p.text || p.fileData?.fileUri || ''))
          .join('\n');
      }
      return '';
    })
    .join('\n');
}

function classifyRequest({ model = '', contents = [], config = {} }) {
  const promptText = flattenPromptText(contents);
  const parts = Array.isArray(contents)
    ? contents.flatMap((c) => (c && Array.isArray(c.parts) ? c.parts : []))
    : [];

  if (String(model).includes('image')) {
    return { kind: 'enhance-image', promptText };
  }
  if (config?.responseSchema?.properties?.lighting) {
    return { kind: 'enhance-params', promptText };
  }
  if (parts.some((p) => p?.fileData?.fileUri)) {
    return { kind: 'video', promptText };
  }
  if (
    (Array.isArray(config?.tools) && config.tools.some((t) => t && 'urlContext' in t)) ||
    promptText.includes('URL to analyze:')
  ) {
    return { kind: 'url', promptText };
  }
  if (promptText.includes('Convert the following recipe text into a valid JSON object')) {
    return { kind: 'url-cleanup', promptText };
  }
  if (parts.some((p) => p?.inlineData?.data)) {
    return { kind: 'image', promptText };
  }
  return { kind: 'unknown', promptText };
}

function extractUrlMarker(promptText, paramName) {
  const re = new RegExp(`[?&]${paramName}=([a-zA-Z0-9_-]+)`);
  const match = promptText.match(re);
  return match ? match[1] : null;
}

export function createGeminiTwinServer() {
  const state = {
    requests: [],
    delayMs: 0,
    fault: null,
  };

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');

    if (req.method === 'GET' && urlObj.pathname === '/health') {
      return sendJson(res, 200, {
        ok: true,
        service: 'gemini-twin',
        requests: state.requests.length,
        delayMs: state.delayMs,
        fault: state.fault,
      });
    }

    if (req.method === 'GET' && urlObj.pathname === '/requests') {
      return sendJson(res, 200, { requests: state.requests });
    }

    if (req.method === 'POST' && urlObj.pathname === '/reset') {
      state.requests = [];
      state.delayMs = 0;
      state.fault = null;
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && urlObj.pathname === '/config') {
      try {
        const body = await readJsonBody(req);
        if (typeof body.delayMs === 'number' && body.delayMs >= 0) state.delayMs = body.delayMs;
        if ('fault' in body) state.fault = body.fault || null;
        return sendJson(res, 200, { ok: true, delayMs: state.delayMs, fault: state.fault });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }

    if (req.method === 'POST' && urlObj.pathname === '/generateContent') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }

      const { kind, promptText } = classifyRequest(body);
      const urlDelay = Number(extractUrlMarker(promptText, 'dtu_delay_ms') || 0);
      const effectiveDelay = urlDelay > 0 ? urlDelay : state.delayMs;
      if (effectiveDelay > 0) {
        await new Promise((r) => setTimeout(r, Math.min(effectiveDelay, 15000)));
      }

      const urlFault = extractUrlMarker(promptText, 'dtu_fault');
      const activeFault = urlFault || state.fault;

      state.requests.push({
        timestamp: new Date().toISOString(),
        model: body.model || '',
        kind,
        faultApplied: activeFault,
      });

      if (activeFault === 'rate-limit-429' || activeFault === '429') {
        return sendJson(res, 429, {
          error: { code: 429, message: 'RESOURCE_EXHAUSTED (DTU fault injection)' },
        });
      }
      if (activeFault === 'server-error' || activeFault === '500') {
        return sendJson(res, 500, {
          error: { code: 500, message: 'INTERNAL (DTU fault injection)' },
        });
      }
      if (activeFault === 'empty-response' || activeFault === 'empty') {
        return sendJson(res, 200, {
          text: '',
          candidates: [{ finishReason: 'SAFETY', finishMessage: 'DTU simulated empty response' }],
        });
      }
      if (activeFault === 'invalid-json') {
        return sendJson(res, 200, { text: '<<<NOT_VALID_JSON>>>' });
      }
      if (activeFault === 'invalid-recipe') {
        return sendJson(res, 200, { text: JSON.stringify({ name: null, ingredients: [] }) });
      }

      if (kind === 'enhance-params') {
        return sendJson(res, 200, {
          text: JSON.stringify({
            lighting: 'natural',
            angle: 'hero',
            surface: 'wood',
            styling: 'editorial',
          }),
        });
      }

      if (kind === 'enhance-image') {
        return sendJson(res, 200, {
          candidates: [
            {
              content: {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: DETERMINISTIC_ENHANCED_PNG_BASE64,
                    },
                  },
                ],
              },
            },
          ],
        });
      }

      const fixture =
        kind === 'video'
          ? FIXTURE_RECIPES.video
          : kind === 'url' || kind === 'url-cleanup'
            ? FIXTURE_RECIPES.url
            : FIXTURE_RECIPES.image;

      return sendJson(res, 200, {
        text: JSON.stringify(fixture),
        candidates: [{ finishReason: 'STOP' }],
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  });

  return { server, state };
}

export function startGeminiTwin({ host = DTU_CONFIG.host, port = DTU_CONFIG.ports.gemini } = {}) {
  const { server, state } = createGeminiTwinServer();
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
  startGeminiTwin().then(({ url }) => {
    console.log(`[gemini-twin] listening on ${url}`);
  });
}

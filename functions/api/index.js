/**
 * Recipe API — HTTP entry (docs/feature-plans/recipe-api.md). Exported from
 * functions/index.js as `recipeApi`.
 *
 * Every request is authenticated first (so an unauthenticated caller learns nothing
 * but 401), then routed. Handlers that touch recipes run in a session signed in as the
 * token's owner; the session is always closed.
 */
const { authenticate } = require('./auth');
const { openUserSession } = require('./session');
const { handlers: readHandlers } = require('./recipes');
const { handlers: writeHandlers } = require('./write');
const {
  notFound,
  methodNotAllowed,
  forbidden,
  badRequest,
  unsupportedMediaType,
  payloadTooLarge,
  toResponse,
} = require('./errors');

const { parseMultipart } = require('./media');

const handlers = { ...readHandlers, ...writeHandlers };

// Firestore documents are at most 1 MiB; a recipe body never needs more.
const MAX_JSON_BODY_BYTES = 1024 * 1024;

/**
 * The body of a write: JSON, or multipart with the JSON in a `request` part and files.
 * @returns {Promise<{ body: *, files: Map|null }>}
 */
async function readBody(req) {
  if (req.is('multipart/form-data')) {
    const { fields, files } = await parseMultipart(req);
    if (typeof fields.request !== 'string') {
      throw badRequest('A multipart body needs a "request" part with the JSON request.');
    }
    try {
      return { body: JSON.parse(fields.request), files };
    } catch {
      throw badRequest('The "request" part is not valid JSON.');
    }
  }
  return { body: readJsonBody(req), files: null };
}

/** The JSON body of a request, parsed from the raw bytes. */
function readJsonBody(req) {
  if (!req.is('application/json')) throw unsupportedMediaType();
  const raw = req.rawBody;
  if (!raw || raw.length === 0) throw badRequest('The body is empty.');
  if (raw.length > MAX_JSON_BODY_BYTES) {
    throw payloadTooLarge(`The body must be at most ${MAX_JSON_BODY_BYTES} bytes.`);
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw badRequest('The body is not valid JSON.');
  }
}
const { matchRoute } = require('./routes');

let modelPromise;
const loadModel = () => (modelPromise ||= import('../shared/recipe-model.mjs'));

/**
 * Handle one API request.
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {{ db: *, auth: *, Timestamp: *, apiKey: string }} deps
 */
async function handleRequest(req, res, deps) {
  res.set('Cache-Control', 'no-store');
  let routeName = null;
  try {
    const caller = await authenticate(req, deps);

    const match = matchRoute(req.method, req.path || '/');
    if (!match) throw notFound('Unknown endpoint.');
    if (match.methodNotAllowed) throw methodNotAllowed();
    const { route, params } = match;
    routeName = route.handler;
    if (!route.scopes.includes(caller.scope)) {
      throw forbidden('This token does not have the scope for this endpoint.');
    }

    const { body, files } = route.body ? await readBody(req) : {};
    const model = await loadModel();
    let session = null;
    let result;
    let status = 200;
    try {
      if (route.session) {
        session = await openUserSession(caller.uid, { auth: deps.auth, apiKey: deps.apiKey });
      }
      result = await handlers[route.handler]({
        session,
        caller,
        params,
        query: req.query || {},
        body,
        files,
        model,
        setStatus: (code) => {
          status = code;
        },
      });
    } finally {
      // Before responding: after the response the instance's CPU may be throttled.
      await session?.close();
    }
    res.status(status).json(result);
  } catch (error) {
    const { status, body } = toResponse(error);
    // Only the route and an error code: never the token, request content or paths.
    if (status === 500) {
      console.error('[recipeApi] internal error', {
        route: routeName,
        code: error?.code || error?.name || 'unknown',
      });
    }
    res.status(status).json(body);
  }
}

module.exports = { handleRequest };

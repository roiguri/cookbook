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
const { handlers } = require('./recipes');
const { notFound, methodNotAllowed, forbidden, toResponse } = require('./errors');
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

    const model = await loadModel();
    let session = null;
    let result;
    try {
      if (route.session) {
        session = await openUserSession(caller.uid, { auth: deps.auth, apiKey: deps.apiKey });
      }
      result = await handlers[route.handler]({
        session,
        caller,
        params,
        query: req.query || {},
        model,
      });
    } finally {
      // Before responding: after the response the instance's CPU may be throttled.
      await session?.close();
    }
    res.status(200).json(result);
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

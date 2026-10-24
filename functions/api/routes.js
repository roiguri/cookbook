/**
 * Recipe API — the route table (docs/feature-plans/recipe-api.md §3). Pure: no SDKs.
 */
const READ_SCOPES = ['read', 'read+write'];

// Path patterns (after the function name). /recipes/mine must precede /recipes/{id}.
const ROUTES = [
  { method: 'GET', pattern: /^\/v1\/me$/, handler: 'me', scopes: READ_SCOPES },
  { method: 'GET', pattern: /^\/v1\/categories$/, handler: 'categories', scopes: READ_SCOPES },
  {
    method: 'GET',
    pattern: /^\/v1\/recipes\/mine$/,
    handler: 'listMine',
    scopes: READ_SCOPES,
    session: true,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/recipes$/,
    handler: 'listPublished',
    scopes: READ_SCOPES,
    session: true,
  },
  {
    method: 'GET',
    pattern: /^\/v1\/recipes\/([A-Za-z0-9_-]{1,128})$/,
    handler: 'getRecipe',
    params: ['id'],
    scopes: READ_SCOPES,
    session: true,
  },
];

/**
 * The route for a request.
 * @returns {{ route: Object, params: Object } | { methodNotAllowed: true } | null}
 */
function matchRoute(method, path) {
  const normalized = path.replace(/\/+$/, '') || '/';
  let pathMatched = false;
  for (const route of ROUTES) {
    const m = route.pattern.exec(normalized);
    if (!m) continue;
    pathMatched = true;
    if (route.method !== method) continue;
    const params = Object.fromEntries((route.params || []).map((name, i) => [name, m[i + 1]]));
    return { route, params };
  }
  return pathMatched ? { methodNotAllowed: true } : null;
}

module.exports = { matchRoute, ROUTES, READ_SCOPES };

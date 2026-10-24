/**
 * Recipe API errors (docs/feature-plans/recipe-api.md §3). Every failure the caller
 * can act on is an ApiError; the router turns it into `{ error: { code, message } }`.
 * Anything else is a 500 with a generic message — internals never reach the caller.
 */
class ApiError extends Error {
  /**
   * @param {number} status - HTTP status.
   * @param {string} code - Stable machine-readable code.
   * @param {string} message - Human-readable explanation (English).
   */
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const unauthorized = (message = 'A valid API token is required.') =>
  new ApiError(401, 'unauthorized', message);
const forbidden = (message) => new ApiError(403, 'forbidden', message);
const notFound = (message = 'Not found.') => new ApiError(404, 'not-found', message);
const badRequest = (message) => new ApiError(400, 'bad-request', message);
const methodNotAllowed = () =>
  new ApiError(405, 'method-not-allowed', 'This method is not supported here.');
const rateLimited = (message) => new ApiError(429, 'rate-limited', message);

/**
 * The HTTP status and body for any error.
 * @param {*} error
 * @returns {{ status: number, body: { error: { code: string, message: string } } }}
 */
function toResponse(error) {
  if (error instanceof ApiError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  return {
    status: 500,
    body: { error: { code: 'internal', message: 'Something went wrong. Try again later.' } },
  };
}

module.exports = {
  ApiError,
  unauthorized,
  forbidden,
  notFound,
  badRequest,
  methodNotAllowed,
  rateLimited,
  toResponse,
};

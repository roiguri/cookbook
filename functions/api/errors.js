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
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    // Field-level problems the caller can fix: [{ field, message }].
    if (details) this.details = details;
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
const conflict = (message) => new ApiError(409, 'conflict', message);
const invalid = (code, message, details) => new ApiError(400, code, message, details);
const unsupportedMediaType = () =>
  new ApiError(415, 'unsupported-media-type', 'Send the body as application/json.');
const payloadTooLarge = (message) => new ApiError(413, 'payload-too-large', message);
const unavailable = (message) => new ApiError(503, 'unavailable', message);

/**
 * An ApiError for a Firestore failure the caller should hear about; anything else is
 * returned unchanged (and becomes a generic 500).
 * - permission-denied: the rules refused the write (e.g. the owner was demoted mid-call).
 * - invalid-argument about size: the stored recipe would exceed Firestore's 1 MiB.
 * - aborted: the write lost to concurrent ones too often.
 */
function fromFirestoreError(error) {
  if (error instanceof ApiError) return error;
  switch (error?.code) {
    case 'permission-denied':
      return forbidden('The recipe could not be saved for this user.');
    case 'invalid-argument':
      if (/size|bytes|too large/i.test(String(error.message))) {
        return new ApiError(400, 'recipe-too-large', 'The recipe is too large to store.');
      }
      return error;
    case 'aborted':
      return unavailable('Too many simultaneous changes; try again.');
    default:
      return error;
  }
}

/**
 * The HTTP status and body for any error.
 * @param {*} error
 * @returns {{ status: number, body: { error: { code: string, message: string } } }}
 */
function toResponse(error) {
  if (error instanceof ApiError) {
    const body = { error: { code: error.code, message: error.message } };
    if (error.details) body.error.details = error.details;
    return { status: error.status, body };
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
  conflict,
  invalid,
  unsupportedMediaType,
  payloadTooLarge,
  unavailable,
  fromFirestoreError,
  toResponse,
};

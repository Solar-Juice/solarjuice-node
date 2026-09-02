import { retryAfterMs } from './retry.js';

/**
 * Base class for everything this SDK throws.
 *
 * Catching SolarJuiceError catches configuration problems, transport failures
 * and API errors alike, so an integration can have one handler at the edge and
 * still narrow to a specific subclass where it matters.
 */
export class SolarJuiceError extends Error {
  /**
   * @param {string} message
   * @param {object} [options]
   * @param {string|null} [options.code] Machine readable code from the API, where there is one.
   * @param {Array<object>} [options.details] Per field problems from the API.
   * @param {string|null} [options.requestId] X-Request-Id, quote it in support requests.
   * @param {number|null} [options.statusCode] HTTP status, null for transport and configuration errors.
   * @param {unknown} [options.cause]
   */
  constructor(message, options = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.code = options.code ?? null;
    this.details = options.details ?? [];
    this.requestId = options.requestId ?? null;
    this.statusCode = options.statusCode ?? null;
  }
}

/** The client was constructed without an API key, or with unusable options. */
export class ConfigurationError extends SolarJuiceError {
  constructor(message) {
    super(message, { code: 'CONFIGURATION_ERROR' });
  }
}

/**
 * The request never produced an HTTP response: DNS, TLS, a dropped socket or
 * an aborted fetch. Retried by the transport up to maxRetries.
 */
export class TransportError extends SolarJuiceError {
  constructor(message, options = {}) {
    super(message, { ...options, code: options.code ?? 'TRANSPORT_ERROR' });
  }
}

/** The request exceeded the client timeout. */
export class TimeoutError extends TransportError {
  constructor(message, options = {}) {
    super(message, { ...options, code: 'TIMEOUT' });
  }
}

/* One subclass per ErrorCode in the OpenAPI document. */

/** 401: missing, malformed, revoked or wrong environment key. */
export class UnauthorizedError extends SolarJuiceError {}
/** 403: the key lacks the scope for this operation, or the channel is suspended. */
export class ForbiddenError extends SolarJuiceError {}
/** 404: no such SKU, order or route for this channel. */
export class NotFoundError extends SolarJuiceError {}
/** 422: the request did not validate. `details` lists every problem found. */
export class ValidationFailedError extends SolarJuiceError {}
/** 429: the key's allowance is exhausted. `retryAfter` is set when the header was present. */
export class RateLimitedError extends SolarJuiceError {
  constructor(message, options = {}) {
    super(message, options);
    /** @type {number|null} Seconds to wait, from Retry-After. */
    this.retryAfter = options.retryAfter ?? null;
  }
}
/** 409: submitted prices or price_list_version no longer match. `details` carries current values. */
export class PriceChangedError extends SolarJuiceError {}
/** 409: the same client_reference was submitted with a different body. */
export class IdempotencyConflictError extends SolarJuiceError {}
/** 503: the freight engine is temporarily unreachable. Honour `retryAfter`. */
export class QuoteUnavailableError extends SolarJuiceError {
  constructor(message, options = {}) {
    super(message, options);
    /** @type {number|null} Seconds to wait, from Retry-After. */
    this.retryAfter = options.retryAfter ?? null;
  }
}
/** 503: the data behind the request is too old to serve safely. */
export class StaleDataError extends SolarJuiceError {}
/** 500: an unexpected failure at the API. Retry with backoff, then report the request id. */
export class InternalError extends SolarJuiceError {}

/** Error code to class. The code in the body is the primary signal. */
const BY_CODE = new Map([
  ['UNAUTHORIZED', UnauthorizedError],
  ['FORBIDDEN', ForbiddenError],
  ['NOT_FOUND', NotFoundError],
  ['VALIDATION_FAILED', ValidationFailedError],
  ['RATE_LIMITED', RateLimitedError],
  ['PRICE_CHANGED', PriceChangedError],
  ['IDEMPOTENCY_CONFLICT', IdempotencyConflictError],
  ['QUOTE_UNAVAILABLE', QuoteUnavailableError],
  ['STALE_DATA', StaleDataError],
  ['INTERNAL', InternalError],
]);

/**
 * Status to class, used when the body is not the documented error envelope
 * (a proxy 502, an HTML error page from an edge, a truncated response).
 *
 * 409 and 503 are deliberately absent: each covers two codes, so without a
 * body there is nothing to choose between them and the base class is the
 * honest answer.
 */
const BY_STATUS = new Map([
  [401, UnauthorizedError],
  [403, ForbiddenError],
  [404, NotFoundError],
  [422, ValidationFailedError],
  [429, RateLimitedError],
  [500, InternalError],
]);

/**
 * Build the error for a failed HTTP response.
 *
 * The error code enumeration is open, so an unrecognised code is carried
 * through on the base class rather than dropped: the caller still sees
 * `error.code` and can act on it before the SDK is updated.
 *
 * @param {number} status
 * @param {Headers} headers
 * @param {unknown} body Decoded JSON body, or null when it was not JSON.
 * @param {string} [rawBody] The response text, used for the message when there is no envelope.
 * @returns {SolarJuiceError}
 */
export function errorFromResponse(status, headers, body, rawBody = '') {
  const envelope = body && typeof body === 'object' ? body.error : null;
  const documented = envelope && typeof envelope === 'object';

  const code = documented && typeof envelope.code === 'string' ? envelope.code : null;
  const ErrorClass = (code && BY_CODE.get(code)) || BY_STATUS.get(status) || SolarJuiceError;

  const message = documented && typeof envelope.message === 'string'
    ? envelope.message
    : defaultMessage(status, rawBody);

  const retryAfterHeader = retryAfterMs(headers?.get?.('Retry-After'));

  return new ErrorClass(message, {
    code: code ?? codeForStatus(status),
    details: documented && Array.isArray(envelope.details) ? envelope.details : [],
    requestId: (documented && typeof envelope.request_id === 'string' ? envelope.request_id : null)
      ?? headers?.get?.('X-Request-Id')
      ?? null,
    statusCode: status,
    retryAfter: retryAfterHeader === null ? null : Math.ceil(retryAfterHeader / 1000),
  });
}

function codeForStatus(status) {
  for (const [code, ErrorClass] of BY_CODE) {
    if (BY_STATUS.get(status) === ErrorClass) return code;
  }
  return null;
}

function defaultMessage(status, rawBody) {
  const snippet = rawBody.trim().slice(0, 200);
  return snippet
    ? `HTTP ${status} from the Solar Juice Partner API: ${snippet}`
    : `HTTP ${status} from the Solar Juice Partner API`;
}

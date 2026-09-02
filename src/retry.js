/**
 * Retry policy shared by the transport and the error types.
 *
 * The policy is fixed rather than configurable because it is part of the
 * partner API contract: every Solar Juice SDK backs off the same way, so a
 * misbehaving integration looks the same in the API logs whatever language it
 * was written in. Only the number of attempts (maxRetries) is a caller knob.
 */

/**
 * Statuses worth trying again. 429 is a rate limit, 502/503/504 are transient
 * edge or upstream failures. Every other 4xx is a client mistake that will
 * fail identically on a second attempt.
 */
export const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

export const INITIAL_BACKOFF_MS = 500;
export const MAX_BACKOFF_MS = 8000;

/**
 * The longest Retry-After this client will actually wait out.
 *
 * The API's own values are seconds, but an edge proxy in front of it is not
 * bound by that and can advise an hour. Sleeping that long inside a caller's
 * request is worse than failing, so anything above the cap raises immediately
 * with the real value on the error.
 */
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Full jitter exponential backoff: a uniform pick from [0, ceiling] rather
 * than the ceiling itself, so a fleet of workers that hit a 429 together does
 * not come back as a synchronised thundering herd.
 *
 * @param {number} attempt Zero based index of the retry about to be made.
 * @param {() => number} [random] Injectable for deterministic tests.
 * @returns {number} Delay in milliseconds.
 */
export function backoffDelay(attempt, random = Math.random) {
  const ceiling = Math.min(MAX_BACKOFF_MS, INITIAL_BACKOFF_MS * 2 ** attempt);
  return Math.round(random() * ceiling);
}

/**
 * Parse a Retry-After header, which RFC 9110 allows to be either a number of
 * seconds or an HTTP date.
 *
 * @param {string|null|undefined} value Raw header value.
 * @param {number} [now] Reference instant in milliseconds, injectable for tests.
 * @returns {number|null} Delay in milliseconds, or null when absent or unparseable.
 */
export function retryAfterMs(value, now = Date.now()) {
  if (value === null || value === undefined) return null;

  const text = String(value).trim();
  if (text === '') return null;

  if (/^\d+$/.test(text)) {
    return Number(text) * 1000;
  }

  const at = Date.parse(text);
  if (Number.isNaN(at)) return null;

  // A date in the past means "retry now", not "retry in the past".
  return Math.max(0, at - now);
}

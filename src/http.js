import {
  ConfigurationError,
  TimeoutError,
  TransportError,
  errorFromResponse,
} from './errors.js';
import { RETRYABLE_STATUSES, backoffDelay, retryAfterMs } from './retry.js';
import { VERSION } from './version.js';

export const DEFAULT_BASE_URL = 'https://api.solarjuice.com.au';
export const DEFAULT_TIMEOUT_SECONDS = 30;
export const DEFAULT_MAX_RETRIES = 3;

/**
 * Everything between a resource method and the network: URL building, auth,
 * timeouts, retries and the observability headers.
 *
 * Resources hold a Transport rather than the client so there is exactly one
 * place that talks to fetch.
 */
export class Transport {
  #apiKey;
  #fetch;
  #sleep;

  /**
   * @param {object} options
   * @param {string} options.apiKey
   * @param {string} [options.baseUrl]
   * @param {number} [options.timeout] Seconds.
   * @param {number} [options.maxRetries]
   * @param {string} [options.userAgent] Suffix appended to the SDK User-Agent.
   * @param {typeof fetch} [options.fetch] Replacement fetch, for proxies or tests.
   * @param {(ms: number) => Promise<void>} [options.sleep] Replacement delay, for tests.
   */
  constructor(options) {
    this.#apiKey = options.apiKey;
    // Trailing slashes would produce "//v1/catalogue" once a path is appended.
    this.baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = numberOption(options.timeout, DEFAULT_TIMEOUT_SECONDS, 'timeout');
    this.maxRetries = numberOption(options.maxRetries, DEFAULT_MAX_RETRIES, 'maxRetries');
    this.userAgent = buildUserAgent(options.userAgent);

    if (options.fetch) {
      this.#fetch = options.fetch;
    } else if (typeof globalThis.fetch === 'function') {
      // The global needs its own receiver; a caller supplied fetch is left
      // exactly as passed so a bound method or a proxy wrapper still works.
      this.#fetch = globalThis.fetch.bind(globalThis);
    } else {
      throw new ConfigurationError(
        'No fetch implementation is available. Use Node 18 or later, or pass options.fetch.',
      );
    }

    this.#sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    /** @type {{limit: number|null, remaining: number|null, reset: number|null}} */
    this.rateLimit = { limit: null, remaining: null, reset: null };
    /** @type {string|null} */
    this.lastRequestId = null;
    /** @type {string|null} */
    this.lastEtag = null;
    /** @type {string|null} */
    this.priceListVersion = null;
  }

  /**
   * Perform one API call, retrying where the policy allows.
   *
   * @param {string} method
   * @param {string} path Path beginning with a slash, already percent encoded.
   * @param {object} [options]
   * @param {Record<string, unknown>} [options.query]
   * @param {unknown} [options.body] Serialised as JSON when present.
   * @param {Record<string, string>} [options.headers]
   * @returns {Promise<{status: number, headers: Headers, data: unknown}>}
   */
  async request(method, path, options = {}) {
    const url = buildUrl(this.baseUrl, path, options.query);
    const headers = {
      Accept: 'application/json',
      'User-Agent': this.userAgent,
      Authorization: `Bearer ${this.#apiKey}`,
      ...compactHeaders(options.headers),
    };

    let body;
    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers['Content-Type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.#send(method, url, headers, body);

      if (outcome.error) {
        // Transport failures are always safe to repeat: a request that never
        // reached the API cannot have had an effect, and one that did is
        // protected by the order idempotency key.
        if (attempt >= this.maxRetries) throw outcome.error;
        await this.#sleep(backoffDelay(attempt));
        continue;
      }

      const { response } = outcome;
      this.#recordHeaders(response.headers);

      if (response.status < 400) {
        return { status: response.status, headers: response.headers, data: await decode(response) };
      }

      const rawBody = await readText(response);
      const apiError = errorFromResponse(response.status, response.headers, parseJson(rawBody), rawBody);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt >= this.maxRetries) {
        throw apiError;
      }

      // The API knows when it will be ready again, so its Retry-After beats
      // anything computed locally.
      const advised = retryAfterMs(response.headers.get?.('Retry-After'));
      await this.#sleep(advised ?? backoffDelay(attempt));
    }
  }

  async #send(method, url, headers, body) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeout * 1000);

    try {
      const response = await this.#fetch(url, {
        method,
        headers,
        body,
        signal: controller.signal,
      });
      return { response, error: null };
    } catch (cause) {
      const error = timedOut
        ? new TimeoutError(`${method} ${url} timed out after ${this.timeout}s`, { cause })
        : new TransportError(`${method} ${url} failed: ${cause?.message ?? cause}`, { cause });
      return { response: null, error };
    } finally {
      clearTimeout(timer);
    }
  }

  #recordHeaders(headers) {
    if (typeof headers?.get !== 'function') return;

    this.rateLimit = {
      limit: intOrNull(headers.get('RateLimit-Limit')),
      remaining: intOrNull(headers.get('RateLimit-Remaining')),
      reset: intOrNull(headers.get('RateLimit-Reset')),
    };
    this.lastRequestId = headers.get('X-Request-Id');

    // ETag and the price list version are only sent by some operations, so
    // keep the last value seen rather than clearing it on every response.
    const etag = headers.get('ETag');
    if (etag) this.lastEtag = etag;

    const priceListVersion = headers.get('X-Price-List-Version');
    if (priceListVersion) this.priceListVersion = priceListVersion;
  }
}

/**
 * @param {string} baseUrl
 * @param {string} path
 * @param {Record<string, unknown>} [query]
 * @returns {string}
 */
export function buildUrl(baseUrl, path, query) {
  const url = new URL(`${baseUrl}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    // Undefined and null mean "not set". Sending them as empty strings would
    // trip the API's validation rather than being ignored.
    if (value === undefined || value === null) continue;

    if (Array.isArray(value)) {
      for (const entry of value) url.searchParams.append(key, String(entry));
    } else {
      url.searchParams.append(key, String(value));
    }
  }

  return url.toString();
}

export function buildUserAgent(suffix) {
  const base = `solarjuice-node/${VERSION}`;
  const trimmed = typeof suffix === 'string' ? suffix.trim() : '';
  return trimmed ? `${base} ${trimmed}` : base;
}

async function decode(response) {
  // 204 and 304 carry no body, and a body-less 200 is not worth failing over.
  const text = await readText(response);
  if (text === '') return null;

  const parsed = parseJson(text);
  return parsed === undefined ? text : parsed;
}

async function readText(response) {
  try {
    return await response.text();
  } catch {
    // The status line arrived but the body did not. There is nothing useful to
    // report beyond the status, which the caller already has.
    return '';
  }
}

function parseJson(text) {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function compactHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value !== undefined && value !== null) out[key] = String(value);
  }
  return out;
}

function intOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

function numberOption(value, fallback, name) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ConfigurationError(`${name} must be a non negative number`);
  }
  return value;
}

import {
  ConfigurationError,
  SolarJuiceError,
  TimeoutError,
  TransportError,
  errorFromResponse,
} from './errors.js';
import { MAX_RETRY_AFTER_MS, RETRYABLE_STATUSES, backoffDelay, retryAfterMs } from './retry.js';
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
   * @param {number} [options.timeout] Deadline in seconds for a whole attempt, response body included.
   * @param {number} [options.maxRetries]
   * @param {string} [options.userAgent] Suffix appended to the SDK User-Agent.
   * @param {typeof fetch} [options.fetch] Replacement fetch, for proxies or tests.
   * @param {(ms: number) => Promise<void>} [options.sleep] Replacement delay, for tests.
   */
  constructor(options) {
    this.#apiKey = options.apiKey;
    // Trailing slashes would produce "//v1/catalogue" once a path is appended.
    this.baseUrl = String(options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeout = timeoutOption(options.timeout);
    this.maxRetries = retryCountOption(options.maxRetries);
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

      const { status, headers: responseHeaders, text } = outcome;
      this.#recordHeaders(responseHeaders);

      // Redirects are never followed. A 3xx from the API host means something
      // in front of the API answered, so its body is somebody else's page and
      // returning it would look exactly like a successful call.
      if (status >= 300 && status < 400 && status !== 304) {
        throw redirectError(status, responseHeaders);
      }

      if (status < 400) {
        return { status, headers: responseHeaders, data: decode(status, responseHeaders, text) };
      }

      const apiError = errorFromResponse(status, responseHeaders, parseJson(text), text);

      if (!RETRYABLE_STATUSES.has(status) || attempt >= this.maxRetries) {
        throw apiError;
      }

      // The API knows when it will be ready again, so its Retry-After beats
      // anything computed locally.
      const advised = retryAfterMs(responseHeaders.get?.('Retry-After'));

      // An edge proxy in front of the API is not bound by the API's own small
      // values and can advise an hour. Blocking a caller's request or worker
      // for that long is worse than failing, so hand the error back with the
      // real value on it and let them schedule the retry themselves.
      if (advised !== null && advised > MAX_RETRY_AFTER_MS) throw apiError;

      await this.#sleep(advised ?? backoffDelay(attempt));
    }
  }

  /**
   * One attempt: send the request and read the whole response under a single
   * deadline.
   *
   * @returns {Promise<{status: number|null, headers: Headers|null, text: string, error: SolarJuiceError|null}>}
   */
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
        // See request(): a 3xx is an error here, not a hop to make.
        redirect: 'manual',
        signal: controller.signal,
      });

      // fetch settles when the headers arrive, so the body has to be read here
      // while the abort is still armed. Reading it after the timer is cleared
      // leaves a server that stalls mid body running with no deadline at all.
      const text = await readText(response, () => timedOut || controller.signal.aborted);

      return { status: response.status, headers: response.headers, text, error: null };
    } catch (cause) {
      const error = timedOut
        ? new TimeoutError(`${method} ${url} timed out after ${this.timeout}s`, { cause })
        : new TransportError(`${method} ${url} failed: ${cause?.message ?? cause}`, { cause });
      return { status: null, headers: null, text: '', error };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Every field here keeps its last seen value when the response omits the
   * header. /v1/health sends none of them and neither does an edge error page,
   * and wiping the rate limit window on those took the reading away exactly
   * when a caller needed it.
   */
  #recordHeaders(headers) {
    if (typeof headers?.get !== 'function') return;

    this.rateLimit = {
      limit: intIfPresent(headers, 'RateLimit-Limit', this.rateLimit.limit),
      remaining: intIfPresent(headers, 'RateLimit-Remaining', this.rateLimit.remaining),
      reset: intIfPresent(headers, 'RateLimit-Reset', this.rateLimit.reset),
    };

    const requestId = headers.get('X-Request-Id');
    if (requestId) this.lastRequestId = requestId;

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

/**
 * Turn a successful response body into the object the caller expects.
 *
 * @param {number} status
 * @param {Headers} headers
 * @param {string} text
 * @returns {object|null}
 */
function decode(status, headers, text) {
  // 204 and 304 carry no body, and a body-less 200 is not worth failing over.
  if (text.trim() === '') return null;

  const parsed = parseJson(text);

  if (!isJsonObject(parsed)) {
    // A 2xx that is not the documented envelope is almost never the API
    // answering: a captive portal, a proxy notice, an error page served with a
    // 200. Returning it would surface much later as an undefined `items`, so
    // fail here where the status and request id still explain it.
    throw new SolarJuiceError(
      `The Solar Juice Partner API returned a ${status} body that is not a JSON object.`,
      { statusCode: status, requestId: headers?.get?.('X-Request-Id') ?? null },
    );
  }

  return parsed;
}

/**
 * @param {number} status
 * @param {Headers} headers
 * @returns {SolarJuiceError}
 */
function redirectError(status, headers) {
  const location = headers?.get?.('Location');
  const target = location ? ` to ${location}` : '';

  return new SolarJuiceError(
    `The Solar Juice Partner API answered ${status} with a redirect${target}, which this client does not follow. Check baseUrl and anything proxying it.`,
    { statusCode: status, requestId: headers?.get?.('X-Request-Id') ?? null },
  );
}

/**
 * @param {Response} response
 * @param {() => boolean} deadlineBreached
 * @returns {Promise<string>}
 */
async function readText(response, deadlineBreached) {
  try {
    return await response.text();
  } catch (cause) {
    // A read that failed because the deadline fired is a timeout, and has to
    // reach the retry loop as one. Anything else means the status line arrived
    // but the body did not, which still leaves the status worth reporting.
    if (deadlineBreached()) throw cause;
    return '';
  }
}

function isJsonObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function intIfPresent(headers, name, previous) {
  const raw = headers.get(name);
  return raw === null || raw === undefined || raw === '' ? previous : intOrNull(raw);
}

function timeoutOption(value) {
  if (value === undefined || value === null) return DEFAULT_TIMEOUT_SECONDS;
  // Zero is not "no timeout" here: it aborts every request the moment it is
  // sent, which reads as a network fault rather than a misconfiguration.
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new ConfigurationError('timeout must be a positive number of seconds');
  }
  return value;
}

function retryCountOption(value) {
  if (value === undefined || value === null) return DEFAULT_MAX_RETRIES;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new ConfigurationError('maxRetries must be zero or a positive number');
  }
  return value;
}

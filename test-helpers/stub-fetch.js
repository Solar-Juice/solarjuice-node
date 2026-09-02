import { SolarJuiceClient } from '../src/index.js';

/**
 * Test doubles for the transport.
 *
 * Nothing in this suite touches the network: every client is built with an
 * injected fetch that replies from a queue, and an injected sleep that records
 * the backoff delays instead of waiting them out.
 */

export const TEST_API_KEY = 'sj_test_abcdefghijkl_0123456789abcdef0123456789abcdef';
export const REQUEST_ID = 'req_01J6ZK3M5X8QW2R7Y9V4B1N0PD';

/** A JSON response with the observability headers the API always sends. */
export function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'X-Request-Id': REQUEST_ID,
      'RateLimit-Limit': '600',
      'RateLimit-Remaining': '597',
      'RateLimit-Reset': '42',
      ...headers,
    },
  });
}

/** An error envelope exactly as the API documents it. */
export function errorResponse(status, code, { message = 'Something went wrong.', details = [], headers = {} } = {}) {
  return jsonResponse(
    { error: { code, message, details, request_id: REQUEST_ID } },
    { status, headers },
  );
}

/** A 304, which carries headers but no body. */
export function notModifiedResponse(etag) {
  return new Response(null, {
    status: 304,
    headers: { ETag: etag, 'X-Request-Id': REQUEST_ID },
  });
}

/**
 * A JSON response with none of the observability headers, which is what
 * /v1/health and anything answered by an edge in front of the API look like.
 */
export function bareResponse(body, headers = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

/** A redirect, as an edge or a misconfigured base URL would answer. */
export function redirectResponse(status = 302, location = 'https://portal.example.com/login') {
  return new Response('', { status, headers: { Location: location } });
}

/**
 * Headers, then a body that never finishes.
 *
 * The stream errors when the request signal aborts, which is what undici does,
 * so a client that has already cleared its timer by the time it reads the body
 * waits here forever.
 */
export function stallingBodyResponse(status = 200) {
  return (_url, init = {}) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"as_of":"2026-09-02T04:10:11Z","items":'));
          init.signal?.addEventListener('abort', () => {
            const error = new Error('The operation was aborted');
            error.name = 'AbortError';
            controller.error(error);
          });
        },
      }),
      { status, headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST_ID } },
    );
}

/**
 * A fetch that replies from a queue and records what it was asked for.
 *
 * A queue entry may be a Response, an Error to throw (a transport failure), or
 * a function of (url, init) returning either.
 */
export function stubFetch(replies = []) {
  const queue = [...replies];
  const calls = [];

  const fetch = async (url, init = {}) => {
    const call = {
      url,
      path: new URL(url).pathname,
      query: new URL(url).searchParams,
      method: init.method,
      headers: init.headers ?? {},
      body: init.body === undefined ? undefined : JSON.parse(init.body),
      redirect: init.redirect,
      signal: init.signal,
    };
    calls.push(call);

    if (queue.length === 0) {
      throw new Error(`stubFetch: unexpected ${init.method} ${url}`);
    }

    const reply = queue.shift();
    const resolved = typeof reply === 'function' ? await reply(url, init) : reply;
    if (resolved instanceof Error) throw resolved;
    return resolved;
  };

  return { fetch, calls };
}

/**
 * A client wired to a stub fetch.
 *
 * @param {Array} replies Queue passed to stubFetch.
 * @param {object} [options] Client options to override.
 * @returns {{client: SolarJuiceClient, calls: Array, sleeps: number[]}}
 */
export function makeClient(replies = [], options = {}) {
  const { fetch, calls } = stubFetch(replies);
  const sleeps = [];

  const client = new SolarJuiceClient({
    apiKey: TEST_API_KEY,
    fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });

  return { client, calls, sleeps };
}

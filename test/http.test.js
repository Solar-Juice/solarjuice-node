import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { ConfigurationError, SolarJuiceError, TimeoutError } from '../src/index.js';
import {
  REQUEST_ID,
  bareResponse,
  jsonResponse,
  makeClient,
  redirectResponse,
  stallingBodyResponse,
} from '../test-helpers/stub-fetch.js';

describe('the timeout is a deadline for the whole exchange', () => {
  it('raises TimeoutError when the body stalls after the headers arrive', async () => {
    const { client } = makeClient([stallingBodyResponse()], { timeout: 0.05, maxRetries: 0 });

    // Racing rather than awaiting: the bug this covers is an unbounded hang,
    // and a hung test would report as a suite timeout rather than a failure.
    const outcome = await Promise.race([
      client.catalogue.list().then(() => 'resolved', (error) => error),
      new Promise((resolve) => {
        setTimeout(() => resolve('still reading the body after the deadline'), 500);
      }),
    ]);

    assert.ok(outcome instanceof TimeoutError, `expected TimeoutError, got ${outcome}`);
    assert.equal(outcome.code, 'TIMEOUT');
  });

  it('retries a stalled body, because the retry loop sees a timeout like any other', async () => {
    const { client, calls } = makeClient(
      [stallingBodyResponse(), jsonResponse({ status: 'ok' })],
      { timeout: 0.05, maxRetries: 1 },
    );

    const outcome = await Promise.race([
      client.health(),
      new Promise((resolve) => {
        setTimeout(() => resolve('still reading the body after the deadline'), 500);
      }),
    ]);

    assert.deepEqual(outcome, { status: 'ok' });
    assert.equal(calls.length, 2);
  });

  it('still tolerates a body that fails to read for a reason other than the deadline', async () => {
    const broken = () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('ECONNRESET while reading the body'));
          },
        }),
        { status: 404, headers: { 'X-Request-Id': REQUEST_ID } },
      );

    const { client } = makeClient([broken], { maxRetries: 0 });

    await assert.rejects(client.orders.get('ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD'), (error) => {
      assert.equal(error.statusCode, 404);
      assert.equal(error.code, 'NOT_FOUND');
      return true;
    });
  });
});

describe('redirects', () => {
  it('asks fetch not to follow them', async () => {
    const { client, calls } = makeClient([jsonResponse({ status: 'ok' })]);
    await client.health();

    assert.equal(calls[0].redirect, 'manual');
  });

  it('raises on a 3xx instead of returning the other host body', async () => {
    const { client } = makeClient([redirectResponse(302, 'https://portal.example.com/login')], {
      maxRetries: 0,
    });

    await assert.rejects(client.catalogue.list(), (error) => {
      assert.ok(error instanceof SolarJuiceError);
      assert.equal(error.statusCode, 302);
      assert.match(error.message, /redirect/i);
      return true;
    });
  });

  it('leaves 304 alone, which is a successful conditional read', async () => {
    const { client } = makeClient([
      new Response(null, { status: 304, headers: { ETag: '"a1b2c3d4e5f6"' } }),
    ]);

    const order = await client.orders.get('ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD', {
      ifNoneMatch: '"a1b2c3d4e5f6"',
    });

    assert.equal(order, null);
  });
});

describe('response state is only overwritten when the header is present', () => {
  it('keeps the rate limit window and request id across a header-less response', async () => {
    const { client } = makeClient([
      jsonResponse({ items: [], next_cursor: null }),
      // /v1/health and edge error pages carry none of the observability headers.
      bareResponse({ status: 'ok' }),
    ]);

    await client.catalogue.list();
    assert.deepEqual(client.rateLimit, { limit: 600, remaining: 597, reset: 42 });
    assert.equal(client.lastRequestId, REQUEST_ID);

    await client.health();
    assert.deepEqual(client.rateLimit, { limit: 600, remaining: 597, reset: 42 });
    assert.equal(client.lastRequestId, REQUEST_ID);
  });

  it('updates each field on its own, so a partial set does not wipe the rest', async () => {
    const { client } = makeClient([
      jsonResponse({ status: 'ok' }),
      bareResponse({ status: 'ok' }, { 'RateLimit-Remaining': '12' }),
    ]);

    await client.health();
    await client.health();

    assert.deepEqual(client.rateLimit, { limit: 600, remaining: 12, reset: 42 });
  });
});

describe('a 2xx body that is not a JSON object', () => {
  it('raises rather than handing back a string', async () => {
    const captivePortal = new Response('<html><body>Sign in to continue</body></html>', {
      status: 200,
      headers: { 'Content-Type': 'text/html', 'X-Request-Id': REQUEST_ID },
    });
    const { client } = makeClient([captivePortal], { maxRetries: 0 });

    await assert.rejects(client.catalogue.list(), (error) => {
      assert.ok(error instanceof SolarJuiceError);
      assert.equal(error.statusCode, 200);
      assert.equal(error.requestId, REQUEST_ID);
      return true;
    });
  });

  it('raises for a JSON scalar or array, which no documented response is', async () => {
    for (const body of ['"ok"', '42', '[1,2,3]', 'null']) {
      const { client } = makeClient([
        new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } }),
      ], { maxRetries: 0 });

      await assert.rejects(client.catalogue.list(), SolarJuiceError, `expected ${body} to raise`);
    }
  });

  it('still allows an empty body, which is what 204 sends', async () => {
    const { client } = makeClient([new Response(null, { status: 204 })]);

    assert.equal(await client.request('DELETE', '/v1/something'), null);
  });
});

describe('constructor option validation', () => {
  it('rejects a zero timeout, which would abort every request instantly', () => {
    assert.throws(() => makeClient([], { timeout: 0 }), ConfigurationError);
  });

  it('rejects a negative or unusable timeout', () => {
    assert.throws(() => makeClient([], { timeout: -1 }), ConfigurationError);
    assert.throws(() => makeClient([], { timeout: Number.NaN }), ConfigurationError);
    assert.throws(() => makeClient([], { timeout: '30' }), ConfigurationError);
  });

  it('rejects a negative retry count but allows zero', () => {
    assert.throws(() => makeClient([], { maxRetries: -1 }), ConfigurationError);
    assert.doesNotThrow(() => makeClient([], { maxRetries: 0 }));
  });
});

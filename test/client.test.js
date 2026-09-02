import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  API_KEY_ENV_VAR,
  ConfigurationError,
  DEFAULT_BASE_URL,
  SolarJuiceClient,
  TimeoutError,
  VERSION,
} from '../src/index.js';
import { TEST_API_KEY, jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

describe('client construction', () => {
  const saved = process.env[API_KEY_ENV_VAR];

  before(() => {
    delete process.env[API_KEY_ENV_VAR];
  });

  after(() => {
    if (saved === undefined) delete process.env[API_KEY_ENV_VAR];
    else process.env[API_KEY_ENV_VAR] = saved;
  });

  it('raises a configuration error when there is no key anywhere', () => {
    assert.throws(() => new SolarJuiceClient(), (error) => {
      assert.ok(error instanceof ConfigurationError);
      assert.match(error.message, new RegExp(API_KEY_ENV_VAR));
      return true;
    });
  });

  it('falls back to the environment variable', async () => {
    process.env[API_KEY_ENV_VAR] = TEST_API_KEY;
    try {
      const { client, calls } = makeClient([jsonResponse({ status: 'ok' })], { apiKey: undefined });
      await client.health();
      assert.equal(calls[0].headers.Authorization, `Bearer ${TEST_API_KEY}`);
    } finally {
      delete process.env[API_KEY_ENV_VAR];
    }
  });

  it('defaults the base URL and trims a trailing slash from an override', () => {
    const { client } = makeClient();
    assert.equal(client.baseUrl, DEFAULT_BASE_URL);

    const { client: staging } = makeClient([], { baseUrl: 'https://staging.example.com/' });
    assert.equal(staging.baseUrl, 'https://staging.example.com');
  });

  it('rejects a negative timeout', () => {
    assert.throws(() => makeClient([], { timeout: -1 }), ConfigurationError);
  });
});

describe('request shape', () => {
  it('sends the bearer key, Accept and the SDK User-Agent', async () => {
    const { client, calls } = makeClient([jsonResponse({ status: 'ok' })]);
    await client.health();

    const [call] = calls;
    assert.equal(call.method, 'GET');
    assert.equal(call.url, `${DEFAULT_BASE_URL}/v1/health`);
    assert.equal(call.headers.Authorization, `Bearer ${TEST_API_KEY}`);
    assert.equal(call.headers.Accept, 'application/json');
    assert.equal(call.headers['User-Agent'], `solarjuice-node/${VERSION}`);
  });

  it('appends the caller User-Agent suffix', async () => {
    const { client, calls } = makeClient([jsonResponse({ status: 'ok' })], {
      userAgent: 'acme-storefront/2.1',
    });
    await client.health();

    assert.equal(calls[0].headers['User-Agent'], `solarjuice-node/${VERSION} acme-storefront/2.1`);
  });

  it('serialises query parameters and drops the ones that are not set', async () => {
    const { client, calls } = makeClient([jsonResponse({ items: [], next_cursor: null })]);
    await client.catalogue.list({
      limit: 50,
      brand: 'GoodWe',
      updated_since: '2026-09-02T04:10:11Z',
      cursor: undefined,
      category: null,
    });

    const { query } = calls[0];
    assert.equal(query.get('limit'), '50');
    assert.equal(query.get('brand'), 'GoodWe');
    assert.equal(query.get('updated_since'), '2026-09-02T04:10:11Z');
    assert.equal(query.has('cursor'), false);
    assert.equal(query.has('category'), false);
  });

  it('percent encodes path segments', async () => {
    const { client, calls } = makeClient([jsonResponse({ sku: 'GW/5000' })]);
    await client.catalogue.get('GW/5000');

    assert.equal(calls[0].path, '/v1/catalogue/GW%2F5000');
  });

  it('sends a JSON body with a content type on POST', async () => {
    const { client, calls } = makeClient([jsonResponse({ quote_id: 'qte_1', quote_status: 'priced' })]);
    await client.shipping.quote({
      destination: { suburb: 'Parramatta', postcode: '2150', state: 'NSW' },
      lines: [{ sku: 'GW-5000-DNS-30', quantity: 1 }],
    });

    const [call] = calls;
    assert.equal(call.method, 'POST');
    assert.equal(call.path, '/v1/shipping/quotes');
    assert.equal(call.headers['Content-Type'], 'application/json');
    assert.equal(call.body.lines[0].quantity, 1);
  });

  it('exposes the escape hatch for endpoints this release does not model', async () => {
    const { client, calls } = makeClient([jsonResponse({ ok: true })]);
    const data = await client.request('GET', '/v1/something-new', { query: { page: 2 } });

    assert.deepEqual(data, { ok: true });
    assert.equal(calls[0].query.get('page'), '2');
  });
});

describe('response visibility', () => {
  it('records rate limit headers and the request id', async () => {
    const { client } = makeClient([jsonResponse({ status: 'ok' })]);
    assert.deepEqual(client.rateLimit, { limit: null, remaining: null, reset: null });

    await client.health();

    assert.deepEqual(client.rateLimit, { limit: 600, remaining: 597, reset: 42 });
    assert.equal(client.lastRequestId, 'req_01J6ZK3M5X8QW2R7Y9V4B1N0PD');
  });

  it('records the price list version from a catalogue response', async () => {
    const { client } = makeClient([
      jsonResponse(
        { as_of: '2026-09-02T04:10:11Z', price_list_version: '2026-09-02T04:00:00Z', items: [], next_cursor: null },
        { headers: { 'X-Price-List-Version': '2026-09-02T04:00:00Z' } },
      ),
      jsonResponse({ status: 'ok' }),
    ]);

    await client.catalogue.list();
    assert.equal(client.priceListVersion, '2026-09-02T04:00:00Z');

    // Operations that do not send the header must not wipe the last value.
    await client.health();
    assert.equal(client.priceListVersion, '2026-09-02T04:00:00Z');
  });
});

describe('timeouts', () => {
  it('aborts the request and raises TimeoutError', async () => {
    const hangUntilAborted = (url, init) =>
      new Promise((resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          const error = new Error('The operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });

    const { client } = makeClient([hangUntilAborted], { timeout: 0.01, maxRetries: 0 });

    await assert.rejects(client.health(), (error) => {
      assert.ok(error instanceof TimeoutError);
      assert.equal(error.code, 'TIMEOUT');
      assert.equal(error.statusCode, null);
      return true;
    });
  });
});

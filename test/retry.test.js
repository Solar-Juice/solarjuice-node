import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { RateLimitedError, TransportError } from '../src/index.js';
import {
  INITIAL_BACKOFF_MS,
  MAX_BACKOFF_MS,
  RETRYABLE_STATUSES,
  backoffDelay,
  retryAfterMs,
} from '../src/retry.js';
import { errorResponse, jsonResponse, makeClient } from '../test-helpers/stub-fetch.js';

describe('backoff', () => {
  it('doubles the ceiling per attempt and caps it', () => {
    const ceiling = (attempt) => backoffDelay(attempt, () => 1);

    assert.equal(ceiling(0), INITIAL_BACKOFF_MS);
    assert.equal(ceiling(1), 1000);
    assert.equal(ceiling(2), 2000);
    assert.equal(ceiling(3), 4000);
    assert.equal(ceiling(4), MAX_BACKOFF_MS);
    assert.equal(ceiling(20), MAX_BACKOFF_MS);
  });

  it('uses full jitter, so the delay is anywhere in the window', () => {
    assert.equal(backoffDelay(3, () => 0), 0);
    assert.equal(backoffDelay(3, () => 0.5), 2000);
    assert.equal(backoffDelay(3, () => 1), 4000);
  });
});

describe('Retry-After parsing', () => {
  it('reads delta seconds', () => {
    assert.equal(retryAfterMs('30'), 30000);
  });

  it('reads an HTTP date', () => {
    const now = Date.parse('2026-09-02T04:10:11Z');
    assert.equal(retryAfterMs('Wed, 02 Sep 2026 04:10:41 GMT', now), 30000);
  });

  it('never returns a negative delay for a date in the past', () => {
    const now = Date.parse('2026-09-02T05:00:00Z');
    assert.equal(retryAfterMs('Wed, 02 Sep 2026 04:10:41 GMT', now), 0);
  });

  it('returns null for absent or unreadable values', () => {
    assert.equal(retryAfterMs(null), null);
    assert.equal(retryAfterMs(''), null);
    assert.equal(retryAfterMs('soon'), null);
  });
});

describe('retry policy', () => {
  it('retries every documented retryable status', () => {
    assert.deepEqual([...RETRYABLE_STATUSES].sort(), [429, 502, 503, 504]);
  });

  it('retries a 429 and returns the eventual success', async () => {
    const { client, calls, sleeps } = makeClient([
      errorResponse(429, 'RATE_LIMITED'),
      jsonResponse({ status: 'ok' }),
    ]);

    assert.deepEqual(await client.health(), { status: 'ok' });
    assert.equal(calls.length, 2);
    assert.equal(sleeps.length, 1);
    assert.ok(sleeps[0] <= INITIAL_BACKOFF_MS);
  });

  it('prefers Retry-After over the computed backoff', async () => {
    const { client, sleeps } = makeClient([
      errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '7' } }),
      jsonResponse({ status: 'ok' }),
    ]);

    await client.health();
    assert.deepEqual(sleeps, [7000]);
  });

  it('retries transient 5xx responses', async () => {
    const { client, calls } = makeClient([
      new Response('bad gateway', { status: 502 }),
      new Response('service unavailable', { status: 503 }),
      jsonResponse({ status: 'ok' }),
    ]);

    await client.health();
    assert.equal(calls.length, 3);
  });

  it('does not retry a 4xx that is not a rate limit', async () => {
    const { client, calls, sleeps } = makeClient([errorResponse(422, 'VALIDATION_FAILED')]);

    await assert.rejects(client.catalogue.list({ limit: 9000 }));
    assert.equal(calls.length, 1);
    assert.deepEqual(sleeps, []);
  });

  it('gives up after maxRetries and throws the last API error', async () => {
    const { client, calls, sleeps } = makeClient(
      [
        errorResponse(429, 'RATE_LIMITED'),
        errorResponse(429, 'RATE_LIMITED'),
        errorResponse(429, 'RATE_LIMITED'),
      ],
      { maxRetries: 2 },
    );

    await assert.rejects(client.health(), RateLimitedError);
    assert.equal(calls.length, 3);
    assert.equal(sleeps.length, 2);
  });

  it('retries network failures and then throws the transport error', async () => {
    const { client, calls } = makeClient(
      [new Error('ECONNRESET'), new Error('ECONNRESET'), new Error('ECONNRESET')],
      { maxRetries: 2 },
    );

    await assert.rejects(client.health(), TransportError);
    assert.equal(calls.length, 3);
  });

  it('retries a POST, which is safe because orders carry an idempotency key', async () => {
    const { client, calls } = makeClient([
      errorResponse(503, 'QUOTE_UNAVAILABLE', { headers: { 'Retry-After': '1' } }),
      jsonResponse({ quote_id: 'qte_01J6ZK3M5X8QW2R7Y9V4B1N0PD', quote_status: 'priced' }),
    ]);

    const quote = await client.shipping.quote({ destination: {}, lines: [] });
    assert.equal(quote.quote_status, 'priced');
    assert.equal(calls.length, 2);
  });

  it('sends the same idempotency key on every attempt of an order', async () => {
    const { client, calls } = makeClient([
      errorResponse(503, 'STALE_DATA'),
      jsonResponse({ id: 'ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD' }, { status: 202 }),
    ]);

    await client.orders.create({ client_reference: 'PO-88213' });

    assert.equal(calls.length, 2);
    assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  });
});

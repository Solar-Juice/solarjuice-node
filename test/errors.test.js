import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  ForbiddenError,
  IdempotencyConflictError,
  InternalError,
  NotFoundError,
  PriceChangedError,
  QuoteUnavailableError,
  RateLimitedError,
  SolarJuiceError,
  StaleDataError,
  TransportError,
  UnauthorizedError,
  ValidationFailedError,
} from '../src/index.js';
import { REQUEST_ID, errorResponse, makeClient } from '../test-helpers/stub-fetch.js';

/** Every documented code, with the status the API pairs it with. */
const MAPPINGS = [
  [401, 'UNAUTHORIZED', UnauthorizedError],
  [403, 'FORBIDDEN', ForbiddenError],
  [404, 'NOT_FOUND', NotFoundError],
  [422, 'VALIDATION_FAILED', ValidationFailedError],
  [429, 'RATE_LIMITED', RateLimitedError],
  [409, 'PRICE_CHANGED', PriceChangedError],
  [409, 'IDEMPOTENCY_CONFLICT', IdempotencyConflictError],
  [503, 'QUOTE_UNAVAILABLE', QuoteUnavailableError],
  [503, 'STALE_DATA', StaleDataError],
  [500, 'INTERNAL', InternalError],
];

describe('error mapping', () => {
  for (const [status, code, ErrorClass] of MAPPINGS) {
    it(`maps ${code} to ${ErrorClass.name}`, async () => {
      const { client } = makeClient([errorResponse(status, code, { message: `${code} happened.` })], {
        maxRetries: 0,
      });

      await assert.rejects(client.catalogue.get('GW-5000-DNS-30'), (error) => {
        assert.ok(error instanceof ErrorClass, `expected ${ErrorClass.name}, got ${error.name}`);
        assert.ok(error instanceof SolarJuiceError);
        assert.equal(error.code, code);
        assert.equal(error.statusCode, status);
        assert.equal(error.message, `${code} happened.`);
        assert.equal(error.requestId, REQUEST_ID);
        return true;
      });
    });
  }

  it('carries details through', async () => {
    const details = [{ field: 'lines[1].quantity', message: 'must be between 1 and 9999' }];
    const { client } = makeClient([errorResponse(422, 'VALIDATION_FAILED', { details })], { maxRetries: 0 });

    await assert.rejects(client.orders.list(), (error) => {
      assert.deepEqual(error.details, details);
      return true;
    });
  });

  it('reads retryAfter on a rate limit', async () => {
    const { client } = makeClient([errorResponse(429, 'RATE_LIMITED', { headers: { 'Retry-After': '30' } })], {
      maxRetries: 0,
    });

    await assert.rejects(client.catalogue.list(), (error) => {
      assert.ok(error instanceof RateLimitedError);
      assert.equal(error.retryAfter, 30);
      return true;
    });
  });

  it('leaves retryAfter null when the header is absent', async () => {
    const { client } = makeClient([errorResponse(429, 'RATE_LIMITED')], { maxRetries: 0 });

    await assert.rejects(client.catalogue.list(), (error) => {
      assert.equal(error.retryAfter, null);
      return true;
    });
  });

  it('falls back to the status when the body is not the documented envelope', async () => {
    // An edge or proxy in front of the API can return HTML that the SDK still
    // has to turn into the right error type.
    const gateway = new Response('<html>Gateway Timeout</html>', {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    });
    const { client } = makeClient([gateway], { maxRetries: 0 });

    await assert.rejects(client.orders.get('ord_01J6ZK3M5X8QW2R7Y9V4B1N0PD'), (error) => {
      assert.ok(error instanceof NotFoundError);
      assert.equal(error.code, 'NOT_FOUND');
      assert.equal(error.statusCode, 404);
      assert.match(error.message, /HTTP 404/);
      return true;
    });
  });

  it('uses the base error for a status that covers two codes and has no body', async () => {
    const { client } = makeClient([new Response('', { status: 409 })], { maxRetries: 0 });

    await assert.rejects(client.orders.create({}), (error) => {
      assert.equal(error.constructor, SolarJuiceError);
      assert.equal(error.code, null);
      assert.equal(error.statusCode, 409);
      return true;
    });
  });

  it('carries an unrecognised code through on the base error', async () => {
    // The error enumeration is documented as open, so a new code must not be
    // lost just because this release predates it.
    const { client } = makeClient([errorResponse(451, 'EMBARGOED', { message: 'Not available here.' })], {
      maxRetries: 0,
    });

    await assert.rejects(client.catalogue.list(), (error) => {
      assert.equal(error.constructor, SolarJuiceError);
      assert.equal(error.code, 'EMBARGOED');
      assert.equal(error.statusCode, 451);
      return true;
    });
  });

  it('wraps a network failure as a transport error', async () => {
    const { client } = makeClient([new Error('ECONNRESET')], { maxRetries: 0 });

    await assert.rejects(client.health(), (error) => {
      assert.ok(error instanceof TransportError);
      assert.ok(error instanceof SolarJuiceError);
      assert.equal(error.code, 'TRANSPORT_ERROR');
      assert.equal(error.statusCode, null);
      assert.match(error.message, /ECONNRESET/);
      return true;
    });
  });
});
